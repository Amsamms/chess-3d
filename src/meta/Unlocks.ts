/**
 * Progression / unlock ladder (F15).
 *
 * Piece sets and realms start the game as rewards instead of free toggles. The
 * ladder is evaluated purely from the Profile (no separate "unlocked" blob to
 * keep in sync), so seeding a profile that satisfies a rule unlocks the reward
 * automatically. Defaults that are always available: the Fantasy set and the
 * Gothic Night realm.
 *
 * LADDER (documented here and in the package notes):
 *   Sets:
 *     fantasy   : always (default)
 *     classic   : after 1 completed game
 *     neon      : after first win (AI or online)
 *   Realms:
 *     gothic-night : always (default)
 *     garden-day   : after 3 completed games
 *     ice-realm    : after first AI win
 *     volcano      : after beating Advanced or Master
 *
 * SEEDING ESCAPE HATCH: write a profile blob (key chess3d.profile.v1) that
 * satisfies every rule to unlock everything. The simplest universal seed is in
 * the package notes; e.g. gamesPlayed >= 3 plus a Master tier win unlocks all.
 */

import type { ProfileStore } from './Profile';
import type { PieceSetName } from '../sets/PieceSet';
import type { EnvironmentName } from '../environments/Environment';

/** One unlock rule: how to test it, and a player-facing requirement string. */
export interface UnlockRule<K extends string> {
  key: K;
  /** True when the reward is available given the current profile. */
  test: (p: ProfileStore) => boolean;
  /** Short human requirement, shown when a locked entry is reached. */
  requirement: string;
}

export const SET_RULES: Record<PieceSetName, UnlockRule<PieceSetName>> = {
  fantasy: { key: 'fantasy', test: () => true, requirement: 'Unlocked' },
  classic: {
    key: 'classic',
    test: (p) => p.get().gamesPlayed >= 1,
    requirement: 'Finish 1 game',
  },
  neon: {
    key: 'neon',
    test: (p) => p.anyWin(),
    requirement: 'Win a game',
  },
};

export const REALM_RULES: Record<EnvironmentName, UnlockRule<EnvironmentName>> = {
  'gothic-night': { key: 'gothic-night', test: () => true, requirement: 'Unlocked' },
  'garden-day': {
    key: 'garden-day',
    test: (p) => p.get().gamesPlayed >= 3,
    requirement: 'Finish 3 games',
  },
  'ice-realm': {
    key: 'ice-realm',
    test: (p) => p.totalAiWins() >= 1,
    requirement: 'Beat the AI once',
  },
  volcano: {
    key: 'volcano',
    test: (p) => p.tierWins('advanced') >= 1 || p.tierWins('master') >= 1,
    requirement: 'Beat Advanced or Master',
  },
};

/** Is this piece set currently unlocked for the given profile? */
export function isSetUnlocked(set: PieceSetName, profile: ProfileStore): boolean {
  return SET_RULES[set].test(profile);
}

/** Is this realm currently unlocked for the given profile? */
export function isRealmUnlocked(realm: EnvironmentName, profile: ProfileStore): boolean {
  return REALM_RULES[realm].test(profile);
}

/** Player-facing requirement string for a (locked) set. */
export function setRequirement(set: PieceSetName): string {
  return SET_RULES[set].requirement;
}

/** Player-facing requirement string for a (locked) realm. */
export function realmRequirement(realm: EnvironmentName): string {
  return REALM_RULES[realm].requirement;
}
