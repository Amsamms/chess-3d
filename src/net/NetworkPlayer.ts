import { Game } from '../game/Game';
import type { GameResult } from '../game/Game';
import {
  Color,
  MultiplayerSession,
  MoveRecord,
  ControlMessage,
  DEFAULT_CLOCK,
} from './MultiplayerSession';

/**
 * Fischer chess clock for one online game (F18). Authoritative checkpoints ride
 * ON EACH MOVE (each side stamps its remaining ms when moving; the receiver
 * adopts the stamp). Ticking is rendered purely client-side from the last
 * checkpoint; on reconnect we restore from the last move/broadcast checkpoint,
 * conservatively favouring the OPPONENT (we charge the running side for the
 * elapsed wall-clock time since the checkpoint, capped at their remaining ms).
 *
 * It is NOT a wall clock per side stored on the server: only the remaining-ms
 * snapshot at each move boundary is authoritative. Between moves the side to
 * move drains from that snapshot at real time.
 */
export class ChessClock {
  private whiteMs: number;
  private blackMs: number;
  /** Whose clock is currently running ('w' | 'b'), or null when paused/stopped. */
  private running: Color | null = null;
  /** performance.now() at the moment the running side's clock last started draining. */
  private runningSince = 0;
  private readonly incrementMs: number;
  private flagged = false;

  constructor(initialMs = DEFAULT_CLOCK.initialMs, incrementMs = DEFAULT_CLOCK.incrementMs) {
    this.whiteMs = initialMs;
    this.blackMs = initialMs;
    this.incrementMs = incrementMs;
  }

  /** Adopt an authoritative checkpoint (from a move stamp or broadcast). */
  setCheckpoint(wms: number, bms: number): void {
    this.whiteMs = Math.max(0, wms);
    this.blackMs = Math.max(0, bms);
    // Re-anchor the running clock so subsequent ticking drains from the new base.
    this.runningSince = performance.now();
  }

  /** Begin draining the given side's clock (the side to move). */
  start(side: Color): void {
    this.running = side;
    this.runningSince = performance.now();
  }

  /** Pause ticking entirely (game over). Folds elapsed time into the running side. */
  stop(): void {
    this.drainElapsed();
    this.running = null;
  }

  /** Whether the clock is actively ticking a side down. */
  isRunning(): boolean { return this.running !== null; }

  /**
   * Called when a move completes. Folds elapsed time into the mover, adds the
   * Fischer increment to the mover, and switches the running side to the other
   * player. Returns the post-move checkpoint to stamp onto the move message.
   */
  onMove(mover: Color): { wms: number; bms: number } {
    this.drainElapsed();
    if (mover === 'w') this.whiteMs += this.incrementMs;
    else this.blackMs += this.incrementMs;
    this.running = mover === 'w' ? 'b' : 'w';
    this.runningSince = performance.now();
    return { wms: Math.round(this.whiteMs), bms: Math.round(this.blackMs) };
  }

  /** Current remaining ms for a side, accounting for in-flight draining. */
  remaining(side: Color): number {
    let ms = side === 'w' ? this.whiteMs : this.blackMs;
    if (this.running === side) ms -= performance.now() - this.runningSince;
    return Math.max(0, ms);
  }

  /** True the first frame the running side hits zero. */
  checkFlag(): Color | null {
    if (this.running === null || this.flagged) return null;
    if (this.remaining(this.running) <= 0) {
      this.flagged = true;
      return this.running;
    }
    return null;
  }

  /** Reset the flagged latch (e.g. on a new game). */
  resetFlag(): void { this.flagged = false; }

  private drainElapsed(): void {
    if (this.running === null) return;
    const elapsed = performance.now() - this.runningSince;
    if (this.running === 'w') this.whiteMs = Math.max(0, this.whiteMs - elapsed);
    else this.blackMs = Math.max(0, this.blackMs - elapsed);
    this.runningSince = performance.now();
  }
}

/** Live snapshot the UI renders each frame for the two clock displays. */
export interface ClockView {
  whiteMs: number;
  blackMs: number;
  running: Color | null;
  active: boolean;
}

/** State surfaced to the UI for the rematch handshake (F19). */
export type RematchPhase = 'none' | 'offered-by-me' | 'offered-by-them' | 'agreed';

/**
 * Bridges a local Game instance with a MultiplayerSession.
 *
 * Mirrors the shape of AIPlayer.ts:
 *   const np = new NetworkPlayer(game, session);
 *   np.activate(myColor);
 *
 * Flow when *I* move (UI click -> Game.executeMove via local input):
 *   Game fires moveAppliedListener (right after chess.js state changes, before
 *   the local 3D glide) -> NetworkPlayer.onLocalMove() -> session.submitMove()
 *   with a fresh clock checkpoint stamped in.
 *
 * Flow when *opponent* moves (Realtime event delivered to session):
 *   session.onOpponentMove() -> NetworkPlayer.applyRemote() -> Game.devMove();
 *   the move's clock stamp is adopted as the new authoritative checkpoint.
 *
 * Spectator mode: same wiring, but myColor=null and we never call submitMove.
 *
 * Beyond moves, NetworkPlayer also owns the ephemeral CONTROL layer (over
 * Broadcast): opponent presence (F8 disconnect), draw offers, resignation,
 * rematch handshake (F19), and the Fischer clock (F18) with flag detection.
 */
export class NetworkPlayer {
  private myColor: Color | null = null;
  private active = false;
  private unsubOpponentMove: (() => void) | null = null;
  private unsubGameOver: (() => void) | null = null;
  private unsubPresence: (() => void) | null = null;
  private unsubControl: (() => void) | null = null;
  // Track plies we know about so a duplicate event (network retry) doesn't double-apply.
  private highestAppliedPly = 0;

  // ---- clock (F18) ----
  private clock: ChessClock | null = null;
  private clockEnabled = false;
  /** Latched once we have claimed a terminal result so we don't double-claim. */
  private resultClaimed = false;

  // ---- rematch handshake (F19) ----
  private rematchPhase: RematchPhase = 'none';

  // ---- UI callbacks ----
  private presenceCb: ((online: boolean) => void) | null = null;
  private drawOfferCb: ((offering: boolean) => void) | null = null;
  private rematchCb: ((phase: RematchPhase) => void) | null = null;
  private rematchRoomCb: ((code: string, myColor: Color) => void) | null = null;
  private resultCb: ((result: GameResult) => void) | null = null;

  constructor(
    private readonly game: Game,
    private readonly session: MultiplayerSession,
  ) {}

  /**
   * Hook up listeners. `color` is null for spectators, 'w' or 'b' for players.
   * Catches up to current state by replaying any moves already in the session
   * snapshot (joining a game in progress as a spectator, or reconnecting).
   *
   * `enableClock` activates the Fischer clock for players (F18). It is started
   * from the restored checkpoint if there is one, else from the default time.
   */
  async activate(color: Color | null, enableClock = false): Promise<void> {
    this.myColor = color;
    this.active = true;
    this.resultClaimed = false;
    this.rematchPhase = 'none';

    // Replay any moves already on the server snapshot (spectator joining mid-game,
    // or player reconnecting after a refresh).
    const moves = this.session.getMoves();
    for (const m of moves) {
      if (m.ply <= this.highestAppliedPly) continue;
      await this.applyRemote(m, /* fromReplay */ true);
    }

    // Subscribe to live events.
    this.unsubOpponentMove = this.session.onOpponentMove((m) => {
      // fire-and-forget -- applyRemote awaits the animation
      void this.applyRemote(m, false);
    });
    this.unsubGameOver = this.session.onGameOver((result) => {
      this.onRemoteResult(result);
    });
    this.unsubPresence = this.session.onOpponentPresence((online) => {
      this.presenceCb?.(online);
    });
    this.unsubControl = this.session.onControl((msg) => this.onControl(msg));

    // If I'm a player, listen for my local moves to forward them up. We use
    // onMoveApplied (fires the instant chess.js state changes, BEFORE the local
    // 3D glide animation) so the opponent receives the move with no animation
    // delay. The animation stays purely local. (F9)
    if (color !== null) {
      this.game.onMoveApplied(() => this.onLocalMove());
    }

    // -- Clock setup (F18). Players only; spectators render a read-only view. --
    this.clockEnabled = enableClock || color === null;
    if (this.clockEnabled) {
      this.clock = new ChessClock();
      this.restoreClockFromCheckpoint();
    }

    this.game.setAiThinking(false);
  }

  deactivate(): void {
    this.active = false;
    this.unsubOpponentMove?.();
    this.unsubGameOver?.();
    this.unsubPresence?.();
    this.unsubControl?.();
    this.unsubOpponentMove = null;
    this.unsubGameOver = null;
    this.unsubPresence = null;
    this.unsubControl = null;
    this.clock?.stop();
    this.clock = null;
  }

  getMyColor(): Color | null { return this.myColor; }
  isSpectator(): boolean { return this.myColor === null; }
  /** Whether a terminal result has already been recorded (resign/draw/flag/etc). */
  isGameDecided(): boolean { return this.resultClaimed || this.game.devChess().isGameOver(); }

  // ---- UI callback wiring ----------------------------------------------------

  onPresence(fn: (online: boolean) => void): void { this.presenceCb = fn; }
  onDrawOffer(fn: (offering: boolean) => void): void { this.drawOfferCb = fn; }
  onRematch(fn: (phase: RematchPhase) => void): void { this.rematchCb = fn; }
  onRematchRoom(fn: (code: string, myColor: Color) => void): void { this.rematchRoomCb = fn; }
  onResult(fn: (result: GameResult) => void): void { this.resultCb = fn; }

  // ---- clock view for the HUD ------------------------------------------------

  /** Read the live clock state for HUD rendering each frame (F18). */
  clockView(): ClockView | null {
    if (!this.clock || !this.clockEnabled) return null;
    return {
      whiteMs: this.clock.remaining('w'),
      blackMs: this.clock.remaining('b'),
      running: this.clock.isRunning() ? (this.game.devChess().turn() as Color) : null,
      active: true,
    };
  }

  /**
   * Pump the clock once per frame from main's render loop. Detects a flag fall
   * and claims the Timeout result for the side that DID NOT flag. (F18)
   */
  tick(): void {
    if (!this.active || !this.clock || !this.clockEnabled) return;
    if (this.resultClaimed) return;
    // Spectators render the clocks but never adjudicate a flag fall (their clock
    // may drift); they learn the timeout result from the players' broadcast / the
    // DB result row instead.
    if (this.myColor === null) return;
    const flagged = this.clock.checkFlag();
    if (flagged) {
      this.clock.stop();
      this.handleFlag(flagged, /* local */ true);
    }
  }

  // ---- actions: resign / draw / rematch -------------------------------------

  /** I resign the game (F8/resign). Emits the Resignation result to both sides. */
  async resign(): Promise<void> {
    if (this.myColor === null || this.resultClaimed) return;
    const winner: 'White' | 'Black' = this.myColor === 'w' ? 'Black' : 'White';
    this.resultClaimed = true;
    this.clock?.stop();
    // Announce instantly over Broadcast so the opponent sees it without waiting
    // on the DB round-trip, then persist via the RPC (or fallback).
    await this.session.sendControl({ kind: 'resign' });
    this.applyResult({ kind: 'resignation', winner });
    await this.session.resign();
  }

  /** Offer a draw to the opponent (draw offers). Non-blocking. */
  async offerDraw(): Promise<void> {
    if (this.myColor === null || this.resultClaimed) return;
    this.drawOfferCb?.(true); // local "you offered, awaiting reply" hint
    await this.session.sendControl({ kind: 'draw-offer' });
  }

  /** Accept a pending draw offer. Both sides record a draw by agreement. */
  async acceptDraw(): Promise<void> {
    if (this.myColor === null || this.resultClaimed) return;
    this.resultClaimed = true;
    this.clock?.stop();
    await this.session.sendControl({ kind: 'draw-accept' });
    // Draw by agreement -> neutral draw kind (no winner).
    this.applyResult({ kind: 'agreement', winner: null });
    await this.session.setResult('1/2-1/2');
  }

  /** Decline a pending draw offer. */
  async declineDraw(): Promise<void> {
    if (this.myColor === null) return;
    this.drawOfferCb?.(false);
    await this.session.sendControl({ kind: 'draw-decline' });
  }

  /** Offer / accept a rematch (F19). The handshake is symmetric. */
  async requestRematch(): Promise<void> {
    if (this.myColor === null) return;
    if (this.rematchPhase === 'offered-by-them') {
      // They already offered -> this is my acceptance, both agreed.
      await this.acceptRematch();
      return;
    }
    this.rematchPhase = 'offered-by-me';
    this.rematchCb?.(this.rematchPhase);
    await this.session.sendControl({ kind: 'rematch-offer' });
  }

  private async acceptRematch(): Promise<void> {
    if (this.myColor === null) return;
    this.rematchPhase = 'agreed';
    this.rematchCb?.(this.rematchPhase);
    await this.session.sendControl({ kind: 'rematch-accept' });
    await this.maybeHostRematchRoom();
  }

  /**
   * Decide whether I should host the rematch room. The deterministic host is the
   * player who is currently BLACK (so they become white in the new room and RLS
   * is satisfied). The white player waits for the 'rematch-room' broadcast.
   */
  private async maybeHostRematchRoom(): Promise<void> {
    if (this.myColor !== 'b') return; // only the black seat hosts
    try {
      const { roomCode } = await this.session.createRematchRoom();
      // I am white in the new room.
      this.rematchRoomCb?.(roomCode, 'w');
    } catch (err) {
      console.error('[NetworkPlayer] rematch room creation failed:', err);
    }
  }

  // ---- incoming control messages --------------------------------------------

  private onControl(msg: ControlMessage): void {
    if (!this.active) return;
    switch (msg.kind) {
      case 'draw-offer':
        // Opponent is offering a draw -> show me the accept/decline prompt.
        if (this.myColor !== null && !this.resultClaimed) this.incomingDrawCb?.();
        break;
      case 'draw-accept':
        // Opponent accepted MY draw offer -> record the draw on my side too.
        if (this.myColor !== null && !this.resultClaimed) {
          this.resultClaimed = true;
          this.clock?.stop();
          this.applyResult({ kind: 'agreement', winner: null });
          void this.session.setResult('1/2-1/2');
        }
        break;
      case 'draw-decline':
        // Opponent declined my offer -> clear the "awaiting reply" hint.
        this.drawOfferCb?.(false);
        break;
      case 'resign': {
        // Opponent resigned -> I win.
        const winner: 'White' | 'Black' = this.myColor === 'w' ? 'White' : 'Black';
        if (this.myColor === null) {
          // Spectator: which side resigned is the one whose color == msg.from.
          const w: 'White' | 'Black' = msg.from === 'w' ? 'Black' : 'White';
          this.applyResult({ kind: 'resignation', winner: w });
        } else {
          this.resultClaimed = true;
          this.clock?.stop();
          this.applyResult({ kind: 'resignation', winner });
        }
        break;
      }
      case 'rematch-offer':
        if (this.rematchPhase === 'offered-by-me') {
          // Cross-offer: both want it -> agreed.
          void this.acceptRematch();
        } else {
          this.rematchPhase = 'offered-by-them';
          this.rematchCb?.(this.rematchPhase);
        }
        break;
      case 'rematch-accept':
        // Opponent accepted my offer -> both agreed; host (black) creates room.
        this.rematchPhase = 'agreed';
        this.rematchCb?.(this.rematchPhase);
        void this.maybeHostRematchRoom();
        break;
      case 'rematch-room':
        // The host opened a fresh room and I should join as the given color.
        if (msg.roomCode && this.rematchRoomCb) {
          const myNewColor: Color = msg.yourColor ?? 'b';
          this.rematchRoomCb(msg.roomCode, myNewColor);
        }
        break;
      case 'clock':
        // Authoritative clock checkpoint from the opponent's move broadcast.
        if (this.clock && typeof msg.wms === 'number' && typeof msg.bms === 'number') {
          this.clock.setCheckpoint(msg.wms, msg.bms);
        }
        break;
      case 'flag': {
        // Opponent claims a flag fall. Validate against our own clock math: only
        // honour it if our clock also shows the named side at (or near) zero.
        if (this.clock && msg.flagged) {
          if (typeof msg.wms === 'number' && typeof msg.bms === 'number') {
            this.clock.setCheckpoint(msg.wms, msg.bms);
          }
          const remaining = this.clock.remaining(msg.flagged);
          if (remaining <= 250) {
            this.handleFlag(msg.flagged, /* local */ false);
          }
        }
        break;
      }
    }
  }

  private incomingDrawCb: (() => void) | null = null;
  /** Fires when the OPPONENT offers me a draw, so the UI shows accept/decline. */
  onIncomingDrawOffer(fn: () => void): void { this.incomingDrawCb = fn; }

  // ---- flag / result helpers ------------------------------------------------

  private handleFlag(flagged: Color, local: boolean): void {
    if (this.resultClaimed) return;
    this.resultClaimed = true;
    this.clock?.stop();
    const winner: 'White' | 'Black' = flagged === 'w' ? 'Black' : 'White';
    if (local && this.myColor !== null) {
      // I detected the flag locally. Announce + persist (only the WINNER claims,
      // to avoid both sides writing). If I'm the flagged side, the opponent will
      // claim; but I still surface the result locally so my modal shows.
      const checkpoint = this.session.getClockCheckpoint();
      void this.session.sendControl({
        kind: 'flag',
        flagged,
        wms: checkpoint?.wms,
        bms: checkpoint?.bms,
      });
      const myColorLong: 'White' | 'Black' = this.myColor === 'w' ? 'White' : 'Black';
      if (myColorLong === winner) {
        const r: '1-0' | '0-1' = winner === 'White' ? '1-0' : '0-1';
        void this.session.claimResult(r);
      }
    }
    this.applyResult({ kind: 'timeout', winner });
  }

  /**
   * Claim the win because the opponent disconnected and did not return within
   * the window (F8). Records an Abandonment result for me. Idempotent.
   */
  async claimAbandonment(): Promise<void> {
    if (this.myColor === null || this.resultClaimed) return;
    this.resultClaimed = true;
    this.clock?.stop();
    const winner: 'White' | 'Black' = this.myColor === 'w' ? 'White' : 'Black';
    const result: '1-0' | '0-1' = this.myColor === 'w' ? '1-0' : '0-1';
    this.applyResult({ kind: 'abandonment', winner });
    await this.session.claimResult(result);
  }

  /** Surface a terminal result to the local Game + the UI callback. */
  private applyResult(result: GameResult): void {
    this.game.setExternalResult(result);
    this.resultCb?.(result);
  }

  /**
   * The server row's result column became non-null (the opponent persisted a
   * result). Map the result string to a GameResult and surface it. This covers
   * the case where the opponent resigned/flagged and only the DB row update
   * reached us (Broadcast missed). (F8)
   */
  private onRemoteResult(result: string): void {
    if (this.resultClaimed && this.myColor !== null) return;
    let gr: GameResult | null = null;
    if (result === '1-0') gr = { kind: 'resignation', winner: 'White' };
    else if (result === '0-1') gr = { kind: 'resignation', winner: 'Black' };
    else if (result === '1/2-1/2') gr = { kind: 'agreement', winner: null };
    else if (result === 'abandoned') {
      const winner: 'White' | 'Black' | null = this.myColor === 'w' ? 'White' : this.myColor === 'b' ? 'Black' : null;
      gr = { kind: 'abandonment', winner };
    }
    // Only surface if the local game has not already detected a natural end
    // (checkmate/stalemate are detected by chess.js locally and are more
    // precise). The DB result is a fallback for resign/timeout/abandon.
    if (gr && !this.game.devChess().isGameOver()) {
      this.resultClaimed = true;
      this.clock?.stop();
      this.applyResult(gr);
    }
  }

  // ---- move plumbing ---------------------------------------------------------

  /**
   * Forward my local move up to the session. Called by Game.onMoveApplied the
   * instant chess.js state is updated (before the local glide). We rely on
   * chess.js having validated.
   *
   * We only forward when the last move on the chess.js side was made by my
   * color, otherwise this listener firing means we just animated an opponent
   * move we received from the network and shouldn't echo it back.
   */
  private async onLocalMove(): Promise<void> {
    if (!this.active || this.myColor === null) return;
    const chess = this.game.devChess();
    const history = chess.history({ verbose: true });
    const last = history[history.length - 1];
    if (!last) return;
    // The side that JUST moved is the opposite of chess.turn() now.
    const justMovedColor = chess.turn() === 'w' ? 'b' : 'w';
    if (justMovedColor !== this.myColor) return; // opponent move, applied by us -- don't re-send
    const ply = history.length;
    if (ply <= this.highestAppliedPly) return; // already mirrored to server
    this.highestAppliedPly = ply;

    // Stamp the clock checkpoint for this move (F18): fold elapsed time, add the
    // Fischer increment to me, switch the running side to the opponent.
    let wms: number | undefined;
    let bms: number | undefined;
    if (this.clock && this.clockEnabled) {
      const cp = this.clock.onMove(this.myColor);
      wms = cp.wms;
      bms = cp.bms;
    }

    const uci = `${last.from}${last.to}${last.promotion ?? ''}`;
    try {
      await this.session.submitMove({
        uci,
        san: last.san ?? '',
        fenAfter: chess.fen(),
        wms,
        bms,
      });
    } catch (err) {
      // RLS rejected (e.g., not our turn server-side, or stale state). Surface to console;
      // the other client's view is authoritative -- Game state should resync from snapshot.
      console.error('[NetworkPlayer] submitMove failed:', err);
    }
  }

  /**
   * Apply an incoming move to the local Game. Skips if we've already played
   * this ply (e.g., catching up on snapshot replay and a Realtime event
   * arrives for the same move). Adopts the move's clock stamp.
   */
  private async applyRemote(m: MoveRecord, _fromReplay: boolean): Promise<void> {
    if (!this.active) return;
    if (m.ply <= this.highestAppliedPly) return;
    const ok = await this.game.devMove({
      from: m.uci.slice(0, 2),
      to:   m.uci.slice(2, 4),
      promotion: m.uci.length > 4 ? m.uci.slice(4, 5) : undefined,
    });
    if (!ok) {
      const chess = this.game.devChess();
      console.error(`[NetworkPlayer] devMove rejected ply ${m.ply} uci=${m.uci} -- local FEN: ${chess.fen()}`);
      return;
    }
    this.highestAppliedPly = m.ply;

    // Adopt the move's clock checkpoint as authoritative (F18). After an opponent
    // move, my clock becomes the running side.
    if (this.clock && this.clockEnabled) {
      if (typeof m.wms === 'number' && typeof m.bms === 'number') {
        this.clock.setCheckpoint(m.wms, m.bms);
      }
      // Start draining the side now to move.
      this.clock.start(this.game.devChess().turn() as Color);
    }
  }

  /**
   * Restore the clock from the last authoritative checkpoint when (re)activating
   * a game in progress (F18). Conservatively favours the opponent: we charge the
   * running side for wall-clock time elapsed since the last move stamp.
   *
   * The clock only STARTS draining once both seats are filled and the game is
   * live. A freshly created room (waiting for an opponent) leaves the clock
   * paused; startClockIfReady() is called again when the peer joins.
   */
  private restoreClockFromCheckpoint(): void {
    if (!this.clock) return;
    this.clock.resetFlag();
    const cp = this.session.getClockCheckpoint();
    if (cp) {
      let { wms, bms } = cp;
      // Conservatively favour the OPPONENT on reconnect (F18): charge the side to
      // move for the real wall-clock time elapsed since the last move's stamp, so
      // a player who refreshes/reconnects cannot gain free thinking time. We use
      // the last move's ISO `at` timestamp as the reference.
      const moves = this.session.getMoves();
      const last = moves[moves.length - 1];
      if (last?.at) {
        const elapsed = Date.now() - new Date(last.at).getTime();
        if (elapsed > 0 && elapsed < 60 * 60 * 1000) {
          const sideToMove = this.game.devChess().turn() as Color;
          if (sideToMove === 'w') wms = Math.max(0, wms - elapsed);
          else bms = Math.max(0, bms - elapsed);
        }
      }
      this.clock.setCheckpoint(wms, bms);
    }
    this.startClockIfReady();
  }

  /**
   * Begin draining the side to move, but only when both players are seated and
   * the game has not ended. Idempotent: safe to call on every peer-join event.
   */
  startClockIfReady(): void {
    if (!this.clock || !this.clockEnabled) return;
    const bothSeated = this.session.getWhiteId() !== null && this.session.getBlackId() !== null;
    if (!bothSeated) return;
    const chess = this.game.devChess();
    if (chess.isGameOver()) return;
    this.clock.start(chess.turn() as Color);
  }
}
