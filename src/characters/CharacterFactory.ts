import { PieceColor, PieceType } from '../pieces/PieceFactory';
import { Character } from './Character';
import { Knight } from './Knight';
import { King } from './King';
import { Queen } from './Queen';
import { Soldier } from './Soldier';
import { Tower } from './Tower';
import { Wizard } from './Wizard';
import { makePalette } from './Anatomy';

export function createCharacter(type: PieceType, color: PieceColor): Character {
  const palette = makePalette(color);
  switch (type) {
    case 'p': return new Soldier(palette);
    case 'n': return new Knight(palette);
    case 'b': return new Wizard(palette);
    case 'r': return new Tower(palette);
    case 'q': return new Queen(palette);
    case 'k': return new King(palette);
  }
}
