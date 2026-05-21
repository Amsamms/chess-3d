import { createCharacter } from '../characters/CharacterFactory';
import { PieceType, PieceColor } from '../pieces/PieceFactory';
import { PieceBuild, MovementStyle } from './PieceSet';

/**
 * Fantasy Set — the living-creature characters: knight on horse, robed wizard,
 * crowned queen, bearded king, armored soldier, stone tower.
 *
 *   Knight: gallop (horse motion in character.onWalk)
 *   Wizard: arc (floats — character already lifts root in idle)
 *   Others: arc — standard hop with yaw toward direction of travel
 */
export function buildFantasyPiece(type: PieceType, color: PieceColor): PieceBuild {
  const character = createCharacter(type, color);
  return {
    mesh: character.root,
    character,
    motion: FANTASY_MOTION[type],
    baseY: character.baseY(),
  };
}

const FANTASY_MOTION: Record<PieceType, MovementStyle> = {
  p: 'arc',
  r: 'arc',
  n: 'gallop',
  b: 'arc',     // wizard floats already
  q: 'arc',
  k: 'arc',
};
