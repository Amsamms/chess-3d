import { Game } from '../game/Game';
import { Color, MultiplayerSession, MoveRecord } from './MultiplayerSession';

/**
 * Bridges a local Game instance with a MultiplayerSession.
 *
 * Mirrors the shape of AIPlayer.ts:
 *   const np = new NetworkPlayer(game, session);
 *   np.activate(myColor);
 *
 * Flow when *I* move (UI click → Game.executeMove via local input):
 *   Game fires afterMoveListener → NetworkPlayer.onLocalMove() → session.submitMove().
 *
 * Flow when *opponent* moves (Realtime event delivered to session):
 *   session.onOpponentMove() → NetworkPlayer.applyRemote() → Game.devMove().
 *
 * Spectator mode: same wiring, but myColor=null and we never call submitMove.
 */
export class NetworkPlayer {
  private myColor: Color | null = null;
  private active = false;
  private unsubOpponentMove: (() => void) | null = null;
  private unsubGameOver: (() => void) | null = null;
  // Track plies we know about so a duplicate event (network retry) doesn't double-apply.
  private highestAppliedPly = 0;

  constructor(
    private readonly game: Game,
    private readonly session: MultiplayerSession,
  ) {}

  /**
   * Hook up listeners. `color` is null for spectators, 'w' or 'b' for players.
   * Catches up to current state by replaying any moves already in the session
   * snapshot — useful when joining a game in progress as a spectator.
   */
  async activate(color: Color | null): Promise<void> {
    this.myColor = color;
    this.active = true;

    // Replay any moves already on the server snapshot (spectator joining mid-game,
    // or player reconnecting after a refresh).
    const moves = this.session.getMoves();
    for (const m of moves) {
      if (m.ply <= this.highestAppliedPly) continue;
      await this.applyRemote(m, /* fromReplay */ true);
    }

    // Subscribe to live events.
    this.unsubOpponentMove = this.session.onOpponentMove((m) => {
      // fire-and-forget — applyRemote awaits the animation
      void this.applyRemote(m, false);
    });
    this.unsubGameOver = this.session.onGameOver((_result) => {
      // Game.ts already detects checkmate/stalemate locally. Nothing extra to do here yet.
    });

    // If I'm a player, listen for my local moves to forward them up.
    if (color !== null) {
      this.game.onAfterMove(() => this.onLocalMove());
    }

    this.game.setAiThinking(false);
  }

  deactivate(): void {
    this.active = false;
    this.unsubOpponentMove?.();
    this.unsubGameOver?.();
    this.unsubOpponentMove = null;
    this.unsubGameOver = null;
  }

  getMyColor(): Color | null { return this.myColor; }
  isSpectator(): boolean { return this.myColor === null; }

  // ---- internals ---------------------------------------------------------

  /**
   * Forward my local move up to the session. Called by Game.afterMoveListener
   * AFTER chess.js + visuals applied. We rely on chess.js having validated.
   *
   * We only forward when the last move on the chess.js side was made by my
   * color — otherwise this listener firing means we just animated an opponent
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
    if (justMovedColor !== this.myColor) return; // opponent move, applied by us — don't re-send
    const ply = history.length;
    if (ply <= this.highestAppliedPly) return; // already mirrored to server
    this.highestAppliedPly = ply;

    const uci = `${last.from}${last.to}${last.promotion ?? ''}`;
    try {
      await this.session.submitMove({
        uci,
        san: last.san ?? '',
        fenAfter: chess.fen(),
      });
    } catch (err) {
      // RLS rejected (e.g., not our turn server-side, or stale state). Surface to console;
      // the other client's view is authoritative — Game state should resync from snapshot.
      console.error('[NetworkPlayer] submitMove failed:', err);
    }
  }

  /**
   * Apply an incoming move to the local Game. Skips if we've already played
   * this ply (e.g., catching up on snapshot replay and a Realtime event
   * arrives for the same move).
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
      console.error(`[NetworkPlayer] devMove rejected ply ${m.ply} uci=${m.uci} — local FEN: ${chess.fen()}`);
      return;
    }
    this.highestAppliedPly = m.ply;
  }
}
