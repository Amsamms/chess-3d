import * as THREE from 'three';

export const SQUARE_SIZE = 1.4;
export const BOARD_DIM = 8 * SQUARE_SIZE;
export const BOARD_Y_TOP = 0.18; // top of the board slab — pieces sit here

export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export const FILES: File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export type SquareName =
  | `${File}1` | `${File}2` | `${File}3` | `${File}4`
  | `${File}5` | `${File}6` | `${File}7` | `${File}8`;

export interface SquareCoord {
  fileIdx: number; // 0..7 (a..h)
  rankIdx: number; // 0..7 (1..8) — 0 means rank 1 (white back rank)
}

export function squareToWorld(coord: SquareCoord, y = BOARD_Y_TOP): THREE.Vector3 {
  // White's view: file a is on the left (negative X), rank 1 is near (positive Z).
  const x = (coord.fileIdx - 3.5) * SQUARE_SIZE;
  const z = (3.5 - coord.rankIdx) * SQUARE_SIZE;
  return new THREE.Vector3(x, y, z);
}

export function squareNameToCoord(name: SquareName): SquareCoord {
  const file = name[0] as File;
  const rank = parseInt(name[1]!, 10);
  return { fileIdx: FILES.indexOf(file), rankIdx: rank - 1 };
}

export function coordToSquareName(c: SquareCoord): SquareName {
  return `${FILES[c.fileIdx]}${c.rankIdx + 1}` as SquareName;
}

export function isLightSquare(c: SquareCoord): boolean {
  return (c.fileIdx + c.rankIdx) % 2 === 1;
}
