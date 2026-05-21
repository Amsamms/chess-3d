import { PieceColor, PieceType } from '../pieces/PieceFactory';
import { PieceBuild, PieceSetName } from './PieceSet';
import { buildClassicPiece } from './ClassicSet';
import { buildFantasyPiece } from './FantasySet';
import { buildNeonPiece } from './NeonSet';

export function buildPiece(set: PieceSetName, type: PieceType, color: PieceColor): PieceBuild {
  switch (set) {
    case 'classic': return buildClassicPiece(type, color);
    case 'fantasy': return buildFantasyPiece(type, color);
    case 'neon':    return buildNeonPiece(type, color);
  }
}
