import { createPieceMesh, PieceType, PieceColor } from '../pieces/PieceFactory';
import { PieceBuild, MovementStyle } from './PieceSet';

/**
 * Classic Set — Procedural Staunton 3D pieces with imaginative per-type
 * movement personalities (the "movement of imagination" the user asked for).
 *
 *   Pawn  : march    — stiff hop-step
 *   Rook  : roll     — tumbles forward like a chess piece on its side
 *   Knight: leap     — L-shape: rises, banks 90° at apex, drops onto square
 *   Bishop: spin     — pirouettes once while gliding diagonally
 *   Queen : levitate — rises high, hovers, descends regally
 *   King  : march    — slow heavy march, slight wobble
 */
export function buildClassicPiece(type: PieceType, color: PieceColor): PieceBuild {
  const mesh = createPieceMesh(type, color);
  return {
    mesh,
    character: null,
    motion: CLASSIC_MOTION[type],
    baseY: 0,
  };
}

const CLASSIC_MOTION: Record<PieceType, MovementStyle> = {
  p: 'march',
  r: 'roll',
  n: 'leap',
  b: 'spin',
  q: 'levitate',
  k: 'march',
};
