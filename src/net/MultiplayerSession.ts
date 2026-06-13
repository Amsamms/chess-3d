import type { RealtimeChannel } from '@supabase/supabase-js';
import { getClient, signInAnon, currentUserId } from './SupabaseClient';

/**
 * Represents one online chess game as seen from one client.
 *
 * Lifecycle:
 *   const session = new MultiplayerSession();
 *   const { roomCode, myColor } = await session.createRoom();   // host path
 *   // OR
 *   const { myColor, fen, moves } = await session.joinRoom(code); // joiner path
 *   // OR
 *   const { fen, moves } = await session.watchRoom(code);         // spectator path
 *
 *   session.onOpponentMove((m) => { ... });
 *   session.onPeerJoined(() => { ... });
 *   session.onGameOver((result) => { ... });
 *
 *   await session.submitMove({ uci: 'e2e4', san: 'e4', fenAfter: '...' });
 *   await session.disconnect();
 */

export type Color = 'w' | 'b';

export interface MoveRecord {
  ply: number;
  uci: string;       // e.g. 'e2e4' or 'e7e8q'
  san: string;       // e.g. 'e4' or 'e8=Q+'
  fenAfter: string;  // FEN after this move was applied
  at: string;        // ISO timestamp client-side; not source of truth
  /**
   * Clock checkpoint stamped by the mover at the instant the move was applied:
   * the remaining milliseconds on BOTH clocks just after this move (the mover's
   * own clock already had the Fischer increment added). Optional so pre-clock
   * rows (and spectators of old games) stay backward compatible. The receiver
   * adopts this stamp as authoritative for reconnect/resync. (F18)
   */
  wms?: number;      // white remaining ms after this move
  bms?: number;      // black remaining ms after this move
}

/**
 * Clock configuration for an online game. Fischer increment: each side starts
 * with `initialMs`, and gains `incrementMs` every time they complete a move.
 */
export interface ClockConfig {
  initialMs: number;
  incrementMs: number;
}

/** Fischer 10 minutes + 5 second increment, online default. (F18) */
export const DEFAULT_CLOCK: ClockConfig = { initialMs: 10 * 60 * 1000, incrementMs: 5 * 1000 };

/**
 * Ephemeral signalling messages exchanged over Supabase Realtime BROADCAST on
 * the same `game:<code>` channel as the postgres_changes move sync. Broadcast
 * (vs. postgres_changes) is used for transient, non-persisted control traffic:
 * draw offers, resignation announcements, rematch handshake, and the clock
 * checkpoint that piggybacks each move. None of these require a schema change,
 * so they work against the CURRENT (migration 001) database.
 *
 * Broadcast event name -> payload:
 *   'mp-control' : { kind: ControlKind, from: 'w' | 'b' | 'spectator', ... }
 */
export type ControlKind =
  | 'draw-offer'      // I offer a draw
  | 'draw-accept'     // I accept your draw offer (both sides record a draw)
  | 'draw-decline'    // I decline your draw offer
  | 'resign'          // I resigned (announce so the opponent shows it instantly)
  | 'rematch-offer'   // I want a rematch (game over)
  | 'rematch-accept'  // I accept the rematch; sender includes my preferred next color
  | 'rematch-room'    // creator created the new room, here is the code + your color
  | 'flag'            // I claim the opponent flagged (ran out of time)
  | 'clock';          // bare clock checkpoint broadcast on each move (rides the move)

export interface ControlMessage {
  kind: ControlKind;
  from: 'w' | 'b' | 'spectator';
  /** For rematch-room: the fresh room code the creator just opened. */
  roomCode?: string;
  /** For rematch-room: the color the RECIPIENT should take in the new room. */
  yourColor?: Color;
  /** For flag: which color is claimed to have flagged. */
  flagged?: Color;
  /** Clock checkpoint that rides 'clock' and 'flag' messages. */
  wms?: number;
  bms?: number;
}

interface RoomSnapshot {
  id: string;
  fen: string;
  moves: MoveRecord[];
  white_id: string | null;
  black_id: string | null;
  result: string | null;
  piece_set: string;
  environment: string;
  /** Optional post-002 clock checkpoint columns (undefined pre-migration). */
  white_ms?: number | null;
  black_ms?: number | null;
}

export interface CreatedRoom {
  roomCode: string;
  myColor: Color;
}

export interface JoinedRoom {
  myColor: Color;
  fen: string;
  moves: MoveRecord[];
  opponentPresent: boolean;
}

export interface SpectatingRoom {
  fen: string;
  moves: MoveRecord[];
  whitePresent: boolean;
  blackPresent: boolean;
}

export type Role = 'white' | 'black' | 'spectator';

export class MultiplayerSession {
  private channel: RealtimeChannel | null = null;
  private queueChannel: RealtimeChannel | null = null;
  private queueRowId: string | null = null;
  private snapshot: RoomSnapshot | null = null;
  private role: Role | null = null;

  private opponentMoveListeners: Array<(m: MoveRecord) => void> = [];
  private peerJoinedListeners: Array<() => void> = [];
  private gameOverListeners: Array<(result: string) => void> = [];
  /** Presence: opponent online/offline transitions (F8). */
  private presenceListeners: Array<(online: boolean) => void> = [];
  /** Ephemeral control traffic over Broadcast (draw / resign / rematch / flag). */
  private controlListeners: Array<(msg: ControlMessage) => void> = [];

  /** True once the opponent has been seen present at least once on this channel. */
  private opponentEverPresent = false;
  /** Last computed opponent presence state, to debounce duplicate events. */
  private opponentOnline = false;
  /** My own presence key (the auth uid), tracked so we ignore our own presence. */
  private myUserId: string | null = null;

  /**
   * Whether the optional post-002 clock columns (white_ms/black_ms) exist on the
   * games row. Detected lazily from the first fetched snapshot. null = unknown.
   * When true we ALSO checkpoint the clock into those columns; when false/null we
   * rely purely on the per-move stamp inside the moves jsonb (works on 001). (F18)
   */
  private clockColumnsPresent: boolean | null = null;

  private lastAppliedPly = 0;
  /**
   * Plies we've just sent up but haven't yet observed the Realtime echo for.
   * Without this, a UPDATE→broadcast cycle that completes faster than the
   * REST response would deliver our own move back to us as an "opponent move".
   */
  private pliesInFlight: Set<number> = new Set();

  // ---- public API ----------------------------------------------------------

  /** Returns my role in the room, or null if not yet joined. */
  getRole(): Role | null { return this.role; }
  getMyColor(): Color | null {
    if (this.role === 'white') return 'w';
    if (this.role === 'black') return 'b';
    return null;
  }
  getRoomCode(): string | null { return this.snapshot?.id ?? null; }
  getFen(): string | null { return this.snapshot?.fen ?? null; }
  getMoves(): MoveRecord[] { return this.snapshot?.moves ?? []; }

  /** Subscribe to opponent moves arriving via Realtime. Returns unsubscribe fn. */
  onOpponentMove(fn: (m: MoveRecord) => void): () => void {
    this.opponentMoveListeners.push(fn);
    return () => this.removeListener(this.opponentMoveListeners, fn);
  }
  /** Fires once when the other player joins an open room. */
  onPeerJoined(fn: () => void): () => void {
    this.peerJoinedListeners.push(fn);
    return () => this.removeListener(this.peerJoinedListeners, fn);
  }
  /** Fires when result becomes non-null. */
  onGameOver(fn: (result: string) => void): () => void {
    this.gameOverListeners.push(fn);
    return () => this.removeListener(this.gameOverListeners, fn);
  }

  /**
   * Fires when the opponent's presence on the channel changes (F8).
   * `online=true` when the opponent joins/rejoins, `online=false` when they
   * leave (closed tab, navigated away, lost connection). Spectators count the
   * "opponent" as both players collectively (true if EITHER player is present).
   */
  onOpponentPresence(fn: (online: boolean) => void): () => void {
    this.presenceListeners.push(fn);
    return () => this.removeListener(this.presenceListeners, fn);
  }

  /**
   * Fires for every ephemeral control message broadcast on the channel (draw
   * offer/decline, resignation announce, rematch handshake, flag claim). The
   * caller decides how to react. Messages I send myself are NOT echoed back to
   * me (Supabase broadcast self:false by default for the sender).
   */
  onControl(fn: (msg: ControlMessage) => void): () => void {
    this.controlListeners.push(fn);
    return () => this.removeListener(this.controlListeners, fn);
  }

  /** Whether the opponent is currently present on the channel (F8). */
  isOpponentOnline(): boolean { return this.opponentOnline; }

  /** Current clock checkpoint from the latest snapshot/moves, or null if no clock data. */
  getClockCheckpoint(): { wms: number; bms: number } | null {
    const snap = this.snapshot;
    if (!snap) return null;
    // Prefer the post-002 columns if present and populated.
    if (typeof snap.white_ms === 'number' && typeof snap.black_ms === 'number') {
      return { wms: snap.white_ms, bms: snap.black_ms };
    }
    // Else derive from the last move's stamp.
    const last = snap.moves[snap.moves.length - 1];
    if (last && typeof last.wms === 'number' && typeof last.bms === 'number') {
      return { wms: last.wms, bms: last.bms };
    }
    return null;
  }

  /** Piece set the room was created with (so a rematch reuses the same look). */
  getPieceSet(): string { return this.snapshot?.piece_set ?? 'fantasy'; }
  /** Realm the room was created with. */
  getEnvironment(): string { return this.snapshot?.environment ?? 'gothic-night'; }
  /** The white seat's uid, or null. */
  getWhiteId(): string | null { return this.snapshot?.white_id ?? null; }
  /** The black seat's uid, or null. */
  getBlackId(): string | null { return this.snapshot?.black_id ?? null; }
  /** Whether I created (am white in) this room: only the creator opens the rematch room. */
  amICreator(): boolean { return this.role === 'white'; }

  /**
   * Create a new private room as white. Returns the 6-char code to share with
   * the opponent (also embeddable as URL `/r/<code>`).
   */
  async createRoom(opts: { pieceSet?: string; environment?: string } = {}): Promise<CreatedRoom> {
    const user = await signInAnon();
    this.myUserId = user.id;

    const sb = getClient();
    const code = generateRoomCode();
    const { data, error } = await sb
      .from('games')
      .insert({
        id: code,
        white_id: user.id,
        black_id: null,
        piece_set: opts.pieceSet ?? 'fantasy',
        environment: opts.environment ?? 'gothic-night',
      })
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new Error('Insert returned no row');

    this.snapshot = rowToSnapshot(data);
    this.role = 'white';
    await this.subscribe(code);
    return { roomCode: code, myColor: 'w' };
  }

  /**
   * Host a fresh room for a rematch with COLORS SWAPPED relative to the just-
   * finished game (F19). To respect the migration-001 RLS games_insert_as_white
   * policy (which requires white_id = auth.uid() AND black_id IS NULL at INSERT),
   * we do NOT pre-seat the opponent. Instead:
   *   - The designated host is the player who was BLACK in the old game; they
   *     create the new room as WHITE (so colors swap, and RLS is satisfied).
   *   - The host broadcasts the new code via a 'rematch-room' control message
   *     telling the other client to join as black.
   *   - The other client calls the normal joinRoom(code) black-claim path.
   *
   * Returns the new room code and MY color in the new room (always 'w').
   */
  async createRematchRoom(opts: { pieceSet?: string; environment?: string } = {}): Promise<{ roomCode: string; myColor: Color }> {
    const user = await signInAnon();
    this.myUserId = user.id;
    const sb = getClient();

    const oldWhite = this.snapshot?.white_id ?? null;
    const oldBlack = this.snapshot?.black_id ?? null;
    if (!oldWhite || !oldBlack) throw new Error('Cannot rematch: room is not fully seated');
    // Only the old black player hosts (so they become white -> colors swap, and
    // the RLS white_id = auth.uid() check passes).
    if (user.id !== oldBlack) {
      throw new Error('Only the old black player may host the rematch room');
    }

    const pieceSet = opts.pieceSet ?? this.getPieceSet();
    const environment = opts.environment ?? this.getEnvironment();

    // 1) Insert the fresh room as white FIRST (so we have a code to share).
    const code = generateRoomCode();
    const { data, error } = await sb
      .from('games')
      .insert({ id: code, white_id: user.id, black_id: null, piece_set: pieceSet, environment })
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new Error('Rematch insert returned no row');

    // 2) Announce the code to the opponent over the STILL-LIVE old channel,
    //    telling them to join as black (their color swaps too). Then tear down.
    await this.sendControl({ kind: 'rematch-room', roomCode: code, yourColor: 'b' });
    await this.unsubscribeChannel();

    // Clear stale peerJoined listeners from the old game (they capture the old
    // room code). onOpponentMove / onGameOver / onControl / onPresence are owned
    // by the NetworkPlayer (re-registered on its activate()), so we leave those.
    this.peerJoinedListeners = [];

    // 3) Re-point this session at the new room.
    this.snapshot = rowToSnapshot(data);
    this.role = 'white';
    this.lastAppliedPly = 0;
    this.opponentEverPresent = false;
    this.opponentOnline = false;
    this.clockColumnsPresent = null; // re-detect for the fresh row
    await this.subscribe(code);
    return { roomCode: code, myColor: 'w' };
  }

  /** Tear down just the realtime channel (used when re-pointing at a new room). */
  private async unsubscribeChannel(): Promise<void> {
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
  }

  /**
   * Best-effort presence-leave on tab close (F8). Synchronous-friendly: we fire
   * the untrack/unsubscribe without awaiting so it can run inside a
   * 'beforeunload' handler. The opponent's presence-leave event then triggers
   * their disconnect banner.
   */
  leaveBeacon(): void {
    try {
      void this.channel?.untrack();
      void this.channel?.unsubscribe();
    } catch { /* ignore */ }
  }

  /**
   * Join an existing room as black (if the slot is open) or as spectator
   * (if both slots are taken / you're already one of the players in another
   * tab). Caller can disambiguate via `getRole()` afterwards.
   */
  async joinRoom(code: string): Promise<JoinedRoom> {
    const user = await signInAnon();
    this.myUserId = user.id;

    const sb = getClient();
    const { data: row, error: loadErr } = await sb
      .from('games')
      .select('*')
      .eq('id', code.toUpperCase())
      .single();
    if (loadErr) throw loadErr;
    if (!row) throw new Error(`Room ${code} not found`);

    this.snapshot = rowToSnapshot(row);

    // Already in this game in another tab? Just attach.
    if (row.white_id === user.id) {
      this.role = 'white';
    } else if (row.black_id === user.id) {
      this.role = 'black';
    } else if (row.black_id === null) {
      // Try to claim the black slot.
      const { data: claimed, error: claimErr } = await sb
        .from('games')
        .update({ black_id: user.id })
        .eq('id', row.id)
        .is('black_id', null)
        .neq('white_id', user.id)
        .select()
        .single();
      if (claimErr) throw claimErr;
      this.snapshot = rowToSnapshot(claimed);
      this.role = 'black';
    } else {
      // Both slots taken and neither is me — fall back to spectator.
      this.role = 'spectator';
    }

    this.lastAppliedPly = this.snapshot!.moves.length;
    await this.subscribe(this.snapshot!.id);

    return {
      myColor: this.role === 'white' ? 'w' : 'b',
      fen: this.snapshot!.fen,
      moves: this.snapshot!.moves,
      opponentPresent:
        this.role === 'white'
          ? this.snapshot!.black_id !== null
          : this.snapshot!.white_id !== null,
    };
  }

  /**
   * Read-only attach to a game in progress. Phase 7-B path. RLS already
   * blocks writes from anyone whose auth.uid() isn't white_id/black_id, so
   * a spectator can't accidentally mutate the row.
   */
  async watchRoom(code: string): Promise<SpectatingRoom> {
    const user = await signInAnon(); // still need an auth.uid() so realtime authorizes us
    this.myUserId = user.id;
    const sb = getClient();
    const { data: row, error } = await sb
      .from('games')
      .select('*')
      .eq('id', code.toUpperCase())
      .single();
    if (error) throw error;
    if (!row) throw new Error(`Room ${code} not found`);

    this.snapshot = rowToSnapshot(row);
    this.role = 'spectator';
    this.lastAppliedPly = this.snapshot.moves.length;
    await this.subscribe(this.snapshot.id);

    return {
      fen: this.snapshot.fen,
      moves: this.snapshot.moves,
      whitePresent: this.snapshot.white_id !== null,
      blackPresent: this.snapshot.black_id !== null,
    };
  }

  /**
   * Send my move up to the server. Caller has already validated locally
   * with chess.js and computed the resulting FEN — we just persist it.
   *
   * RLS enforces:
   *   - the row's side-to-move (parsed from the old FEN) matches my color
   *   - I'm authenticated
   * So an out-of-turn or spoofed-color submission will be rejected by Postgres.
   */
  async submitMove(input: {
    uci: string;
    san: string;
    fenAfter: string;
    /** Clock checkpoint stamped by the mover (F18): remaining ms on both clocks. */
    wms?: number;
    bms?: number;
  }): Promise<void> {
    if (!this.snapshot) throw new Error('Not in a room');
    if (this.role === 'spectator') throw new Error('Spectators cannot move');

    const sb = getClient();
    const ply = this.snapshot.moves.length + 1;
    const hasClock = typeof input.wms === 'number' && typeof input.bms === 'number';
    const newMove: MoveRecord = {
      ply,
      uci: input.uci,
      san: input.san,
      fenAfter: input.fenAfter,
      at: new Date().toISOString(),
      ...(hasClock ? { wms: input.wms, bms: input.bms } : {}),
    };
    const nextMoves = [...this.snapshot.moves, newMove];

    // Base update: fen + moves (the clock stamp rides inside moves jsonb, so it
    // works against the CURRENT migration-001 schema with no extra column).
    const patch: Record<string, unknown> = { fen: input.fenAfter, moves: nextMoves };
    // If the optional post-002 clock columns exist, ALSO checkpoint there. We
    // feature-detect: only include them when we positively detected the columns,
    // otherwise the UPDATE would fail with "column does not exist" on a 001 DB.
    if (hasClock && this.clockColumnsPresent === true) {
      patch.white_ms = input.wms;
      patch.black_ms = input.bms;
    }

    // Also broadcast the clock checkpoint immediately so the opponent's ticking
    // clock re-syncs the instant our move lands, independent of the DB round-trip.
    if (hasClock) {
      void this.sendControl({ kind: 'clock', wms: input.wms, bms: input.bms });
    }

    // Mark this ply as "ours" BEFORE the network call so a fast Realtime echo
    // (broadcast races the REST response) is correctly suppressed in onRowUpdate.
    this.pliesInFlight.add(ply);
    try {
      const { data, error } = await sb
        .from('games')
        .update(patch)
        .eq('id', this.snapshot.id)
        .select()
        .single();
      if (error) throw error;
      this.snapshot = rowToSnapshot(data);
      this.lastAppliedPly = Math.max(this.lastAppliedPly, this.snapshot.moves.length);
    } finally {
      this.pliesInFlight.delete(ply);
    }
  }

  /**
   * Declare a result I am entitled to that is NOT a resignation: opponent
   * flagged (timeout) or abandoned. Uses a direct UPDATE. On a post-003 DB the
   * enforce_game_invariants trigger rejects any non-resign direct result write,
   * so this may error; callers treat the local modal as authoritative regardless
   * and the opponent receives the result via the broadcast 'flag'/'resign'
   * announcement plus their own local clock detection. Best-effort persistence.
   */
  async claimResult(result: '1-0' | '0-1' | '1/2-1/2' | 'abandoned'): Promise<void> {
    if (!this.snapshot) return;
    if (this.role === 'spectator') return;
    const sb = getClient();
    try {
      const { error } = await sb.from('games').update({ result }).eq('id', this.snapshot.id);
      if (error) throw error;
    } catch (err) {
      // Post-003 trigger blocks direct result writes. The opponent still learns
      // the outcome via the Broadcast announce; this is best-effort persistence.
      console.warn('[MultiplayerSession] claimResult direct UPDATE rejected (expected post-003):', err);
    }
  }

  /**
   * Mark the game over (draw agreement, or a natural end-of-game we detected
   * such as checkmate/stalemate that one side persists). Best-effort direct
   * UPDATE; on a post-003 DB the trigger rejects direct result writes, in which
   * case the opponent still learns the outcome via Broadcast + their own local
   * detection. Resignations should go through resign() (RPC-backed) instead.
   */
  async setResult(result: '1-0' | '0-1' | '1/2-1/2' | 'abandoned'): Promise<void> {
    await this.claimResult(result);
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
    if (this.queueChannel) {
      await this.queueChannel.unsubscribe();
      this.queueChannel = null;
    }
    if (this.queueRowId) {
      // Best-effort cancel of any open queue spot.
      try {
        await getClient().from('queue').delete().eq('id', this.queueRowId);
      } catch { /* ignore */ }
      this.queueRowId = null;
    }
    this.snapshot = null;
    this.role = null;
    this.opponentMoveListeners = [];
    this.peerJoinedListeners = [];
    this.gameOverListeners = [];
    this.presenceListeners = [];
    this.controlListeners = [];
    this.opponentEverPresent = false;
    this.opponentOnline = false;
  }

  // ---- matchmaking queue (Phase 7-C) --------------------------------------

  /**
   * Join the global matchmaking queue. Returns a promise that resolves with
   * { roomCode, myColor } when paired with a stranger. The server-side
   * `pair_queue` trigger handles atomic pairing + game creation; we just
   * INSERT a queue row and either (a) get a game_id back immediately because
   * a partner was already waiting, or (b) wait for a Realtime UPDATE on our
   * queue row when a later joiner is paired with us.
   *
   * Caller should also pass an onWaiting callback if they want to show a
   * "searching..." UI between the two paths.
   */
  async findGame(onWaiting?: () => void): Promise<CreatedRoom> {
    const user = await signInAnon();
    this.myUserId = user.id;
    const sb = getClient();

    const { data: inserted, error } = await sb
      .from('queue')
      .insert({ player_id: user.id })
      .select()
      .single();
    if (error) throw error;
    if (!inserted) throw new Error('queue insert returned no row');

    this.queueRowId = inserted.id;

    // Case A: trigger already paired us with someone waiting → game_id is set.
    if (inserted.game_id) {
      return await this.attachToGame(inserted.game_id);
    }

    // Case B: nobody waiting → subscribe to my queue row's UPDATE.
    if (onWaiting) onWaiting();
    return await new Promise<CreatedRoom>((resolve, reject) => {
      const cleanup = async () => {
        if (this.queueChannel) {
          await this.queueChannel.unsubscribe();
          this.queueChannel = null;
        }
      };
      this.queueChannel = sb
        .channel(`queue:${inserted.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'queue', filter: `id=eq.${inserted.id}` },
          async (payload) => {
            const row = payload.new as { game_id: string | null };
            if (!row.game_id) return;
            try {
              await cleanup();
              this.queueRowId = null;
              const res = await this.attachToGame(row.game_id);
              resolve(res);
            } catch (e) {
              reject(e);
            }
          },
        )
        .subscribe();
    });
  }

  /** Cancel a pending queue search (does nothing if not queued). */
  async cancelQueue(): Promise<void> {
    if (this.queueChannel) {
      await this.queueChannel.unsubscribe();
      this.queueChannel = null;
    }
    if (this.queueRowId) {
      try { await getClient().from('queue').delete().eq('id', this.queueRowId); } catch { /* */ }
      this.queueRowId = null;
    }
  }

  private async attachToGame(code: string): Promise<CreatedRoom> {
    const sb = getClient();
    const { data: row, error } = await sb.from('games').select('*').eq('id', code).single();
    if (error) throw error;
    if (!row) throw new Error(`Game ${code} not found after pairing`);

    this.snapshot = rowToSnapshot(row);
    const me = currentUserId();
    if (row.white_id === me) this.role = 'white';
    else if (row.black_id === me) this.role = 'black';
    else this.role = 'spectator';

    this.lastAppliedPly = this.snapshot.moves.length;
    await this.subscribe(code);
    return { roomCode: code, myColor: this.role === 'white' ? 'w' : 'b' };
  }

  // ---- internals -----------------------------------------------------------

  private async subscribe(roomCode: string): Promise<void> {
    const sb = getClient();
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
    // Detect optional clock columns from the snapshot we already fetched.
    if (this.snapshot && this.clockColumnsPresent === null) {
      this.clockColumnsPresent =
        this.snapshot.white_ms !== undefined && this.snapshot.black_ms !== undefined;
    }

    // One channel carries THREE transports for the room:
    //   1. postgres_changes  -> authoritative move sync (unchanged from 7-A)
    //   2. presence          -> opponent online/offline dot + disconnect detection (F8)
    //   3. broadcast         -> ephemeral control (draw/resign/rematch/flag/clock)
    // The presence key is our auth uid so each player/spectator is one entry.
    const myKey = this.myUserId ?? 'anon';
    const channel = sb.channel(`game:${roomCode}`, {
      config: { presence: { key: myKey } },
    });

    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${roomCode}` },
        (payload) => this.onRowUpdate(payload.new as RowShape),
      )
      .on('presence', { event: 'sync' }, () => this.onPresenceSync())
      .on('presence', { event: 'join' }, () => this.onPresenceSync())
      .on('presence', { event: 'leave' }, () => this.onPresenceSync())
      .on('broadcast', { event: 'mp-control' }, (payload) => {
        const msg = payload.payload as ControlMessage;
        for (const fn of this.controlListeners) fn(msg);
      });

    this.channel = channel;

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Announce our presence on the channel so the opponent sees us online.
        const myRole = this.role ?? 'spectator';
        void channel.track({ uid: myKey, role: myRole, at: Date.now() });
      }
    });
  }

  /**
   * Recompute opponent presence from the channel's presence state and emit a
   * transition event when it flips. For a player, the "opponent" is whichever
   * seat is not mine; for a spectator, it is either player being present. (F8)
   */
  private onPresenceSync(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState() as Record<string, Array<{ uid?: string; role?: string }>>;
    const presentUids = new Set<string>();
    for (const key of Object.keys(state)) {
      for (const entry of state[key] ?? []) {
        if (entry.uid) presentUids.add(entry.uid);
        else presentUids.add(key);
      }
    }

    let opponentOnline: boolean;
    if (this.role === 'white') {
      const opp = this.snapshot?.black_id ?? null;
      opponentOnline = opp !== null && presentUids.has(opp);
    } else if (this.role === 'black') {
      const opp = this.snapshot?.white_id ?? null;
      opponentOnline = opp !== null && presentUids.has(opp);
    } else {
      // Spectator: "opponent online" means at least one of the seated players is here.
      const w = this.snapshot?.white_id ?? null;
      const b = this.snapshot?.black_id ?? null;
      opponentOnline = (w !== null && presentUids.has(w)) || (b !== null && presentUids.has(b));
    }

    if (opponentOnline) this.opponentEverPresent = true;
    if (opponentOnline !== this.opponentOnline) {
      this.opponentOnline = opponentOnline;
      // Suppress the very first "offline" before the opponent has ever arrived
      // (a fresh room where we are simply waiting for someone to join).
      if (!opponentOnline && !this.opponentEverPresent) return;
      for (const fn of this.presenceListeners) fn(opponentOnline);
    }
  }

  /**
   * Send an ephemeral control message to the other side over Broadcast. Never
   * persisted, never blocks on the database. Safe no-op if not subscribed.
   */
  async sendControl(msg: Omit<ControlMessage, 'from'>): Promise<void> {
    if (!this.channel) return;
    const from: ControlMessage['from'] =
      this.role === 'white' ? 'w' : this.role === 'black' ? 'b' : 'spectator';
    await this.channel.send({
      type: 'broadcast',
      event: 'mp-control',
      payload: { ...msg, from } as ControlMessage,
    });
  }

  /**
   * Set the game result via the SECURITY DEFINER resign_game() RPC when it
   * exists (post-002), falling back to a direct UPDATE on the legacy schema.
   * The RPC sets the OPPONENT-wins string for the caller, so it is the correct
   * call for "I resign". For claim-win / timeout / abandonment where I am NOT
   * the loser, we pass an explicit result and use the direct-UPDATE fallback
   * (the RPC always resolves to the caller losing). (F8/resign)
   *
   * - resign(): I am giving up -> resign_game RPC (preferred) or direct UPDATE.
   * - claimResult(result): I am declaring a result the rules entitle me to
   *   (opponent flagged or abandoned). Uses direct UPDATE; on a post-003 DB the
   *   trigger will reject a non-resign direct result write, so we surface the
   *   error to the caller, who keeps the local modal up regardless.
   */
  async resign(): Promise<void> {
    if (!this.snapshot) return;
    if (this.role === 'spectator') return;
    const sb = getClient();
    const id = this.snapshot.id;
    try {
      const { error } = await sb.rpc('resign_game', { p_game_id: id });
      if (error) throw error;
      return;
    } catch (err) {
      // RPC missing pre-002 (PostgREST PGRST202) -> direct UPDATE fallback.
      const result: '0-1' | '1-0' = this.role === 'white' ? '0-1' : '1-0';
      await sb.from('games').update({ result }).eq('id', id);
      void err;
    }
  }

  private onRowUpdate(row: RowShape): void {
    const next = rowToSnapshot(row);
    const prev = this.snapshot;
    this.snapshot = next;

    // Peer just joined as black? Fire peerJoined once, and re-evaluate presence
    // now that we know the black seat's uid (so the online dot reflects them).
    if (prev && prev.black_id === null && next.black_id !== null) {
      for (const fn of this.peerJoinedListeners) fn();
      this.onPresenceSync();
    }

    // New moves we haven't applied yet?
    while (next.moves.length > this.lastAppliedPly) {
      const m = next.moves[this.lastAppliedPly]!;
      this.lastAppliedPly += 1;
      // If this ply is one we just submitted (Realtime echo arrived before REST
      // response), suppress — we already applied locally via the optimistic path.
      if (this.pliesInFlight.has(m.ply)) continue;
      for (const fn of this.opponentMoveListeners) fn(m);
    }

    if (prev && prev.result === null && next.result !== null) {
      for (const fn of this.gameOverListeners) fn(next.result);
    }
  }

  private removeListener<T>(arr: T[], fn: T): void {
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
}

// ---- helpers ---------------------------------------------------------------

interface RowShape {
  id: string;
  white_id: string | null;
  black_id: string | null;
  fen: string;
  moves: MoveRecord[];
  result: string | null;
  piece_set: string;
  environment: string;
  white_ms?: number | null;
  black_ms?: number | null;
}

function rowToSnapshot(row: RowShape): RoomSnapshot {
  return {
    id: row.id,
    white_id: row.white_id,
    black_id: row.black_id,
    fen: row.fen,
    moves: Array.isArray(row.moves) ? row.moves : [],
    result: row.result,
    piece_set: row.piece_set,
    environment: row.environment,
    white_ms: 'white_ms' in row ? row.white_ms ?? null : undefined,
    black_ms: 'black_ms' in row ? row.black_ms ?? null : undefined,
  };
}

/**
 * Generates a friendly 6-character room code from a curated alphabet that
 * avoids visually ambiguous characters (no 0/O, 1/I/L). 36^6 ~ 2 billion codes;
 * collision probability over a friends-tier user base is effectively zero.
 */
function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    out += alphabet[buf[i]! % alphabet.length];
  }
  return out;
}
