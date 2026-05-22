import { PieceColor, PieceType } from '../pieces/PieceFactory';
import type { SoundEngine } from '../engine/Sound';
import { EnvironmentName } from '../environments/Environment';
import { ENVIRONMENT_LABELS, ENVIRONMENT_ORDER } from '../environments/EnvironmentManager';
import { PIECE_SET_LABELS, PIECE_SET_ORDER, PieceSetName } from '../sets/PieceSet';
import { Quality, QualityMode } from '../engine/Quality';

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

export type GameMode = 'hotseat' | 'ai-vs-white' | 'ai-vs-black' | 'online';
export type AIDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';

export interface OnlineState {
  status: 'idle' | 'creating' | 'searching' | 'waiting' | 'playing' | 'watching' | 'error';
  roomCode?: string;
  myColor?: 'w' | 'b' | null;  // null = spectator
  errorMsg?: string;
}

export class UI {
  private restartHandlers: Array<() => void> = [];
  private modeHandlers: Array<(m: GameMode) => void> = [];
  private difficultyHandlers: Array<(d: AIDifficulty) => void> = [];
  private envHandlers: Array<(e: EnvironmentName) => void> = [];
  private setHandlers: Array<(s: PieceSetName) => void> = [];
  private qualityHandlers: Array<(q: QualityMode) => void> = [];
  private envBtn!: HTMLButtonElement;
  private setBtn!: HTMLButtonElement;
  private qualityBtn!: HTMLButtonElement;
  private currentEnv: EnvironmentName = 'gothic-night';
  private currentSet: PieceSetName = 'fantasy';
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

  // Online comes BEFORE the AI modes so users don't have to cycle through
  // them (and inadvertently spin up Stockfish) just to reach Online.
  private modeCycle: GameMode[] = ['hotseat', 'online', 'ai-vs-black', 'ai-vs-white'];
  private difficultyCycle: AIDifficulty[] = ['beginner', 'intermediate', 'advanced', 'master'];
  private qualityCycle: QualityMode[] = ['high', 'low'];
  private qualityLabel: Record<QualityMode, string> = { high: 'High', low: 'Low' };

  private modeLabel: Record<GameMode, string> = {
    'hotseat': 'Hot-seat',
    'ai-vs-black': 'Vs AI (you\'re White)',
    'ai-vs-white': 'Vs AI (you\'re Black)',
    'online': 'Online',
  };

  private onlinePanel!: HTMLElement;
  private onlineCreateHandlers: Array<() => void> = [];
  private onlineJoinHandlers: Array<(code: string) => void> = [];
  private onlineLeaveHandlers: Array<() => void> = [];
  private onlineFindHandlers: Array<() => void> = [];
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
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const hintHtml = coarsePointer
      ? `Drag to rotate &middot; Pinch to zoom &middot; Two-finger drag to pan &middot;
         Tap a piece, then tap a highlighted square.`
      : `Drag to rotate &middot; Scroll to zoom &middot; Right-click drag to pan &middot;
         Click a piece, then click a highlighted square to move.`;

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
        <button class="hud-btn" id="btn-set" title="Piece set">Set: Fantasy</button>
        <button class="hud-btn" id="btn-env" title="Realm / environment">Realm: Gothic Night</button>
        <button class="hud-btn" id="btn-mode" title="Game mode">Mode: Hot-seat</button>
        <button class="hud-btn" id="btn-difficulty" title="AI difficulty" style="display:none">Skill: Intermediate</button>
        <button class="hud-btn" id="btn-quality" title="Render quality">Quality: ${this.qualityLabel[Quality.current]}</button>
        <button class="hud-btn" id="btn-sound" title="Toggle sound">Sound: On</button>
        <button class="hud-btn" id="btn-restart">Restart</button>
      </div>
      <div class="ai-thinking" id="ai-thinking" style="display:none">
        <div class="ai-thinking-dot"></div>
        <span>The opponent is plotting…</span>
      </div>
      <div class="online-panel" id="online-panel" style="display:none">
        <div class="online-panel-title">Online — play a stranger</div>
        <div class="online-panel-body" id="online-panel-body"></div>
      </div>
      <div class="hud-hint">${hintHtml}</div>
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

    this.onlinePanel = document.getElementById('online-panel') as HTMLElement;

    this.modeBtn.addEventListener('click', () => {
      const idx = this.modeCycle.indexOf(this.currentMode);
      const next = this.modeCycle[(idx + 1) % this.modeCycle.length]!;
      this.currentMode = next;
      this.modeBtn.textContent = `Mode: ${this.modeLabel[next]}`;
      // Skill button shows only for AI modes.
      const showSkill = next === 'ai-vs-white' || next === 'ai-vs-black';
      this.difficultyBtn.style.display = showSkill ? '' : 'none';
      // Online panel shows only when online mode is selected.
      this.onlinePanel.style.display = next === 'online' ? '' : 'none';
      if (next === 'online') this.renderOnlinePanel({ status: 'idle' });
      for (const fn of this.modeHandlers) fn(next);
    });

    this.difficultyBtn.addEventListener('click', () => {
      const idx = this.difficultyCycle.indexOf(this.currentDifficulty);
      const next = this.difficultyCycle[(idx + 1) % this.difficultyCycle.length]!;
      this.currentDifficulty = next;
      this.difficultyBtn.textContent = `Skill: ${this.difficultyLabel[next]}`;
      for (const fn of this.difficultyHandlers) fn(next);
    });

    this.envBtn = document.getElementById('btn-env') as HTMLButtonElement;
    this.envBtn.addEventListener('click', () => {
      const idx = ENVIRONMENT_ORDER.indexOf(this.currentEnv);
      const next = ENVIRONMENT_ORDER[(idx + 1) % ENVIRONMENT_ORDER.length]!;
      this.currentEnv = next;
      this.envBtn.textContent = `Realm: ${ENVIRONMENT_LABELS[next]}`;
      for (const fn of this.envHandlers) fn(next);
    });

    this.setBtn = document.getElementById('btn-set') as HTMLButtonElement;
    this.setBtn.addEventListener('click', () => {
      const idx = PIECE_SET_ORDER.indexOf(this.currentSet);
      const next = PIECE_SET_ORDER[(idx + 1) % PIECE_SET_ORDER.length]!;
      this.currentSet = next;
      this.setBtn.textContent = `Set: ${PIECE_SET_LABELS[next]}`;
      for (const fn of this.setHandlers) fn(next);
    });

    this.qualityBtn = document.getElementById('btn-quality') as HTMLButtonElement;
    this.qualityBtn.addEventListener('click', () => {
      const idx = this.qualityCycle.indexOf(Quality.current);
      const next = this.qualityCycle[(idx + 1) % this.qualityCycle.length]!;
      this.qualityBtn.textContent = `Quality: ${this.qualityLabel[next]}`;
      for (const fn of this.qualityHandlers) fn(next);
    });
  }

  /** Programmatic sync — used when boot auto-detects mobile and forces 'low'. */
  setQualityLabel(mode: QualityMode) {
    if (this.qualityBtn) this.qualityBtn.textContent = `Quality: ${this.qualityLabel[mode]}`;
  }

  /**
   * Programmatic switch INTO online mode — called by main.ts when the URL is
   * /r/&lt;code&gt; or /watch/&lt;code&gt; on boot, so the cycle button reflects reality
   * and the panel pops open showing the right state.
   */
  setMode(mode: GameMode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.modeBtn.textContent = `Mode: ${this.modeLabel[mode]}`;
    const showSkill = mode === 'ai-vs-white' || mode === 'ai-vs-black';
    this.difficultyBtn.style.display = showSkill ? '' : 'none';
    this.onlinePanel.style.display = mode === 'online' ? '' : 'none';
  }

  /**
   * Render the online-mode panel content based on the current session state.
   * Called by main.ts on every state transition (idle → creating → waiting → playing).
   */
  renderOnlinePanel(state: OnlineState) {
    const body = document.getElementById('online-panel-body');
    if (!body) return;
    switch (state.status) {
      case 'idle':
        body.innerHTML = `
          <button class="hud-btn online-btn online-find" id="btn-online-find">Find Game (vs Stranger)</button>
          <button class="hud-btn online-btn" id="btn-online-create">Create Private Room</button>
          <button class="hud-btn online-btn" id="btn-online-join">Join with Code</button>
        `;
        document.getElementById('btn-online-find')?.addEventListener('click', () => {
          for (const fn of this.onlineFindHandlers) fn();
        });
        document.getElementById('btn-online-create')?.addEventListener('click', () => {
          for (const fn of this.onlineCreateHandlers) fn();
        });
        document.getElementById('btn-online-join')?.addEventListener('click', () => {
          const code = window.prompt('Enter room code (6 letters/digits):');
          if (!code) return;
          const cleaned = code.trim().toUpperCase();
          if (cleaned.length !== 6) {
            alert('Room code must be 6 characters.');
            return;
          }
          for (const fn of this.onlineJoinHandlers) fn(cleaned);
        });
        break;
      case 'creating':
        body.innerHTML = `<div class="online-panel-status">Opening the gates…</div>`;
        break;
      case 'searching':
        body.innerHTML = `
          <div class="online-panel-status">Searching for an opponent…</div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Cancel</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        break;
      case 'waiting': {
        const url = `${window.location.origin}${window.location.pathname}#/r/${state.roomCode}`;
        body.innerHTML = `
          <div class="online-panel-status">Waiting for opponent…</div>
          <div class="online-panel-code">Room: <span>${state.roomCode}</span></div>
          <div class="online-panel-share">
            <input type="text" id="online-share-url" value="${url}" readonly />
            <button class="hud-btn online-btn-sm" id="btn-online-copy">Copy</button>
          </div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Cancel</button>
        `;
        document.getElementById('btn-online-copy')?.addEventListener('click', () => {
          const input = document.getElementById('online-share-url') as HTMLInputElement;
          input.select();
          navigator.clipboard?.writeText(url).catch(() => document.execCommand('copy'));
          const btn = document.getElementById('btn-online-copy');
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { if (btn) btn.textContent = orig; }, 1200);
          }
        });
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        break;
      }
      case 'playing':
        body.innerHTML = `
          <div class="online-panel-status">In game — you are <strong>${state.myColor === 'w' ? 'White' : 'Black'}</strong></div>
          <div class="online-panel-code">Room: <span>${state.roomCode}</span></div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Leave Game</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        break;
      case 'watching':
        body.innerHTML = `
          <div class="online-panel-status">Watching as spectator</div>
          <div class="online-panel-code">Room: <span>${state.roomCode}</span></div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Stop Watching</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        break;
      case 'error':
        body.innerHTML = `
          <div class="online-panel-status online-error">${state.errorMsg ?? 'Connection failed.'}</div>
          <button class="hud-btn online-btn-sm" id="btn-online-leave">Back</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        break;
    }
  }

  onOnlineCreate(fn: () => void) { this.onlineCreateHandlers.push(fn); }
  onOnlineJoin(fn: (code: string) => void) { this.onlineJoinHandlers.push(fn); }
  onOnlineLeave(fn: () => void) { this.onlineLeaveHandlers.push(fn); }
  onOnlineFind(fn: () => void) { this.onlineFindHandlers.push(fn); }

  onEnvironmentChange(fn: (e: EnvironmentName) => void) { this.envHandlers.push(fn); }
  getEnvironment(): EnvironmentName { return this.currentEnv; }
  onPieceSetChange(fn: (s: PieceSetName) => void) { this.setHandlers.push(fn); }
  getPieceSet(): PieceSetName { return this.currentSet; }
  onQualityChange(fn: (q: QualityMode) => void) { this.qualityHandlers.push(fn); }

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
