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
import { PieceSetName } from '../sets/PieceSet';

/**
 * Granular game-over outcome. The first five are detected locally from the
 * chess.js position; the last three are produced by the online package (a
 * player resigns, runs out of time, or abandons the room) and are designed
 * here so the UI modal can label every ending precisely instead of the old
 * catch-all "Stalemate".
 */
export type GameResultKind =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'agreement'
  | 'resignation'
  | 'timeout'
  | 'abandonment';

/** Full description of a finished game, threaded to the UI. */
export interface GameResult {
  kind: GameResultKind;
  /** 'White' | 'Black' for decisive results, null for the three draw kinds. */
  winner: 'White' | 'Black' | null;
}

/** Promotion target chosen by the picker (or supplied by AI / network). */
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

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
  /**
   * Fired the instant chess.js state is updated for a move, BEFORE the 3D
   * animation starts. Online networking subscribes here so a move is sent to
   * the opponent immediately (decoupled from the local glide animation), while
   * the AI keeps using onAfterMove so it never thinks while a piece is still
   * sliding.
   */
  private moveAppliedListeners: Array<() => void> = [];
  private afterResetListeners: Array<() => void> = [];
  /**
   * Fired exactly once when the game reaches a terminal state, with the granular
   * result. The retention layer (main.ts) subscribes here to record the outcome
   * into the Profile. Guarded by gameEndFired so a re-render of the same terminal
   * position does not double-record. Cleared on reset.
   */
  private gameEndListeners: Array<(r: GameResult) => void> = [];
  private gameEndFired = false;
  /**
   * Fired each time a piece is captured, with the color of the captured piece.
   * The retention layer uses it to credit the local player's running capture
   * total live (so an abandoned game still counts the captures made).
   */
  private captureListeners: Array<(capturedColor: PieceColor) => void> = [];
  /**
   * Fired per capture for the cinematics layer (F13), with the captured piece's
   * world position and material value (pawn 1 .. queen 9) so the CameraDirector
   * can scale its FOV-punch + shake by how big the capture was. Distinct from
   * captureListeners (which only carry the color for the retention layer).
   */
  private captureFxListeners: Array<(info: { worldPos: THREE.Vector3; value: number }) => void> = [];
  /**
   * Fired exactly once when the game ends, carrying the granular result AND the
   * world position of the mated/standing king, so the cinematics layer can dolly
   * to it (checkmate) or push gently toward it (draw). Fires alongside the
   * retention onGameEnd hook but is a separate channel so the two never
   * interfere. Re-armed by reset() via gameEndFired.
   */
  private terminalCinematicListeners: Array<(info: { result: GameResult; kingWorld: THREE.Vector3 | null; kingMesh: THREE.Object3D | null }) => void> = [];
  private aiThinking = false;
  private currentSet: PieceSetName = 'fantasy';
  /**
   * Tap-vs-drag gate state. We decide whether a pointer interaction is a
   * "select" (a deliberate tap/click) or a camera drag on pointerUP, by
   * comparing how far the pointer travelled and how long it was held. A camera
   * orbit drag therefore never selects a piece (the mobile mis-select bug).
   */
  private pointerDownPos: { x: number; y: number } | null = null;
  private pointerDownTime = 0;
  private static readonly TAP_MAX_MOVE_PX = 6;
  private static readonly TAP_MAX_DURATION_MS = 400;
  /** Material value per piece type, used to scale the capture cinematic (F13). */
  private static readonly PIECE_VALUE: Record<PieceType, number> = {
    p: 1, n: 3, b: 3, r: 5, q: 9, k: 4,
  };
  /** Squares of the most-recent move (from, to), persistently tinted until the next move. */
  private lastMoveSquares: { from: SquareCoord; to: SquareCoord } | null = null;
  /**
   * Externally-injected terminal result (resignation / timeout / abandonment)
   * coming from the online package. When set, refreshUI surfaces it instead of
   * inspecting the chess.js position. Cleared on reset.
   */
  private externalResult: GameResult | null = null;
  /**
   * Pending promotion the picker is resolving. While non-null all board input
   * is suspended and the picker overlay is showing. Resolved when the player
   * chooses a piece (or cancels). AI / network promotions never set this: they
   * pass their promotion piece straight to executeMove.
   */
  private pendingPromotion: Move | null = null;
  /** DOM overlay for the promotion picker, while open. */
  private promotionOverlay: HTMLElement | null = null;
  /** Escape-key handler bound while the promotion picker is open. */
  private promotionKeyHandler: ((ev: KeyboardEvent) => void) | null = null;
  /** When true, executeMove snaps pieces to destination and skips capture VFX. For automated tests. */
  testMode = false;
  /**
   * When non-null, user input is restricted: 'spectator' blocks ALL input;
   * 'w' / 'b' allows input only when it's that color's turn. Set by main.ts
   * via setInputColorLock() when entering online mode so users can't move
   * the opponent's pieces or interact while watching.
   */
  private inputColorLock: 'w' | 'b' | 'spectator' | null = null;

  setInputColorLock(lock: 'w' | 'b' | 'spectator' | null) {
    this.inputColorLock = lock;
    if (lock === 'spectator') this.deselect();
  }

  constructor(private readonly scene: SceneManager) {
    this.scene.scene.add(this.board.group);
    this.scene.scene.add(this.prison.group);
    this.vfx = new VFXManager(this.scene.scene);
    this.captureFX = new CaptureFX(this.scene.scene, this.vfx, this.prison);
    // Tap-vs-drag gate: we record the pointer-down origin/time, then only treat
    // the interaction as a selection on pointer-up if the pointer barely moved
    // and was not held long. This keeps camera orbit drags from selecting pieces
    // (the main mobile mis-select bug) while leaving OrbitControls fully free.
    const dom = this.scene.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
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

  /**
   * Subscribe to "move applied to chess.js state", fired before the animation
   * starts. Used by the online networking layer to submit a move to the
   * opponent immediately, without waiting for the local glide to finish.
   */
  onMoveApplied(fn: () => void) {
    this.moveAppliedListeners.push(fn);
  }

  /**
   * Subscribe to "board was reset". Used by the AI so that after a Restart it
   * re-evaluates whether it is to move (e.g. AI-plays-White must open the game).
   * Fired at the end of reset() once the fresh position is on the board.
   */
  onAfterReset(fn: () => void) {
    this.afterResetListeners.push(fn);
  }

  /**
   * Subscribe to "game reached a terminal state". Fires exactly once per game
   * (checkmate/draw detected locally, or an external resignation/timeout/
   * abandonment injected by the online layer). Used by the retention layer to
   * record the outcome. Re-armed by reset().
   */
  onGameEnd(fn: (r: GameResult) => void) {
    this.gameEndListeners.push(fn);
  }

  /**
   * Subscribe to "a piece was captured", receiving the captured piece's color.
   * Fired for captures from any source (human, AI, network). Used by the
   * retention layer to credit the local player's capture count live.
   */
  onCapture(fn: (capturedColor: PieceColor) => void) {
    this.captureListeners.push(fn);
  }

  /**
   * Subscribe to the cinematics capture channel (F13): receives the captured
   * piece's world position + material value so the camera can punch/shake scaled
   * by the capture's weight. Fired for captures from any source.
   */
  onCaptureFx(fn: (info: { worldPos: THREE.Vector3; value: number }) => void) {
    this.captureFxListeners.push(fn);
  }

  /**
   * Subscribe to the terminal-cinematic channel (F13): fired once when the game
   * ends, with the result and the mated/standing king's world position (null if
   * it cannot be located). Used by the cinematics layer to dolly to the king and
   * topple it on checkmate. Re-armed by reset().
   */
  onTerminalCinematic(fn: (info: { result: GameResult; kingWorld: THREE.Vector3 | null; kingMesh: THREE.Object3D | null }) => void) {
    this.terminalCinematicListeners.push(fn);
  }

  /**
   * Inject a terminal result coming from the online package (resignation,
   * timeout, abandonment). The UI modal will label it precisely. No-op if the
   * game is already over. Cleared by reset().
   */
  setExternalResult(result: GameResult) {
    this.externalResult = result;
    this.refreshUI();
  }

  isAnimating(): boolean {
    return this.animatingMove;
  }

  setAiThinking(thinking: boolean) {
    this.aiThinking = thinking;
    this.ui?.setAiThinking(thinking);
  }
  isAiThinking(): boolean { return this.aiThinking; }

  /**
   * Swap the active piece set WITHOUT restarting the game. Every piece mesh (on
   * the board and in the prison cages) is rebuilt in the new style, but the
   * chess.js position, move history, turn, captured pieces, last-move highlight
   * and check ring are all preserved so an in-progress game continues exactly
   * where it was. (Changing the look is cosmetic; it must not cost you the game.)
   */
  setPieceSet(set: PieceSetName) {
    if (this.currentSet === set) return;
    this.currentSet = set;
    this.restyleInPlace();
  }
  getPieceSet(): PieceSetName { return this.currentSet; }

  /** Rebuild all piece meshes in the current set while preserving game state. */
  private restyleInPlace() {
    // Dispose the on-board meshes. Crucially we do NOT touch this.chess or the
    // captured arrays, so the position and history survive the restyle.
    for (const p of this.pieces.values()) {
      this.scene.scene.remove(p.mesh);
      p.dispose();
    }
    this.pieces.clear();
    this.squareMap.clear();

    // Rebuild the prison with fresh empty cages (disposing the old captured
    // meshes) plus a CaptureFX that references it, mirroring reset().
    this.prison.group.traverse((o) => {
      if (o.userData?.piece) {
        const pp = o.userData.piece as Piece;
        if (typeof (pp as { dispose?: () => void }).dispose === 'function') pp.dispose();
      }
    });
    this.scene.scene.remove(this.prison.group);
    const fresh = new Prison();
    (this as unknown as { prison: Prison; captureFX: CaptureFX }).prison = fresh;
    this.scene.scene.add(fresh.group);
    (this as unknown as { captureFX: CaptureFX }).captureFX = new CaptureFX(this.scene.scene, this.vfx, fresh);

    // The selected mesh is gone; drop any active selection and its highlights.
    this.selected = null;
    this.legalForSelected = [];
    this.board.clearHighlights();

    // Respawn the board from the current position in the new set.
    this.spawnAllFromFen();

    // Re-seat the captured pieces in the new set so the cages match the board.
    // The origin coord is irrelevant: seatInstant drops the mesh into a slot.
    const origin: SquareCoord = { fileIdx: 0, rankIdx: 0 };
    for (const t of this.capturedWhite) fresh.seatInstant(new Piece('w', t, origin, this.currentSet));
    for (const t of this.capturedBlack) fresh.seatInstant(new Piece('b', t, origin, this.currentSet));

    // Restore the persistent board cues for the current position.
    this.board.setLastMove(this.lastMoveSquares);
    this.updateCheckRing();
    // No new Chess() and no afterResetListeners: this is a restyle, not a
    // restart, so the turn, position, and the AI's role are all unchanged.
  }

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
    this.board.setLastMove(null);
    this.board.setCheckSquare(null);
    this.selected = null;
    this.legalForSelected = [];
    this.lastMoveSquares = null;
    this.externalResult = null;
    this.gameEndFired = false;
    this.pendingPromotion = null;
    this.closePromotionPicker();
    // Clear any in-flight think/animation flags so a Restart mid-think (or a
    // mode switch while the AI is searching) does not leave input locked.
    this.aiThinking = false;
    this.ui?.setAiThinking(false);
    this.animatingMove = false;
    this.chess = new Chess();
    this.spawnAllFromFen();
    this.refreshUI();
    // Let the AI re-decide whether it must open the game (AI-plays-White).
    for (const l of this.afterResetListeners) l();
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
          const piece = new Piece(color, type, coord, this.currentSet);
          this.pieces.set(piece.id, piece);
          this.squareMap.set(coordToSquareName(coord), piece);
          this.scene.scene.add(piece.mesh);
          fileIdx++;
        }
      }
    }
  }

  /** Record the pointer-down origin so pointer-up can tell a tap from a drag. */
  private onPointerDown(e: PointerEvent) {
    // Only primary button / touch contact arms a potential selection.
    if (e.button !== 0) {
      this.pointerDownPos = null;
      return;
    }
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.pointerDownTime = performance.now();
  }

  /**
   * Resolve a pointer interaction. We only act if it was a TAP (pointer barely
   * moved and was not held long); a camera-orbit drag is ignored so it never
   * selects a piece. Input-eligibility checks (animation, AI turn, game over,
   * online turn lock, promotion picker) live here so the camera and HUD stay
   * fully responsive even while it is the AI's turn.
   */
  private onPointerUp(e: PointerEvent) {
    const down = this.pointerDownPos;
    this.pointerDownPos = null;
    if (!down) return;
    const movedPx = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const heldMs = performance.now() - this.pointerDownTime;
    if (movedPx > Game.TAP_MAX_MOVE_PX || heldMs > Game.TAP_MAX_DURATION_MS) return;

    if (this.pendingPromotion) return; // picker open: board input suspended
    if (this.animatingMove) return;
    // While the AI is thinking we ignore selection for the AI's color, but the
    // camera/HUD above this point stay live. In hot-seat aiThinking is always
    // false, so this only gates the human-vs-AI case.
    if (this.aiThinking) return;
    if (this.chess.isGameOver()) return;
    // Online-mode input gating: spectators get no input; players only act on their turn.
    if (this.inputColorLock === 'spectator') return;
    if (this.inputColorLock && this.chess.turn() !== this.inputColorLock) return;

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
        this.requestMove(move);
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
      this.requestMove(move);
    } else {
      this.deselect();
    }
  }

  /**
   * Route a chosen LOCAL human move. If it is a promotion, open the picker so
   * the player chooses the piece; otherwise execute immediately. AI and network
   * moves bypass this entirely (they call executeMove with their promotion piece
   * already decided) so the picker never opens for them.
   */
  private requestMove(move: Move) {
    if (move.promotion) {
      this.openPromotionPicker(move);
      return;
    }
    void this.executeMove(move);
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

  // ---------- Promotion picker (local human moves only) ----------

  /**
   * Show a small overlay letting the player pick the promotion piece. chess.js
   * verbose move generation yields one move object per promotion target sharing
   * the same from/to, so we re-resolve the chosen variant from the from/to pair
   * when a glyph is clicked. Escape or clicking the backdrop cancels (deselect,
   * no move). The picker serves whichever color is to move, so hot-seat works
   * for both sides.
   */
  private openPromotionPicker(move: Move) {
    this.closePromotionPicker();
    this.pendingPromotion = move;
    const color = this.chess.turn(); // the side to move owns this pawn

    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';
    overlay.id = 'promotion-overlay';

    const card = document.createElement('div');
    card.className = 'promotion-card';

    const title = document.createElement('div');
    title.className = 'promotion-title';
    title.textContent = 'Promote to';
    card.appendChild(title);

    const row = document.createElement('div');
    row.className = 'promotion-row';
    const glyphs: Record<PromotionPiece, { w: string; b: string; label: string }> = {
      q: { w: '♕', b: '♛', label: 'Queen' },
      r: { w: '♖', b: '♜', label: 'Rook' },
      b: { w: '♗', b: '♝', label: 'Bishop' },
      n: { w: '♘', b: '♞', label: 'Knight' },
    };
    const order: PromotionPiece[] = ['q', 'r', 'b', 'n'];
    for (const p of order) {
      const btn = document.createElement('button');
      btn.className = 'promotion-choice';
      btn.id = `promotion-${p}`;
      btn.type = 'button';
      btn.title = glyphs[p].label;
      btn.setAttribute('aria-label', glyphs[p].label);
      btn.textContent = color === 'w' ? glyphs[p].w : glyphs[p].b;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.choosePromotion(p);
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
    overlay.appendChild(card);

    // Clicking outside the card (on the backdrop) cancels.
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === overlay) {
        ev.stopPropagation();
        this.cancelPromotion();
      }
    });

    document.body.appendChild(overlay);
    this.promotionOverlay = overlay;
    this.promotionKeyHandler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.cancelPromotion();
      }
    };
    window.addEventListener('keydown', this.promotionKeyHandler);
  }

  private choosePromotion(piece: PromotionPiece) {
    const pending = this.pendingPromotion;
    this.pendingPromotion = null;
    this.closePromotionPicker();
    if (!pending) return;
    // Re-resolve the exact verbose move for the chosen promotion variant so the
    // flags/captured metadata are correct for executeMove. chess.js always emits
    // one verbose move per promotion target, so the variant is guaranteed to
    // exist for a legal pending promotion.
    const variant = (this.chess.moves({
      square: pending.from as ChessSquare,
      verbose: true,
    }) as Move[]).find((m) => m.to === pending.to && m.promotion === piece);
    if (!variant) {
      console.warn(`[Game] promotion variant ${piece} not found for ${pending.from}${pending.to}`);
      this.deselect();
      return;
    }
    void this.executeMove(variant);
  }

  private cancelPromotion() {
    this.pendingPromotion = null;
    this.closePromotionPicker();
    this.deselect();
  }

  private closePromotionPicker() {
    if (this.promotionKeyHandler) {
      window.removeEventListener('keydown', this.promotionKeyHandler);
      this.promotionKeyHandler = null;
    }
    if (this.promotionOverlay && this.promotionOverlay.parentNode) {
      this.promotionOverlay.parentNode.removeChild(this.promotionOverlay);
    }
    this.promotionOverlay = null;
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

    // Persistent from/to tint + check ring update immediately on the state
    // change, so they reflect the new position even while the 3D piece is still
    // gliding. Works for moves from any source (human, AI, network).
    this.lastMoveSquares = {
      from: squareNameToCoord(move.from as any),
      to: squareNameToCoord(move.to as any),
    };
    this.board.setLastMove(this.lastMoveSquares);
    this.updateCheckRing();

    // Notify the network layer NOW (before the animation) so an online move is
    // sent to the opponent without waiting for the local glide to complete.
    for (const l of this.moveAppliedListeners) l();

    // Capture juice (F13): punch/shake the camera scaled by the captured piece's
    // value, fired at the moment of capture (before the long VFX) so the hit
    // reads instantly. Skipped in testMode so automated tests stay deterministic.
    if (capturedPiece && !this.testMode && this.captureFxListeners.length) {
      const worldPos = capturedPiece.mesh.position.clone();
      const value = Game.PIECE_VALUE[capturedPiece.type];
      for (const l of this.captureFxListeners) l({ worldPos, value });
    }

    // Move ordering depends on whether this is a capture:
    //  - Ranged attacker (bishop): cast spell FIRST from current square, target dies, THEN attacker glides in.
    //  - Melee/other (knight/pawn/rook/queen/king): walk in normally, then trigger capture VFX at destination.
    if (this.testMode) {
      // Test-mode fast path: snap moving piece, vaporize capture, skip VFX.
      const toCoord = squareNameToCoord(move.to as any);
      moving.coord = toCoord;
      moving.mesh.position.copy(squareToWorld(toCoord, moving.baseY));
      if (capturedPiece) {
        this.scene.scene.remove(capturedPiece.mesh);
        capturedPiece.dispose();
        this.captureSideEffects(capturedPiece);
      }
    } else if (capturedPiece && moving.type === 'b') {
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
        if (this.testMode) {
          rook.coord = rookToCoord;
          rook.mesh.position.copy(squareToWorld(rookToCoord, rook.baseY));
        } else {
          await rook.moveTo(rookToCoord, 600);
        }
        this.squareMap.delete(rookFromName);
        this.squareMap.set(coordToSquareName(rookToCoord), rook);
      }
    }

    // Promotion: swap geometry to the chosen type (chess.js does it in state).
    if (move.promotion) {
      moving.dispose();
      this.scene.scene.remove(moving.mesh);
      this.pieces.delete(moving.id);
      const promoted = new Piece(moving.color, move.promotion as PieceType, squareNameToCoord(move.to as any), this.currentSet);
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
    for (const l of this.captureListeners) l(captured.color);
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

  /**
   * Resolve the granular game-over result. Prefers an externally-injected
   * result (resignation / timeout / abandonment from the online package);
   * otherwise inspects the chess.js position. Returns null while the game is
   * still in progress.
   */
  private computeResult(): GameResult | null {
    if (this.externalResult) return this.externalResult;
    const turn = this.chess.turn();
    if (this.chess.isCheckmate()) {
      // The side to move is checkmated, so the OTHER side won.
      return { kind: 'checkmate', winner: turn === 'w' ? 'Black' : 'White' };
    }
    if (this.chess.isStalemate()) return { kind: 'stalemate', winner: null };
    if (this.chess.isThreefoldRepetition()) return { kind: 'threefold', winner: null };
    if (this.chess.isInsufficientMaterial()) return { kind: 'insufficient', winner: null };
    if (this.chess.isDraw()) {
      // isDraw() also covers the fifty-move rule (the only remaining draw kind
      // once stalemate / threefold / insufficient are excluded above).
      return { kind: 'fifty-move', winner: null };
    }
    return null;
  }

  private static readonly RESULT_STATUS: Record<GameResultKind, string> = {
    checkmate: 'Checkmate',
    stalemate: 'Stalemate, the realm draws breath.',
    threefold: 'Draw by threefold repetition.',
    'fifty-move': 'Draw by the fifty-move rule.',
    insufficient: 'Draw by insufficient material.',
    agreement: 'Draw agreed.',
    resignation: 'Resignation',
    timeout: 'Timeout, the clock has fallen.',
    abandonment: 'Abandonment, the opponent has fled.',
  };

  private refreshUI() {
    if (!this.ui) return;
    const turn = this.chess.turn();
    const inCheck = this.chess.inCheck();
    const result = this.computeResult();

    let status: string = '';
    let statusClass: 'idle' | 'check' | 'checkmate' | 'stalemate' = 'idle';
    if (result) {
      if (result.winner) {
        // Decisive result: name the outcome and the victor.
        const base = Game.RESULT_STATUS[result.kind];
        status = `${base}. ${result.winner} reigns triumphant.`;
        statusClass = 'checkmate';
      } else {
        status = Game.RESULT_STATUS[result.kind];
        statusClass = 'stalemate';
      }
    } else if (inCheck) {
      status = `${turn === 'w' ? 'White' : 'Black'} king stands in peril.`;
      statusClass = 'check';
    }

    // Audio cues for game-state changes.
    if (this.sound) {
      if (result) {
        this.sound.playCheckmate();
      } else if (inCheck) {
        this.sound.playCheck();
      }
    }

    // Fire the one-shot game-end hook for the retention layer BEFORE the UI
    // update, so the profile (streak, games played) is already current when the
    // game-over modal reads it for its stats + streak callout. Guarded so a
    // re-render of the same terminal position does not double-record. The
    // cinematics terminal hook fires in the same guarded block (and before
    // ui.update) so the camera sequence + modal delay are armed before the modal
    // would otherwise pop.
    if (result && !this.gameEndFired) {
      this.gameEndFired = true;
      for (const l of this.gameEndListeners) l(result);
      // Locate the king that matters: on checkmate / decisive endings the LOSER's
      // king is the focus (the mated king); on draws we focus the side-to-move's
      // king as a neutral centre-ish point.
      const kingColor: PieceColor = result.winner
        ? (result.winner === 'White' ? 'b' : 'w')
        : this.chess.turn();
      const kingSquare = this.findKingSquare(kingColor);
      const kingWorld = kingSquare ? squareToWorld(kingSquare) : null;
      const kingPiece = kingSquare ? this.squareMap.get(coordToSquareName(kingSquare)) : undefined;
      const kingMesh = kingPiece ? kingPiece.mesh : null;
      for (const l of this.terminalCinematicListeners) l({ result, kingWorld, kingMesh });
    }

    this.ui.update({
      turn,
      status,
      statusClass,
      capturedWhite: this.capturedWhite,
      capturedBlack: this.capturedBlack,
      gameOver: result !== null,
      result,
      // Full moves = plies / 2 rounded up, for the share line.
      moveCount: Math.ceil(this.chess.history().length / 2),
    });
  }

  /**
   * Position the pulsing red check ring under the king of the side to move when
   * it is in check; clear it otherwise. Re-evaluated after every move so the
   * ring disappears the moment the check is resolved.
   */
  private updateCheckRing() {
    const square = this.chess.inCheck() ? this.findKingSquare(this.chess.turn()) : null;
    this.board.setCheckSquare(square);
  }

  /** Find the board coordinate of the given color's king by scanning the FEN. */
  private findKingSquare(color: PieceColor): SquareCoord | null {
    const target = color === 'w' ? 'K' : 'k';
    const ranks = this.chess.fen().split(' ')[0]!.split('/');
    for (let i = 0; i < ranks.length; i++) {
      const rankIdx = 7 - i;
      let fileIdx = 0;
      for (const ch of ranks[i]!) {
        if (/[1-8]/.test(ch)) {
          fileIdx += parseInt(ch, 10);
        } else {
          if (ch === target) return { fileIdx, rankIdx };
          fileIdx++;
        }
      }
    }
    return null;
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

  /**
   * Puzzle mode: undo the most-recently applied move (used when the player
   * makes a wrong move in the daily puzzle). Reverts the chess.js position and
   * snaps all piece meshes back to the pre-move squares. Only call from puzzle
   * mode; it modifies chess.js state directly via undo().
   */
  undoPuzzleMove() {
    const undone = this.chess.undo();
    if (!undone) return;
    // Rebuild piece positions from chess.js FEN to stay in sync.
    // The simplest approach: reload the current FEN as if it were a puzzle FEN.
    // We reuse loadPuzzleFen's rebuild logic without going through the full reset path.
    const fen = this.chess.fen();
    this.loadPuzzleFen(fen);
  }

  /**
   * Puzzle mode: load an arbitrary FEN onto the board without changing game
   * metadata (no onAfterReset, no retention recording). Clears all in-flight
   * state, rebuilds pieces from the FEN, and resets the chess.js instance so
   * the solver can immediately issue legal moves. Called by DailyPuzzle.load().
   *
   * After this call, the game behaves exactly as it would from that position
   * (input gating, check ring, etc.) except that no game-end hooks are fired
   * until a proper terminal state is reached inside the puzzle sequence.
   */
  loadPuzzleFen(fen: string) {
    // Tear down all existing pieces.
    for (const p of this.pieces.values()) {
      this.scene.scene.remove(p.mesh);
      p.dispose();
    }
    // Fresh prison.
    this.scene.scene.remove(this.prison.group);
    const fresh = new Prison();
    (this as unknown as { prison: Prison; captureFX: CaptureFX }).prison = fresh;
    this.scene.scene.add(fresh.group);
    (this as unknown as { captureFX: CaptureFX }).captureFX = new CaptureFX(this.scene.scene, this.vfx, fresh);

    this.pieces.clear();
    this.squareMap.clear();
    this.capturedWhite = [];
    this.capturedBlack = [];
    this.board.clearHighlights();
    this.board.setLastMove(null);
    this.board.setCheckSquare(null);
    this.selected = null;
    this.legalForSelected = [];
    this.lastMoveSquares = null;
    this.externalResult = null;
    this.gameEndFired = false;
    this.pendingPromotion = null;
    this.closePromotionPicker();
    this.aiThinking = false;
    this.ui?.setAiThinking(false);
    this.animatingMove = false;

    // Load the requested FEN.
    this.chess = new Chess(fen);
    this.spawnAllFromFen();
    this.refreshUI();
    // Do NOT fire afterResetListeners: puzzle mode is not a game restart and
    // should not trigger the AI to start thinking.
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
