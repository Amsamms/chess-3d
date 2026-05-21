import * as THREE from 'three';
import { PieceColor, PieceType } from '../pieces/PieceFactory';
import { Character } from '../characters/Character';

export type PieceSetName = 'classic' | 'fantasy' | 'neon';

/** How a piece moves to a new square. Picked per piece type per set. */
export type MovementStyle =
  | 'arc'      // smooth hop with yaw — default
  | 'march'    // stiff step-step, small arc
  | 'leap'     // L-shape mid-air direction change (knight in Classic)
  | 'spin'     // rotate full circle while gliding
  | 'roll'     // tumble forward (rotate around X)
  | 'levitate' // rise high, descend slowly
  | 'hover'    // smooth glide with no rotation, thruster-style
  | 'gallop';  // Fantasy knight on horse — bounces

export interface PieceBuild {
  mesh: THREE.Group;
  /** Optional animated character (Fantasy uses this; Classic/Neon usually don't). */
  character: Character | null;
  motion: MovementStyle;
  /** Y offset where the piece sits on the board. Wizards float, etc. */
  baseY: number;
}

export const PIECE_SET_LABELS: Record<PieceSetName, string> = {
  classic: 'Classic',
  fantasy: 'Fantasy',
  neon: 'Neon Cyber',
};

export const PIECE_SET_ORDER: PieceSetName[] = ['classic', 'fantasy', 'neon'];

export interface BuilderArgs {
  type: PieceType;
  color: PieceColor;
}
