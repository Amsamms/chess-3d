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
   * Create a new private room as white. Returns the 6-char code to share with
   * the opponent (also embeddable as URL `/r/<code>`).
   */
  async createRoom(opts: { pieceSet?: string; environment?: string } = {}): Promise<CreatedRoom> {
    const user = await signInAnon();
    void user; // identity stored in supabase auth session; we only need the row info

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
   * Join an existing room as black (if the slot is open) or as spectator
   * (if both slots are taken / you're already one of the players in another
   * tab). Caller can disambiguate via `getRole()` afterwards.
   */
  async joinRoom(code: string): Promise<JoinedRoom> {
    const user = await signInAnon();
    void user; // identity stored in supabase auth session; we only need the row info

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
    await signInAnon(); // still need an auth.uid() so realtime authorizes us
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
  async submitMove(input: { uci: string; san: string; fenAfter: string }): Promise<void> {
    if (!this.snapshot) throw new Error('Not in a room');
    if (this.role === 'spectator') throw new Error('Spectators cannot move');

    const sb = getClient();
    const ply = this.snapshot.moves.length + 1;
    const newMove: MoveRecord = {
      ply,
      uci: input.uci,
      san: input.san,
      fenAfter: input.fenAfter,
      at: new Date().toISOString(),
    };
    const nextMoves = [...this.snapshot.moves, newMove];

    // Mark this ply as "ours" BEFORE the network call so a fast Realtime echo
    // (broadcast races the REST response) is correctly suppressed in onRowUpdate.
    this.pliesInFlight.add(ply);
    try {
      const { data, error } = await sb
        .from('games')
        .update({ fen: input.fenAfter, moves: nextMoves })
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

  /** Mark the game over (resignation, agreement, or end-of-game we detected). */
  async setResult(result: '1-0' | '0-1' | '1/2-1/2' | 'abandoned'): Promise<void> {
    if (!this.snapshot) return;
    if (this.role === 'spectator') return;
    const sb = getClient();
    await sb.from('games').update({ result }).eq('id', this.snapshot.id);
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
    void user;
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
    this.channel = sb
      .channel(`game:${roomCode}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${roomCode}` },
        (payload) => this.onRowUpdate(payload.new as RowShape),
      )
      .subscribe();
  }

  private onRowUpdate(row: RowShape): void {
    const next = rowToSnapshot(row);
    const prev = this.snapshot;
    this.snapshot = next;

    // Peer just joined as black? Fire peerJoined once.
    if (prev && prev.black_id === null && next.black_id !== null) {
      for (const fn of this.peerJoinedListeners) fn();
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
