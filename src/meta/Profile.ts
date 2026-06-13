/**
 * Profile + retention store (F2 / F3 backbone / F15 unlock ladder).
 *
 * A small, versioned localStorage-backed record of how a player has used the
 * game across sessions: games played, win/loss/draw breakdowns per mode and per
 * AI tier, win streaks, captures, and a first/last-played timestamp pair. Plus a
 * generic counters map so future features (daily puzzle, achievements) can stash
 * a count without a schema change here.
 *
 * Everything is intentionally tiny and synchronous: load() reads once on boot,
 * mutations write through immediately. No external dependency, no network.
 *
 * SEEDING / TESTING ESCAPE HATCH
 * ------------------------------
 * The store lives under localStorage key `chess3d.profile.v1` as a single JSON
 * blob matching the Profile interface below. A tester can write any valid blob
 * directly to unlock everything, fake a streak, etc. See README in notes.
 */

import type { GameMode, AIDifficulty } from '../ui/UI';

/** localStorage key for the persisted profile. Bump the suffix on shape change. */
export const PROFILE_KEY = 'chess3d.profile.v1';

/** Current schema version baked into the blob, so a future migrate() can branch. */
export const PROFILE_VERSION = 1;

/** Win / loss / draw triple, reused per-mode and per-tier. */
export interface WLD {
  wins: number;
  losses: number;
  draws: number;
}

/** A "tier" is one of the four AI difficulties; we track per-tier W/L/D. */
export type AITier = AIDifficulty;

/**
 * The persisted profile. All fields are required and defaulted by emptyProfile()
 * so a partial/old blob is healed on load() rather than throwing.
 */
export interface Profile {
  version: number;
  /** Total finished games (every mode, including hot-seat). */
  gamesPlayed: number;
  /** Per-mode W/L/D. 'online' here means a real networked game. */
  byMode: Record<GameMode, WLD>;
  /** Per-AI-tier W/L/D (only AI games contribute). */
  byTier: Record<AITier, WLD>;
  /** Current consecutive win streak (AI + online wins; hot-seat never counts). */
  currentStreak: number;
  /** Best win streak ever reached. */
  bestStreak: number;
  /** Total pieces this player has captured across all games. */
  totalCaptures: number;
  /** First time a game was finished (ISO 8601), or null if none yet. */
  firstPlayed: string | null;
  /** Most recent finished game (ISO 8601), or null if none yet. */
  lastPlayed: string | null;
  /** Generic counters for future features (e.g. daily puzzle streak). */
  counters: Record<string, number>;
}

/** Outcome of a finished game from THIS player's perspective. */
export type Outcome = 'win' | 'loss' | 'draw';

/** What recordGameEnd needs to know to update the right buckets. */
export interface GameEndInput {
  mode: GameMode;
  /** AI tier, when mode is one of the AI modes; ignored otherwise. */
  tier?: AITier;
  outcome: Outcome;
  /** Captures the local player made this game, folded into totalCaptures. */
  capturesThisGame?: number;
}

const ALL_MODES: GameMode[] = ['hotseat', 'ai-vs-white', 'ai-vs-black', 'online'];
const ALL_TIERS: AITier[] = ['beginner', 'intermediate', 'advanced', 'master'];

function emptyWLD(): WLD {
  return { wins: 0, losses: 0, draws: 0 };
}

/** A fresh profile with every bucket zeroed. */
export function emptyProfile(): Profile {
  const byMode = {} as Record<GameMode, WLD>;
  for (const m of ALL_MODES) byMode[m] = emptyWLD();
  const byTier = {} as Record<AITier, WLD>;
  for (const t of ALL_TIERS) byTier[t] = emptyWLD();
  return {
    version: PROFILE_VERSION,
    gamesPlayed: 0,
    byMode,
    byTier,
    currentStreak: 0,
    bestStreak: 0,
    totalCaptures: 0,
    firstPlayed: null,
    lastPlayed: null,
    counters: {},
  };
}

/**
 * Merge a (possibly partial / older) raw blob onto a fresh profile so missing
 * keys are healed instead of throwing. Defensive against hand-edited seeds.
 */
function heal(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Profile>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  base.gamesPlayed = num(r.gamesPlayed, 0);
  base.currentStreak = num(r.currentStreak, 0);
  base.bestStreak = num(r.bestStreak, 0);
  base.totalCaptures = num(r.totalCaptures, 0);
  base.firstPlayed = typeof r.firstPlayed === 'string' ? r.firstPlayed : null;
  base.lastPlayed = typeof r.lastPlayed === 'string' ? r.lastPlayed : null;
  if (r.byMode && typeof r.byMode === 'object') {
    for (const m of ALL_MODES) {
      const w = (r.byMode as Record<string, Partial<WLD>>)[m];
      if (w) base.byMode[m] = { wins: num(w.wins, 0), losses: num(w.losses, 0), draws: num(w.draws, 0) };
    }
  }
  if (r.byTier && typeof r.byTier === 'object') {
    for (const t of ALL_TIERS) {
      const w = (r.byTier as Record<string, Partial<WLD>>)[t];
      if (w) base.byTier[t] = { wins: num(w.wins, 0), losses: num(w.losses, 0), draws: num(w.draws, 0) };
    }
  }
  if (r.counters && typeof r.counters === 'object') {
    for (const [k, v] of Object.entries(r.counters)) {
      if (typeof v === 'number' && Number.isFinite(v)) base.counters[k] = v;
    }
  }
  return base;
}

/**
 * The retention store. Constructed lazily by load(); a single instance is held
 * for the app lifetime. Holds the in-memory copy and writes through on change.
 */
export class ProfileStore {
  private data: Profile;
  /** True only when no prior blob existed at construction (drives onboarding). */
  readonly isFirstRun: boolean;
  private listeners: Array<(p: Profile) => void> = [];

  private constructor(data: Profile, isFirstRun: boolean) {
    this.data = data;
    this.isFirstRun = isFirstRun;
  }

  /** Read (or initialize) the profile from localStorage. Safe if storage is unavailable. */
  static load(): ProfileStore {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PROFILE_KEY);
    } catch {
      // Private mode / disabled storage: run in-memory, treat as first run.
      return new ProfileStore(emptyProfile(), true);
    }
    if (raw === null) {
      const store = new ProfileStore(emptyProfile(), true);
      return store;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt blob: start clean but do NOT flag first-run onboarding.
      return new ProfileStore(emptyProfile(), false);
    }
    return new ProfileStore(heal(parsed), false);
  }

  /** Current immutable-ish snapshot. Callers must not mutate the returned object. */
  get(): Profile {
    return this.data;
  }

  /** Persist the in-memory copy. Swallows quota / disabled-storage errors. */
  save(): void {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or disabled: keep running in-memory.
    }
    for (const fn of this.listeners) fn(this.data);
  }

  /** Subscribe to "profile changed" so the HUD chip can re-render. */
  onChange(fn: (p: Profile) => void): void {
    this.listeners.push(fn);
  }

  /**
   * Record a finished game. Updates the per-mode and (for AI games) per-tier
   * W/L/D, the games-played total, captures, the first/last timestamps, and the
   * win streak. STREAK RULES: a win extends the streak ONLY for AI + online
   * games; a hot-seat game counts as played but never touches the streak (no
   * "opponent" to beat). A loss in any streak-eligible mode resets the streak to
   * zero; a draw leaves the streak unchanged.
   */
  recordGameEnd(input: GameEndInput): void {
    const now = new Date().toISOString();
    this.data.gamesPlayed += 1;
    if (this.data.firstPlayed === null) this.data.firstPlayed = now;
    this.data.lastPlayed = now;
    if (input.capturesThisGame && input.capturesThisGame > 0) {
      this.data.totalCaptures += input.capturesThisGame;
    }

    const bucket = this.data.byMode[input.mode];
    const tierBucket =
      (input.mode === 'ai-vs-white' || input.mode === 'ai-vs-black') && input.tier
        ? this.data.byTier[input.tier]
        : null;
    if (input.outcome === 'win') {
      bucket.wins += 1;
      if (tierBucket) tierBucket.wins += 1;
    } else if (input.outcome === 'loss') {
      bucket.losses += 1;
      if (tierBucket) tierBucket.losses += 1;
    } else {
      bucket.draws += 1;
      if (tierBucket) tierBucket.draws += 1;
    }

    // Streak only moves for AI + online games (hot-seat is excluded).
    const streakEligible = input.mode !== 'hotseat';
    if (streakEligible) {
      if (input.outcome === 'win') {
        this.data.currentStreak += 1;
        if (this.data.currentStreak > this.data.bestStreak) {
          this.data.bestStreak = this.data.currentStreak;
        }
      } else if (input.outcome === 'loss') {
        this.data.currentStreak = 0;
      }
      // draw: streak unchanged.
    }
    this.save();
  }

  /**
   * Fold N captures the local player just made into the running total. Used by
   * the live capture hook so totalCaptures stays accurate even if a game is
   * abandoned before recordGameEnd fires. recordGameEnd does NOT double-count:
   * main.ts passes capturesThisGame=0 there because captures are recorded live.
   */
  recordCapture(count = 1): void {
    if (count <= 0) return;
    this.data.totalCaptures += count;
    this.save();
  }

  /** Read a generic counter (0 if unset). */
  getCounter(key: string): number {
    return this.data.counters[key] ?? 0;
  }

  /** Set a generic counter to an absolute value and persist. */
  setCounter(key: string, value: number): void {
    this.data.counters[key] = value;
    this.save();
  }

  /** Bump a generic counter by delta (default +1) and persist. */
  bumpCounter(key: string, delta = 1): void {
    this.data.counters[key] = (this.data.counters[key] ?? 0) + delta;
    this.save();
  }

  // -------- Derived helpers used by the unlock ladder (F15) ---------------

  /** Total wins against the AI across all tiers. */
  totalAiWins(): number {
    let n = 0;
    for (const t of ALL_TIERS) n += this.data.byTier[t].wins;
    return n;
  }

  /** Wins against a specific AI tier. */
  tierWins(tier: AITier): number {
    return this.data.byTier[tier].wins;
  }

  /**
   * Any "real" win (AI or online); hot-seat wins are excluded because there is
   * no opponent to beat there. Mirrors the streak-eligibility rule. Used to gate
   * the "first win" rewards.
   */
  anyWin(): boolean {
    if (this.data.byMode['online'].wins > 0) return true;
    return this.totalAiWins() > 0;
  }
}
