import { PieceColor, PieceType } from '../pieces/PieceFactory';
import type { SoundEngine } from '../engine/Sound';

interface UIState {
  turn: PieceColor;
  status: string;
  statusClass: 'idle' | 'check' | 'checkmate' | 'stalemate';
  capturedWhite: PieceType[];
  capturedBlack: PieceType[];
  gameOver: boolean;
  winner: string | null;
}

const PIECE_GLYPH: Record<PieceColor, Record<PieceType, string>> = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
  b: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' },
};

export type GameMode = 'hotseat' | 'ai-vs-white' | 'ai-vs-black';
export type AIDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';

export class UI {
  private restartHandlers: Array<() => void> = [];
  private modeHandlers: Array<(m: GameMode) => void> = [];
  private difficultyHandlers: Array<(d: AIDifficulty) => void> = [];
  private turnLabel!: HTMLElement;
  private turnOrb!: HTMLElement;
  private statusEl!: HTMLElement;
  private capturedLeftList!: HTMLElement;
  private capturedRightList!: HTMLElement;
  private aiThinkingEl!: HTMLElement;
  private modeBtn!: HTMLButtonElement;
  private difficultyBtn!: HTMLButtonElement;
  private root: HTMLDivElement;
  private gameOverModal: HTMLElement | null = null;
  private gameOverShownFor: string | null = null;
  private currentMode: GameMode = 'hotseat';
  private currentDifficulty: AIDifficulty = 'intermediate';

  private modeCycle: GameMode[] = ['hotseat', 'ai-vs-black', 'ai-vs-white'];
  private difficultyCycle: AIDifficulty[] = ['beginner', 'intermediate', 'advanced', 'master'];

  private modeLabel: Record<GameMode, string> = {
    'hotseat': 'Hot-seat',
    'ai-vs-black': 'Vs AI (you\'re White)',
    'ai-vs-white': 'Vs AI (you\'re Black)',
  };
  private difficultyLabel: Record<AIDifficulty, string> = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    master: 'Master',
  };

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.build();
  }

  private build() {
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-turn-card">
          <div class="hud-turn-orb" id="hud-turn-orb"></div>
          <div class="hud-turn-label" id="hud-turn-label">White to move</div>
        </div>
        <div class="hud-status" id="hud-status"></div>
      </div>
      <div class="captured-tray left">
        <div class="captured-tray-title">Black's Losses</div>
        <div class="captured-list" id="captured-left"></div>
      </div>
      <div class="captured-tray right">
        <div class="captured-tray-title">White's Losses</div>
        <div class="captured-list" id="captured-right"></div>
      </div>
      <div class="hud-controls">
        <button class="hud-btn" id="btn-mode" title="Game mode">Mode: Hot-seat</button>
        <button class="hud-btn" id="btn-difficulty" title="AI difficulty" style="display:none">Skill: Intermediate</button>
        <button class="hud-btn" id="btn-sound" title="Toggle sound">Sound: On</button>
        <button class="hud-btn" id="btn-restart">Restart</button>
      </div>
      <div class="ai-thinking" id="ai-thinking" style="display:none">
        <div class="ai-thinking-dot"></div>
        <span>The opponent is plotting…</span>
      </div>
      <div class="hud-hint">
        Drag to rotate &middot; Scroll to zoom &middot; Right-click drag to pan &middot;
        Click a piece, then click a highlighted square to move.
      </div>
    `;
    this.turnLabel = document.getElementById('hud-turn-label')!;
    this.turnOrb = document.getElementById('hud-turn-orb')!;
    this.statusEl = document.getElementById('hud-status')!;
    this.capturedLeftList = document.getElementById('captured-left')!;
    this.capturedRightList = document.getElementById('captured-right')!;
    document.getElementById('btn-restart')!.addEventListener('click', () => {
      this.gameOverShownFor = null;
      this.removeGameOver();
      for (const fn of this.restartHandlers) fn();
    });

    this.modeBtn = document.getElementById('btn-mode') as HTMLButtonElement;
    this.difficultyBtn = document.getElementById('btn-difficulty') as HTMLButtonElement;
    this.aiThinkingEl = document.getElementById('ai-thinking') as HTMLElement;

    this.modeBtn.addEventListener('click', () => {
      const idx = this.modeCycle.indexOf(this.currentMode);
      const next = this.modeCycle[(idx + 1) % this.modeCycle.length]!;
      this.currentMode = next;
      this.modeBtn.textContent = `Mode: ${this.modeLabel[next]}`;
      this.difficultyBtn.style.display = next === 'hotseat' ? 'none' : '';
      for (const fn of this.modeHandlers) fn(next);
    });

    this.difficultyBtn.addEventListener('click', () => {
      const idx = this.difficultyCycle.indexOf(this.currentDifficulty);
      const next = this.difficultyCycle[(idx + 1) % this.difficultyCycle.length]!;
      this.currentDifficulty = next;
      this.difficultyBtn.textContent = `Skill: ${this.difficultyLabel[next]}`;
      for (const fn of this.difficultyHandlers) fn(next);
    });
  }

  setAiThinking(thinking: boolean) {
    this.aiThinkingEl.style.display = thinking ? '' : 'none';
  }

  onModeChange(fn: (m: GameMode) => void) { this.modeHandlers.push(fn); }
  onDifficultyChange(fn: (d: AIDifficulty) => void) { this.difficultyHandlers.push(fn); }
  getMode(): GameMode { return this.currentMode; }
  getDifficulty(): AIDifficulty { return this.currentDifficulty; }

  attachSound(s: SoundEngine) {
    const btn = document.getElementById('btn-sound') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      const next = !s.isMuted();
      s.setMuted(next);
      btn.textContent = next ? 'Sound: Off' : 'Sound: On';
    });
  }

  onRestart(fn: () => void) {
    this.restartHandlers.push(fn);
  }

  update(state: UIState) {
    this.turnLabel.textContent = `${state.turn === 'w' ? 'White' : 'Black'} to move`;
    this.turnOrb.classList.toggle('black', state.turn === 'b');

    this.statusEl.textContent = state.status;
    this.statusEl.className = `hud-status ${state.statusClass}`;

    // Captured pieces — left tray shows black losses (captured by white), right shows white losses.
    this.capturedLeftList.innerHTML = state.capturedBlack
      .map((t) => `<span>${PIECE_GLYPH.b[t]}</span>`)
      .join('');
    this.capturedRightList.innerHTML = state.capturedWhite
      .map((t) => `<span>${PIECE_GLYPH.w[t]}</span>`)
      .join('');

    if (state.gameOver && state.winner && this.gameOverShownFor !== state.status) {
      this.showGameOver(state.winner, state.status);
      this.gameOverShownFor = state.status;
    } else if (!state.gameOver) {
      this.removeGameOver();
    }
  }

  private showGameOver(winner: string, subtitle: string) {
    this.removeGameOver();
    const modal = document.createElement('div');
    modal.className = 'game-over-modal';
    modal.innerHTML = `
      <div class="game-over-card">
        <div class="game-over-title">${winner === 'Draw' ? 'Stalemate' : `${winner} Wins`}</div>
        <div class="game-over-subtitle">${subtitle}</div>
        <button class="hud-btn" id="btn-play-again">Play Again</button>
      </div>
    `;
    this.root.appendChild(modal);
    document.getElementById('btn-play-again')!.addEventListener('click', () => {
      this.gameOverShownFor = null;
      this.removeGameOver();
      for (const fn of this.restartHandlers) fn();
    });
    this.gameOverModal = modal;
  }

  private removeGameOver() {
    if (this.gameOverModal && this.gameOverModal.parentNode) {
      this.gameOverModal.parentNode.removeChild(this.gameOverModal);
    }
    this.gameOverModal = null;
  }
}
