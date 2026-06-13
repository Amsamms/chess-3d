/**
 * Daily Puzzle system (F3).
 *
 * Fetches the lichess daily puzzle (GET https://lichess.org/api/puzzle/daily,
 * CORS-open, no key), derives the starting FEN from the PGN + initialPly, and
 * drives an interactive solve loop:
 *
 *   - The player is the side-to-move in the puzzle position.
 *   - Each correct player move triggers the scripted opponent reply with a normal
 *     3D animation (via game.devMove).
 *   - A wrong move fires onWrongMove, is reverted by the caller (main.ts), and
 *     the player can retry (attempt count increments).
 *   - Completing the puzzle: fires onSolved + celebratory toast.
 *
 * On fetch failure (offline / CORS error), a deterministic fallback puzzle is
 * used (selected by dayOfYear % FALLBACK_PUZZLES.length).
 *
 * Streak is stored in the ProfileStore generic counters:
 *   'puzzle.streak'              -> current daily puzzle streak
 *   'puzzle.bestStreak'          -> best daily puzzle streak ever
 *   'puzzle.lastSolvedDate_ts'   -> last solved date as yyyymmdd integer
 *
 * The daily "solved" flag is stored in localStorage under:
 *   chess3d.puzzle.<isoDate>   -> stringified PuzzleSave { attempts, solved }
 * This key is separate from the profile blob so it can be cleared without
 * losing the overall player profile.
 */

import { Chess } from 'chess.js';
import type { Game } from '../game/Game';
import type { ProfileStore } from '../meta/Profile';
import { FALLBACK_PUZZLES, fallbackForDate, type FallbackPuzzle } from './fallback';

// ---------- types / constants -----------------------------------------------

export const LICHESS_DAILY_URL = 'https://lichess.org/api/puzzle/daily';
export const PUZZLE_STORAGE_PREFIX = 'chess3d.puzzle.';
export const PUZZLE_STREAK_KEY = 'puzzle.streak';
export const PUZZLE_BEST_KEY = 'puzzle.bestStreak';
export const PUZZLE_LAST_DATE_KEY = 'puzzle.lastSolvedDate_ts';

export interface PuzzleSource {
  /** ISO YYYY-MM-DD of the puzzle (UTC). */
  date: string;
  /** Starting FEN (side-to-move is the player). */
  fen: string;
  /** Ordered list of UCI moves: player, reply, player, reply, ... */
  solution: string[];
  /** Human-readable title. */
  title: string;
  /** Where the puzzle came from. */
  source: 'lichess' | 'fallback';
  /** Lichess puzzle ID, when source === 'lichess'. */
  lichessId?: string;
}

export interface PuzzleSave {
  /** True if the player successfully solved the puzzle today. */
  solved: boolean;
  /** How many wrong player attempts were made (not counting the final correct one). */
  attempts: number;
}

export interface PuzzleStreakInfo {
  currentStreak: number;
  bestStreak: number;
  todaySolved: boolean;
}

// ---------- localStorage helpers --------------------------------------------

export function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadPuzzleSave(date: string): PuzzleSave {
  try {
    const raw = localStorage.getItem(PUZZLE_STORAGE_PREFIX + date);
    if (!raw) return { solved: false, attempts: 0 };
    const p = JSON.parse(raw) as Partial<PuzzleSave>;
    return {
      solved: p.solved === true,
      attempts: typeof p.attempts === 'number' ? p.attempts : 0,
    };
  } catch {
    return { solved: false, attempts: 0 };
  }
}

function savePuzzleSave(date: string, save: PuzzleSave): void {
  try {
    localStorage.setItem(PUZZLE_STORAGE_PREFIX + date, JSON.stringify(save));
  } catch { /* storage full: ignore */ }
}

/** Convert an ISO YYYY-MM-DD string to yyyymmdd integer for comparison. */
function isoToInt(iso: string): number {
  return parseInt(iso.replace(/-/g, ''), 10);
}

/** Yesterday's ISO date string (UTC). */
function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Lichess fetch + PGN parsing -------------------------------------

interface LichessResponse {
  game: { pgn: string };
  puzzle: { solution: string[]; initialPly: number; id: string };
}

/**
 * Replay a PGN string to ply N (half-moves from the starting position) and
 * return the resulting FEN. The puzzle position is the FEN AFTER replaying
 * exactly `initialPly` half-moves, which is the position where the opponent
 * made their last move and it is now the player's turn to solve.
 */
function fenAfterPlies(pgn: string, plies: number): string | null {
  try {
    const chess = new Chess();
    // Strip PGN headers; chess.js accepts bare move text.
    const stripped = pgn.replace(/\[.*?\]\s*/g, '').trim();
    // Tokenise SAN moves: remove move numbers (e.g. "1.") and result tokens.
    const tokens = stripped
      .split(/\s+/)
      .filter((t) => t && !/^\d+\./.test(t) && !/^(1-0|0-1|1\/2|%)/.test(t));
    const limit = Math.min(plies, tokens.length);
    for (let i = 0; i < limit; i++) {
      const tok = tokens[i]!;
      if (!chess.move(tok)) {
        console.warn('[DailyPuzzle] PGN token failed:', tok, 'at ply', i);
        return null;
      }
    }
    return chess.fen();
  } catch (err) {
    console.warn('[DailyPuzzle] PGN replay failed:', err);
    return null;
  }
}

/** Fetch + parse the lichess daily puzzle. Returns null on any error. */
async function fetchLichessDailyPuzzle(): Promise<PuzzleSource | null> {
  try {
    const resp = await fetch(LICHESS_DAILY_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.warn('[DailyPuzzle] Lichess API responded', resp.status);
      return null;
    }
    const data = (await resp.json()) as LichessResponse;
    if (
      !data?.game?.pgn ||
      !Array.isArray(data?.puzzle?.solution) ||
      typeof data?.puzzle?.initialPly !== 'number'
    ) {
      console.warn('[DailyPuzzle] Unexpected lichess response shape');
      return null;
    }
    const fen = fenAfterPlies(data.game.pgn, data.puzzle.initialPly);
    if (!fen) return null;
    return {
      date: todayIso(),
      fen,
      solution: data.puzzle.solution as string[],
      title: 'Lichess Daily Puzzle',
      source: 'lichess',
      lichessId: data.puzzle.id,
    };
  } catch (err) {
    console.warn('[DailyPuzzle] Fetch failed:', err);
    return null;
  }
}

// ---------- UCI move helpers ------------------------------------------------

function uciFrom(move: string): string { return move.slice(0, 2); }
function uciTo(move: string): string { return move.slice(2, 4); }
function uciPromo(move: string): string | undefined { return move.length === 5 ? move[4] : undefined; }

// ---------- DailyPuzzle class -----------------------------------------------

export type PuzzleState = 'idle' | 'active' | 'solved' | 'abandoned';

/** Callback shape for every UI event the DailyPuzzle emits. */
export interface PuzzleCallbacks {
  onWrongMove?: (attempts: number) => void;
  onCorrectMove?: (nextMoveIndex: number, total: number) => void;
  onSolved?: (attempts: number, streak: number) => void;
  onOpponentReply?: (move: string) => void;
  onStatusChange?: (state: PuzzleState) => void;
}

/**
 * DailyPuzzle drives the solve loop for one puzzle per session. It talks to
 * the Game instance via the narrow public methods loadPuzzleFen() and devMove()
 * already available on Game. It does NOT own the camera / environment.
 */
export class DailyPuzzle {
  private state: PuzzleState = 'idle';
  private puzzle: PuzzleSource | null = null;
  private save: PuzzleSave = { solved: false, attempts: 0 };
  /**
   * The index in puzzle.solution of the NEXT step the player should play.
   * Even indices are player moves, odd indices are scripted opponent replies.
   */
  private stepIndex = 0;
  private cbs: PuzzleCallbacks = {};

  constructor(
    private readonly profile: ProfileStore,
    // Sound engine reference kept for future fanfare hooks; not used directly
    // here since callers register onSolved callbacks for audio.
    _sound: unknown,
  ) { void _sound; }

  // ---------- public API called by main.ts / UI ----------------------------

  /** Register event callbacks (replaces previous ones). */
  setCallbacks(cbs: PuzzleCallbacks) { this.cbs = cbs; }

  getState(): PuzzleState { return this.state; }
  getPuzzle(): PuzzleSource | null { return this.puzzle; }

  /** Current step index (the next player move step index in solution array). */
  getCurrentStep(): number { return this.stepIndex; }

  /** Read-only snapshot of the current save record (for UI display). */
  getSaveInfo(): Readonly<PuzzleSave> { return this.save; }

  /** True when today's puzzle is already recorded as solved in localStorage. */
  isTodaySolved(): boolean {
    return loadPuzzleSave(todayIso()).solved;
  }

  /** Streak info derived from the ProfileStore generic counters. */
  getStreakInfo(): PuzzleStreakInfo {
    return {
      currentStreak: this.profile.getCounter(PUZZLE_STREAK_KEY),
      bestStreak: this.profile.getCounter(PUZZLE_BEST_KEY),
      todaySolved: this.isTodaySolved(),
    };
  }

  /**
   * Load today's puzzle (fetch lichess first, fall back to bundled set) and
   * set up the game board to the puzzle starting position via
   * game.loadPuzzleFen(). Returns the loaded PuzzleSource.
   */
  async load(game: Game, forceOffline = false): Promise<PuzzleSource> {
    this.state = 'idle';
    this.stepIndex = 0;

    let src: PuzzleSource | null = null;
    if (!forceOffline) {
      src = await fetchLichessDailyPuzzle();
    }
    if (!src) {
      const fb: FallbackPuzzle = fallbackForDate();
      src = {
        date: todayIso(),
        fen: fb.fen,
        solution: fb.solution,
        title: fb.title,
        source: 'fallback',
      };
      console.info('[DailyPuzzle] Using fallback puzzle:', fb.title);
    }

    this.puzzle = src;
    this.save = loadPuzzleSave(src.date);

    // Set the puzzle position on the board.
    game.loadPuzzleFen(src.fen);

    return src;
  }

  /**
   * Start the interactive solve session. Must be called after load().
   * Sets state to 'active' and fires onStatusChange. stepIndex reset to 0.
   */
  startSession() {
    if (!this.puzzle) throw new Error('[DailyPuzzle] call load() before startSession()');
    this.stepIndex = 0;
    this.state = 'active';
    this.cbs.onStatusChange?.(this.state);
  }

  /**
   * Called by main.ts after the player makes a move (UCI string from+to+promo).
   * Validates it against the solution. Returns true if correct, false if wrong.
   *
   * On correct move: triggers the scripted opponent reply via game.devMove (if
   * there is one), fires onCorrectMove, and if the puzzle is complete fires
   * onSolved and updates the streak.
   *
   * On wrong move: fires onWrongMove. The caller (main.ts) is responsible for
   * calling game.undoPuzzleMove() to visually revert the move.
   */
  async handlePlayerMove(uci: string, game: Game): Promise<boolean> {
    if (this.state !== 'active') return false;
    if (!this.puzzle) return false;

    // The step at stepIndex should be a player move (even index).
    const expected = this.puzzle.solution[this.stepIndex];
    if (!expected) return false;

    const eFrom = uciFrom(expected);
    const eTo = uciTo(expected);
    const ePromo = uciPromo(expected);

    const pFrom = uciFrom(uci);
    const pTo = uciTo(uci);
    const pPromo = uciPromo(uci);

    const correct =
      pFrom === eFrom &&
      pTo === eTo &&
      (ePromo === undefined || pPromo === ePromo);

    if (!correct) {
      this.save.attempts += 1;
      savePuzzleSave(this.puzzle.date, this.save);
      this.cbs.onWrongMove?.(this.save.attempts);
      return false;
    }

    // Player move accepted.
    this.stepIndex += 1;

    // Check if the puzzle is now fully solved.
    if (this.stepIndex >= this.puzzle.solution.length) {
      await this.solvePuzzle();
      return true;
    }

    // Play the scripted opponent reply.
    const replyUci = this.puzzle.solution[this.stepIndex]!;
    this.cbs.onOpponentReply?.(replyUci);
    this.stepIndex += 1;

    // Execute opponent reply via devMove (causes 3D animation).
    await game.devMove({
      from: uciFrom(replyUci),
      to: uciTo(replyUci),
      ...(uciPromo(replyUci) ? { promotion: uciPromo(replyUci) } : {}),
    });

    // Check again after the reply.
    if (this.stepIndex >= this.puzzle.solution.length) {
      await this.solvePuzzle();
    } else {
      this.cbs.onCorrectMove?.(this.stepIndex, this.puzzle.solution.length);
    }

    return true;
  }

  /** Exit puzzle mode without solving. */
  abandon() {
    if (this.state !== 'active') return;
    this.state = 'abandoned';
    this.cbs.onStatusChange?.(this.state);
  }

  // ---------- private helpers -----------------------------------------------

  private async solvePuzzle() {
    if (!this.puzzle) return;
    // Do NOT count the final correct move as an "attempt" in the wrong sense.
    // save.attempts already tracks wrong moves; solved is the completion flag.
    this.save.solved = true;
    savePuzzleSave(this.puzzle.date, this.save);

    // Update streak in ProfileStore generic counters.
    const todayInt = isoToInt(todayIso());
    const yesterdayInt = isoToInt(yesterdayIso());
    const lastInt = this.profile.getCounter(PUZZLE_LAST_DATE_KEY);

    if (lastInt === 0) {
      // First ever solve.
      this.profile.setCounter(PUZZLE_STREAK_KEY, 1);
    } else if (lastInt === yesterdayInt) {
      // Consecutive day.
      const newStreak = this.profile.getCounter(PUZZLE_STREAK_KEY) + 1;
      this.profile.setCounter(PUZZLE_STREAK_KEY, newStreak);
    } else if (lastInt !== todayInt) {
      // Gap: reset to 1.
      this.profile.setCounter(PUZZLE_STREAK_KEY, 1);
    }
    // If lastInt === todayInt: already solved today; don't double-count.

    const streak = this.profile.getCounter(PUZZLE_STREAK_KEY);
    if (streak > this.profile.getCounter(PUZZLE_BEST_KEY)) {
      this.profile.setCounter(PUZZLE_BEST_KEY, streak);
    }
    this.profile.setCounter(PUZZLE_LAST_DATE_KEY, todayInt);

    this.state = 'solved';
    this.cbs.onStatusChange?.(this.state);
    // attempts in the callback is the number of WRONG moves (not including the final correct one).
    this.cbs.onSolved?.(this.save.attempts, streak);
  }

  /** Return the fallback puzzle IDs (for dev/testing). */
  static getFallbackIds(): string[] {
    return FALLBACK_PUZZLES.map((p) => p.id);
  }

  /** Today's ISO date string (UTC). */
  static todayIso(): string { return todayIso(); }
}
