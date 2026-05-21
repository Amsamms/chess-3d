import * as THREE from 'three';
import { Chess, Square as ChessSquare, Move } from 'chess.js';
import { SceneManager } from '../engine/SceneManager';
import { Board } from '../board/Board';
import { Piece } from '../pieces/Piece';
import { PieceColor, PieceType } from '../pieces/PieceFactory';
import {
  FILES,
  SquareCoord,
  coordToSquareName,
  squareNameToCoord,
  squareToWorld,
} from '../board/coordinates';
import { UI } from '../ui/UI';
import { VFXManager } from '../vfx/VFXManager';
import { Prison } from '../vfx/Prison';
import { CaptureFX } from '../vfx/CaptureFX';
import { SoundEngine } from '../engine/Sound';

export class Game {
  private chess = new Chess();
  private board = new Board();
  private pieces = new Map<number, Piece>(); // by piece id
  private squareMap = new Map<string, Piece>(); // by square name e.g. 'e4'
  private selected: Piece | null = null;
  private legalForSelected: Move[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ui: UI | null = null;
  private animatingMove = false;
  private boardClock = 0;
  private capturedWhite: PieceType[] = [];
  private capturedBlack: PieceType[] = [];
  readonly vfx: VFXManager;
  readonly prison = new Prison();
  private readonly captureFX: CaptureFX;
  private sound: SoundEngine | null = null;
  private afterMoveListeners: Array<() => void> = [];
  private aiThinking = false;

  constructor(private readonly scene: SceneManager) {
    this.scene.scene.add(this.board.group);
    this.scene.scene.add(this.prison.group);
    this.vfx = new VFXManager(this.scene.scene);
    this.captureFX = new CaptureFX(this.scene.scene, this.vfx, this.prison);
    this.scene.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  attachUI(ui: UI) {
    this.ui = ui;
    this.refreshUI();
  }

  attachSound(s: SoundEngine) {
    this.sound = s;
  }

  /** Subscribe to "move just completed" — used by AI to know when to think. */
  onAfterMove(fn: () => void) {
    this.afterMoveListeners.push(fn);
  }

  isAnimating(): boolean {
    return this.animatingMove;
  }

  setAiThinking(thinking: boolean) {
    this.aiThinking = thinking;
    this.ui?.setAiThinking(thinking);
  }
  isAiThinking(): boolean { return this.aiThinking; }

  async init() {
    this.spawnAllFromFen();
  }

  reset() {
    // Dispose old pieces (on board)
    for (const p of this.pieces.values()) {
      this.scene.scene.remove(p.mesh);
      p.dispose();
    }
    // Dispose prisoners and clear cages
    this.prison.group.traverse((o) => {
      if (o.userData?.piece) {
        const p = o.userData.piece as Piece;
        if (typeof (p as { dispose?: () => void }).dispose === 'function') p.dispose();
      }
    });
    // Cleanly rebuild prison group's interior — easiest: remove + reattach a fresh Prison.
    this.scene.scene.remove(this.prison.group);
    const fresh = new Prison();
    (this as unknown as { prison: Prison; captureFX: CaptureFX }).prison = fresh;
    this.scene.scene.add(fresh.group);
    // Rebuild CaptureFX so it references the new prison
    (this as unknown as { captureFX: CaptureFX }).captureFX = new CaptureFX(this.scene.scene, this.vfx, fresh);

    this.pieces.clear();
    this.squareMap.clear();
    this.capturedWhite = [];
    this.capturedBlack = [];
    this.board.clearHighlights();
    this.selected = null;
    this.chess = new Chess();
    this.spawnAllFromFen();
    this.refreshUI();
  }

  private spawnAllFromFen() {
    const fen = this.chess.fen().split(' ')[0]!;
    const ranks = fen.split('/'); // index 0 = rank 8 (top, black), index 7 = rank 1 (bottom, white)
    for (let i = 0; i < ranks.length; i++) {
      const rankStr = ranks[i]!;
      const rankIdx = 7 - i;
      let fileIdx = 0;
      for (const ch of rankStr) {
        if (/[1-8]/.test(ch)) {
          fileIdx += parseInt(ch, 10);
        } else {
          const color: PieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase() as PieceType;
          const coord: SquareCoord = { fileIdx, rankIdx };
          const piece = new Piece(color, type, coord);
          this.pieces.set(piece.id, piece);
          this.squareMap.set(coordToSquareName(coord), piece);
          this.scene.scene.add(piece.mesh);
          fileIdx++;
        }
      }
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (this.animatingMove) return;
    if (this.aiThinking) return;
    if (this.chess.isGameOver()) return;

    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.scene.camera);
    // Cast against board (squares + pickPlanes) + all piece meshes.
    const targets: THREE.Object3D[] = [];
    targets.push(this.board.group);
    for (const p of this.pieces.values()) targets.push(p.mesh);

    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return;

    // Find the first hit with relevant userData walking up the parent chain.
    let kind: 'piece' | 'square' | null = null;
    let pieceHit: Piece | null = null;
    let squareCoord: SquareCoord | null = null;

    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData?.kind === 'piece' && obj.userData.piece) {
          kind = 'piece';
          pieceHit = obj.userData.piece as Piece;
          break;
        }
        if (obj.userData?.kind === 'square' && obj.userData.coord) {
          kind = 'square';
          squareCoord = obj.userData.coord as SquareCoord;
          break;
        }
        obj = obj.parent;
      }
      if (kind) break;
    }
    if (!kind) return;

    if (kind === 'piece' && pieceHit) {
      this.handlePieceClick(pieceHit);
    } else if (kind === 'square' && squareCoord) {
      this.handleSquareClick(squareCoord);
    }
  }

  private handlePieceClick(piece: Piece) {
    const turn = this.chess.turn();
    if (piece.color === turn) {
      this.selectPiece(piece);
      return;
    }
    // Clicked an enemy piece — if it's a legal capture for the selected piece, do the move.
    if (this.selected) {
      const move = this.legalForSelected.find(
        (m) => m.to === coordToSquareName(piece.coord),
      );
      if (move) {
        this.executeMove(move);
        return;
      }
    }
    // Otherwise deselect.
    this.deselect();
  }

  private handleSquareClick(coord: SquareCoord) {
    if (!this.selected) return;
    const toName = coordToSquareName(coord);
    const move = this.legalForSelected.find((m) => m.to === toName);
    if (move) {
      this.executeMove(move);
    } else {
      this.deselect();
    }
  }

  private selectPiece(piece: Piece) {
    if (this.selected === piece) {
      this.deselect();
      return;
    }
    this.deselect();
    this.selected = piece;
    piece.setSelected(true);

    const moves = this.chess.moves({
      square: coordToSquareName(piece.coord) as ChessSquare,
      verbose: true,
    }) as Move[];
    this.legalForSelected = moves;

    // Highlight the selected square + all legal destinations.
    this.board.highlightSquares([piece.coord], 'selected');
    const captures: SquareCoord[] = [];
    const quiet: SquareCoord[] = [];
    for (const m of moves) {
      const dst = squareNameToCoord(m.to as any);
      if (m.captured || m.flags.includes('e')) captures.push(dst);
      else quiet.push(dst);
    }
    this.board.highlightSquares(quiet, 'move');
    this.board.highlightSquares(captures, 'capture');
  }

  private deselect() {
    if (this.selected) this.selected.setSelected(false);
    this.selected = null;
    this.legalForSelected = [];
    this.board.clearHighlights();
  }

  private async executeMove(move: Move) {
    const moving = this.squareMap.get(move.from);
    if (!moving) return;
    this.animatingMove = true;
    this.deselect();

    // En passant: the captured pawn is NOT on the destination square.
    let capturedPiece: Piece | undefined;
    if (move.flags.includes('e')) {
      // Captured pawn sits behind 'to' from mover's perspective.
      const epDir = moving.color === 'w' ? -1 : 1;
      const epRank = squareNameToCoord(move.to as any).rankIdx + epDir;
      const epName = coordToSquareName({
        fileIdx: squareNameToCoord(move.to as any).fileIdx,
        rankIdx: epRank,
      });
      capturedPiece = this.squareMap.get(epName);
      if (capturedPiece) this.squareMap.delete(epName);
    } else if (move.captured) {
      capturedPiece = this.squareMap.get(move.to);
      if (capturedPiece) this.squareMap.delete(move.to);
    }

    // Apply state to chess.js
    this.chess.move({ from: move.from, to: move.to, promotion: move.promotion });

    // Move ordering depends on whether this is a capture:
    //  - Ranged attacker (bishop): cast spell FIRST from current square, target dies, THEN attacker glides in.
    //  - Melee/other (knight/pawn/rook/queen/king): walk in normally, then trigger capture VFX at destination.
    if (capturedPiece && moving.type === 'b') {
      this.playCaptureSound(moving);
      await this.captureFX.play(moving, capturedPiece);
      this.captureSideEffects(capturedPiece);
      this.sound?.playMoveStep();
      await moving.moveTo(squareNameToCoord(move.to as any));
    } else {
      this.sound?.playMoveStep();
      await moving.moveTo(squareNameToCoord(move.to as any));
      if (capturedPiece) {
        this.playCaptureSound(moving);
        await this.captureFX.play(moving, capturedPiece);
        this.captureSideEffects(capturedPiece);
      }
    }
    this.squareMap.delete(move.from);
    this.squareMap.set(move.to, moving);

    // Castling: also move the rook.
    if (move.flags.includes('k') || move.flags.includes('q')) {
      const rank = moving.color === 'w' ? 0 : 7;
      const rookFromFile = move.flags.includes('k') ? 7 : 0;
      const rookToFile = move.flags.includes('k') ? 5 : 3;
      const rookFromName = coordToSquareName({ fileIdx: rookFromFile, rankIdx: rank });
      const rookToCoord = { fileIdx: rookToFile, rankIdx: rank };
      const rook = this.squareMap.get(rookFromName);
      if (rook) {
        await rook.moveTo(rookToCoord, 600);
        this.squareMap.delete(rookFromName);
        this.squareMap.set(coordToSquareName(rookToCoord), rook);
      }
    }

    // Promotion: swap geometry to the chosen type (chess.js does it in state).
    if (move.promotion) {
      moving.dispose();
      this.scene.scene.remove(moving.mesh);
      this.pieces.delete(moving.id);
      const promoted = new Piece(moving.color, move.promotion as PieceType, squareNameToCoord(move.to as any));
      this.pieces.set(promoted.id, promoted);
      this.squareMap.set(move.to, promoted);
      this.scene.scene.add(promoted.mesh);
    }

    this.animatingMove = false;
    this.refreshUI();
    for (const l of this.afterMoveListeners) l();
  }

  /** After capture VFX, accounting + UI tray update. The piece stays alive in the prison group, just not in `pieces` map. */
  private captureSideEffects(captured: Piece) {
    // Piece visual now lives in the prison, NOT the scene root or pieces map.
    this.pieces.delete(captured.id);
    if (captured.color === 'w') this.capturedWhite.push(captured.type);
    else this.capturedBlack.push(captured.type);
  }

  private playCaptureSound(attacker: Piece) {
    if (!this.sound) return;
    switch (attacker.type) {
      case 'b': this.sound.playMagicCast(); break;
      case 'r': this.sound.playStoneSmash(); break;
      case 'q': this.sound.playQueenVortex(); break;
      case 'n':
      case 'p':
      case 'k':
      default:
        this.sound.playImpact();
    }
  }

  private refreshUI() {
    if (!this.ui) return;
    const turn = this.chess.turn();
    const inCheck = this.chess.inCheck();
    const checkmate = this.chess.isCheckmate();
    const stalemate = this.chess.isStalemate();
    const draw = this.chess.isDraw();

    let status: string = '';
    let statusClass: 'idle' | 'check' | 'checkmate' | 'stalemate' = 'idle';
    if (checkmate) {
      status = `Checkmate — ${turn === 'w' ? 'Black' : 'White'} reigns triumphant.`;
      statusClass = 'checkmate';
    } else if (stalemate) {
      status = 'Stalemate — the realm draws breath.';
      statusClass = 'stalemate';
    } else if (draw) {
      status = 'Draw by repetition or insufficient material.';
      statusClass = 'stalemate';
    } else if (inCheck) {
      status = `${turn === 'w' ? 'White' : 'Black'} king stands in peril.`;
      statusClass = 'check';
    }

    // Audio cues for game-state changes.
    if (this.sound) {
      if (checkmate || stalemate || draw) {
        this.sound.playCheckmate();
      } else if (inCheck) {
        this.sound.playCheck();
      }
    }

    this.ui.update({
      turn,
      status,
      statusClass,
      capturedWhite: this.capturedWhite,
      capturedBlack: this.capturedBlack,
      gameOver: checkmate || stalemate || draw,
      winner: checkmate ? (turn === 'w' ? 'Black' : 'White') : stalemate || draw ? 'Draw' : null,
    });
  }

  update(dtMs: number) {
    const dtSec = dtMs * 0.001;
    this.boardClock += dtSec;
    this.board.tickHighlights(this.boardClock);
    for (const p of this.pieces.values()) p.update(dtSec);
    this.vfx.tick(dtMs);
  }

  /** Test/dev helper: execute a move by SAN or from/to. */
  async devMove(spec: string | { from: string; to: string; promotion?: string }): Promise<boolean> {
    if (this.animatingMove) return false;
    let move: Move | null = null;
    if (typeof spec === 'string') {
      const found = this.chess.moves({ verbose: true }) as Move[];
      const m = found.find((mm) => mm.san === spec);
      move = m ?? null;
    } else {
      const found = this.chess.moves({
        square: spec.from as ChessSquare,
        verbose: true,
      }) as Move[];
      move = found.find((mm) => mm.to === spec.to && (!spec.promotion || mm.promotion === spec.promotion)) ?? null;
    }
    if (!move) return false;
    await this.executeMove(move);
    return true;
  }

  /** Test/dev helper: select a piece by square (triggers highlight & legal moves). */
  devSelect(squareName: string): boolean {
    const p = this.squareMap.get(squareName);
    if (!p) return false;
    this.selectPiece(p);
    return true;
  }

  devDeselect() {
    this.deselect();
  }

  devChess() {
    return this.chess;
  }
}

// Re-export for convenience.
export { FILES, squareToWorld };
