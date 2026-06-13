/**
 * Persisted UI settings (F14).
 *
 * A versioned localStorage blob (`chess3d.settings.v1`) holding the player's
 * last-used piece set, realm, game mode, AI tier, render quality, and sound
 * preference, so a reload restores the look the player left in instead of
 * snapping back to the defaults.
 *
 * MODE RESTORE POLICY: hot-seat and the two AI modes restore verbatim. Online
 * is deliberately NOT restored: re-joining a live room on a cold boot would
 * desync (the room may be gone), so a stored 'online' mode falls back to
 * 'hotseat'. URL-based room joins (#/r/<code>) still work because those are
 * handled separately in main.ts after settings restore.
 *
 * SEEDING: write any valid subset of the blob to localStorage under the key
 * below to pin a setting for testing. Missing keys fall back to defaults.
 */

import type { GameMode, AIDifficulty } from '../ui/UI';
import type { EnvironmentName } from '../environments/Environment';
import type { PieceSetName } from '../sets/PieceSet';
import type { QualityMode } from '../engine/Quality';

/** localStorage key for persisted settings. Bump suffix on shape change. */
export const SETTINGS_KEY = 'chess3d.settings.v1';
export const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  set: PieceSetName;
  realm: EnvironmentName;
  /** Stored mode; 'online' is never persisted (coerced to hotseat on save). */
  mode: GameMode;
  difficulty: AIDifficulty;
  quality: QualityMode;
  soundMuted: boolean;
}

const VALID_SETS: PieceSetName[] = ['classic', 'fantasy', 'neon'];
const VALID_REALMS: EnvironmentName[] = ['gothic-night', 'garden-day', 'ice-realm', 'volcano'];
const VALID_MODES: GameMode[] = ['hotseat', 'ai-vs-white', 'ai-vs-black', 'online'];
const VALID_DIFFS: AIDifficulty[] = ['beginner', 'intermediate', 'advanced', 'master'];
const VALID_QUALITY: QualityMode[] = ['high', 'low'];

/** Default settings: the original out-of-box look (Fantasy + Gothic Night). */
export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    set: 'fantasy',
    realm: 'gothic-night',
    mode: 'hotseat',
    difficulty: 'intermediate',
    quality: 'high',
    soundMuted: false,
  };
}

function oneOf<T>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Read settings, healing any missing/invalid fields onto the defaults. */
export function loadSettings(): Settings {
  const d = defaultSettings();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {
    return d;
  }
  if (raw === null) return d;
  let parsed: Partial<Settings> = {};
  try {
    parsed = JSON.parse(raw) as Partial<Settings>;
  } catch {
    return d;
  }
  const mode = oneOf(parsed.mode, VALID_MODES, d.mode);
  return {
    version: SETTINGS_VERSION,
    set: oneOf(parsed.set, VALID_SETS, d.set),
    realm: oneOf(parsed.realm, VALID_REALMS, d.realm),
    // Never restore online on boot (it would try to rejoin a dead room).
    mode: mode === 'online' ? 'hotseat' : mode,
    difficulty: oneOf(parsed.difficulty, VALID_DIFFS, d.difficulty),
    quality: oneOf(parsed.quality, VALID_QUALITY, d.quality),
    soundMuted: typeof parsed.soundMuted === 'boolean' ? parsed.soundMuted : d.soundMuted,
  };
}

/** Persist settings. 'online' mode is coerced to hotseat so a reload is safe. */
export function saveSettings(s: Settings): void {
  const safe: Settings = { ...s, version: SETTINGS_VERSION, mode: s.mode === 'online' ? 'hotseat' : s.mode };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    // Storage disabled: settings just won't persist this session.
  }
}
