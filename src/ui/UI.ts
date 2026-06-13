import { PieceColor, PieceType } from '../pieces/PieceFactory';
import type { SoundEngine } from '../engine/Sound';
import type { GameResult, GameResultKind } from '../game/Game';
import { EnvironmentName } from '../environments/Environment';
import { ENVIRONMENT_LABELS, ENVIRONMENT_ORDER } from '../environments/EnvironmentManager';
import { PIECE_SET_LABELS, PIECE_SET_ORDER, PieceSetName } from '../sets/PieceSet';
import { Quality, QualityMode } from '../engine/Quality';
import type { ProfileStore } from '../meta/Profile';
import {
  isSetUnlocked,
  isRealmUnlocked,
  setRequirement,
  realmRequirement,
} from '../meta/Unlocks';

interface UIState {
  turn: PieceColor;
  status: string;
  statusClass: 'idle' | 'check' | 'checkmate' | 'stalemate';
  capturedWhite: PieceType[];
  capturedBlack: PieceType[];
  gameOver: boolean;
  /** Granular outcome, or null while the game is in progress. */
  result: GameResult | null;
  /** Full move count (chess.js history length / 2, rounded up) for the share line. */
  moveCount?: number;
}

/** Human-readable headline + subtitle for each result kind, used by the modal. */
const RESULT_HEADLINE: Record<GameResultKind, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Draw',
  'fifty-move': 'Draw',
  insufficient: 'Draw',
  agreement: 'Draw',
  resignation: 'Resignation',
  timeout: 'Timeout',
  abandonment: 'Abandonment',
};

const RESULT_SUBTITLE: Record<GameResultKind, string> = {
  checkmate: 'The king has fallen.',
  stalemate: 'No legal moves remain, the realm draws breath.',
  threefold: 'The same position, thrice over.',
  'fifty-move': 'Fifty moves without a pawn or capture.',
  insufficient: 'Neither army can deliver mate.',
  agreement: 'Both sides agreed to a draw.',
  resignation: 'The flag is lowered in surrender.',
  timeout: 'The clock has run dry.',
  abandonment: 'The opponent has left the field.',
};

const PIECE_GLYPH: Record<PieceColor, Record<PieceType, string>> = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
  b: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' },
};

export type GameMode = 'hotseat' | 'ai-vs-white' | 'ai-vs-black' | 'online';
export type AIDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';

/** Canonical live URL, baked into the share string (F17). */
export const SHARE_URL = 'https://amsamms.github.io/chess-3d/';

/** Lock glyph used in front of a locked set/realm label. */
const LOCK_GLYPH = '\u{1F512}'; // padlock
/** Flame glyph used in the streak chip when streak >= 2. */
const FLAME_GLYPH = '\u{1F525}'; // fire

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
  /**
   * Cursors that walk the full set/realm cycle (locked entries included). They
   * track the ACTIVE entry, so a locked preview can advance the cursor without
   * desyncing the next click from where the player visually is.
   */
  private setCursor = PIECE_SET_ORDER.indexOf('fantasy');
  private envCursor = ENVIRONMENT_ORDER.indexOf('gothic-night');
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
  /**
   * Game-over modal deferral (F13 cinematics). When the cinematics layer is about
   * to play a checkmate/draw sequence it calls deferNextGameOver(); update() then
   * holds the modal in `pendingGameOver` instead of rendering it, and the
   * cinematics layer calls showGameOverNow() when the sequence ends or is skipped.
   * If the deferral is never resolved (e.g. cinematics disabled) the modal still
   * appears, so this can never strand the player on an empty board.
   */
  private deferGameOverArmed = false;
  private pendingGameOver: GameResult | null = null;
  private currentMode: GameMode = 'hotseat';
  private currentDifficulty: AIDifficulty = 'intermediate';

  /** Retention store (F2/F15), attached after construction. Null until then. */
  private profile: ProfileStore | null = null;
  private profileChipEl: HTMLElement | null = null;
  private onboardingOverlay: HTMLElement | null = null;
  private toastTimer: number | null = null;
  /** Move count of the most-recently finished game, for the share line. */
  private lastMoveCount = 0;

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

  // ---- Online live-game controls (resign / draw / clocks / disconnect) ----
  // These are SINGLE-SLOT (one active online game at a time). Re-wiring on a
  // rematch REPLACES the handler so a deactivated NetworkPlayer's closure cannot
  // keep firing (which additive arrays would cause across successive games).
  private resignHandler: (() => void) | null = null;
  private offerDrawHandler: (() => void) | null = null;
  private acceptDrawHandler: (() => void) | null = null;
  private declineDrawHandler: (() => void) | null = null;
  private claimWinHandler: (() => void) | null = null;
  private rematchHandler: (() => void) | null = null;
  /** Container for the resign/draw buttons + clocks, shown only during an online game. */
  private onlineActionsEl!: HTMLElement;
  private clockWhiteEl!: HTMLElement;
  private clockBlackEl!: HTMLElement;
  private disconnectBanner: HTMLElement | null = null;
  private disconnectTimer: number | null = null;
  /** Last known opponent presence, so a panel re-render shows the right dot. */
  private lastOpponentOnline = false;
  /** Whether we have received at least one real presence event (else "connecting"). */
  private presenceKnown = false;
  private difficultyLabel: Record<AIDifficulty, string> = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    master: 'Master',
  };

  // ---- Daily puzzle state ---------------------------------------------------
  /** True while puzzle mode is active (prevents realm/set switching). */
  private puzzleActive = false;
  /** Single-slot callback called when the "Daily" button is clicked. */
  private dailyHandler: (() => void) | null = null;
  /** Single-slot callback called when the "Exit Puzzle" button is clicked. */
  private exitPuzzleHandler: (() => void) | null = null;
  /** HUD puzzle panel element. */
  private puzzlePanelEl: HTMLElement | null = null;

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
      <div class="profile-chip" id="profile-chip" title="Your record (click for stats)"></div>
      <button class="help-btn" id="btn-help" title="How to play" aria-label="How to play">?</button>
      <div class="hud-toast" id="hud-toast" style="display:none"></div>
      <div class="captured-tray left">
        <div class="captured-tray-title">Black's Losses</div>
        <div class="captured-list" id="captured-left"></div>
        <div class="player-clock" id="clock-black" style="display:none">10:00</div>
      </div>
      <div class="captured-tray right">
        <div class="captured-tray-title">White's Losses</div>
        <div class="captured-list" id="captured-right"></div>
        <div class="player-clock" id="clock-white" style="display:none">10:00</div>
      </div>
      <div class="online-actions" id="online-actions" style="display:none">
        <button class="hud-btn online-btn-sm" id="btn-offer-draw">Offer Draw</button>
        <button class="hud-btn online-btn-sm online-resign" id="btn-resign">Resign</button>
      </div>
      <div class="hud-controls">
        <button class="hud-btn daily-btn" id="btn-daily" title="Daily puzzle">Daily</button>
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
      this.pendingGameOver = null;
      this.deferGameOverArmed = false;
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
      // Block realm changes while a puzzle is active to protect the board position.
      if (this.puzzleActive) {
        this.showToast('Exit the puzzle before switching realm.');
        return;
      }
      // Advance the cursor through ALL realms (locked included). Cursor starts
      // from the active realm; a locked entry is previewed (label + lock + toast)
      // but does NOT change the active realm.
      this.envCursor = (this.envCursor + 1) % ENVIRONMENT_ORDER.length;
      const next = ENVIRONMENT_ORDER[this.envCursor]!;
      if (this.profile && !isRealmUnlocked(next, this.profile)) {
        this.envBtn.textContent = `Realm: ${LOCK_GLYPH} ${ENVIRONMENT_LABELS[next]}`;
        this.showToast(`Realm locked: ${ENVIRONMENT_LABELS[next]} (${realmRequirement(next)})`);
        return;
      }
      this.currentEnv = next;
      this.envBtn.textContent = `Realm: ${ENVIRONMENT_LABELS[next]}`;
      for (const fn of this.envHandlers) fn(next);
    });

    this.setBtn = document.getElementById('btn-set') as HTMLButtonElement;
    this.setBtn.addEventListener('click', () => {
      // Block set changes while a puzzle is active to protect the board position.
      if (this.puzzleActive) {
        this.showToast('Exit the puzzle before switching piece set.');
        return;
      }
      this.setCursor = (this.setCursor + 1) % PIECE_SET_ORDER.length;
      const next = PIECE_SET_ORDER[this.setCursor]!;
      if (this.profile && !isSetUnlocked(next, this.profile)) {
        this.setBtn.textContent = `Set: ${LOCK_GLYPH} ${PIECE_SET_LABELS[next]}`;
        this.showToast(`Set locked: ${PIECE_SET_LABELS[next]} (${setRequirement(next)})`);
        return;
      }
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

    this.profileChipEl = document.getElementById('profile-chip');
    this.profileChipEl?.addEventListener('click', () => this.openProfilePopover());
    document.getElementById('btn-help')?.addEventListener('click', () => this.openOnboarding());

    // Online live-game controls (clocks + resign/draw).
    this.onlineActionsEl = document.getElementById('online-actions') as HTMLElement;
    this.clockWhiteEl = document.getElementById('clock-white') as HTMLElement;
    this.clockBlackEl = document.getElementById('clock-black') as HTMLElement;
    document.getElementById('btn-resign')?.addEventListener('click', () => {
      if (!window.confirm('Resign this game? Your opponent will be awarded the win.')) return;
      this.resignHandler?.();
    });
    document.getElementById('btn-offer-draw')?.addEventListener('click', () => {
      this.offerDrawHandler?.();
    });

    // Daily puzzle button.
    document.getElementById('btn-daily')?.addEventListener('click', () => {
      this.dailyHandler?.();
    });
  }

  // ---------------- Online live-game controls (F8 / F18 / draw) -------------

  onResign(fn: () => void) { this.resignHandler = fn; }
  onOfferDraw(fn: () => void) { this.offerDrawHandler = fn; }
  onAcceptDraw(fn: () => void) { this.acceptDrawHandler = fn; }
  onDeclineDraw(fn: () => void) { this.declineDrawHandler = fn; }
  onClaimWin(fn: () => void) { this.claimWinHandler = fn; }
  onRematch(fn: () => void) { this.rematchHandler = fn; }

  /**
   * Show / hide the in-game online controls (resign + offer draw) and the two
   * player clocks. Called when an online game becomes active or ends. Spectators
   * see the clocks but not the resign/draw buttons.
   */
  setOnlineGameActive(active: boolean, opts: { spectator?: boolean; clock?: boolean } = {}) {
    if (active) this.resetPresence();
    const showButtons = active && !opts.spectator;
    if (this.onlineActionsEl) this.onlineActionsEl.style.display = showButtons ? '' : 'none';
    const showClock = active && (opts.clock ?? false);
    if (this.clockWhiteEl) this.clockWhiteEl.style.display = showClock ? '' : 'none';
    if (this.clockBlackEl) this.clockBlackEl.style.display = showClock ? '' : 'none';
    if (!active) {
      this.hideDrawPrompt();
      this.hideDisconnectBanner();
    }
  }

  /** Render the two clocks each frame from the NetworkPlayer clock view (F18). */
  updateClocks(whiteMs: number, blackMs: number, running: 'w' | 'b' | null) {
    if (!this.clockWhiteEl || !this.clockBlackEl) return;
    this.clockWhiteEl.textContent = formatClock(whiteMs);
    this.clockBlackEl.textContent = formatClock(blackMs);
    this.clockWhiteEl.classList.toggle('running', running === 'w');
    this.clockBlackEl.classList.toggle('running', running === 'b');
    this.clockWhiteEl.classList.toggle('low', whiteMs <= 30000);
    this.clockBlackEl.classList.toggle('low', blackMs <= 30000);
  }

  /** Show the incoming-draw-offer prompt with Accept / Decline (draw offers). */
  showDrawPrompt() {
    this.hideDrawPrompt();
    const el = document.createElement('div');
    el.className = 'draw-prompt';
    el.id = 'draw-prompt';
    el.innerHTML = `
      <span class="draw-prompt-text">Your opponent offers a draw.</span>
      <button class="hud-btn online-btn-sm" id="btn-accept-draw">Accept</button>
      <button class="hud-btn online-btn-sm online-leave" id="btn-decline-draw">Decline</button>
    `;
    this.root.appendChild(el);
    document.getElementById('btn-accept-draw')?.addEventListener('click', () => {
      this.hideDrawPrompt();
      this.acceptDrawHandler?.();
    });
    document.getElementById('btn-decline-draw')?.addEventListener('click', () => {
      this.hideDrawPrompt();
      this.declineDrawHandler?.();
    });
  }

  hideDrawPrompt() {
    const el = document.getElementById('draw-prompt');
    if (el?.parentNode) el.parentNode.removeChild(el);
  }

  /** Brief toast confirming a draw offer was sent (or declined). */
  noteDrawState(msg: string) { this.showToast(msg); }

  /**
   * Show the "Opponent disconnected" banner with a live 60s countdown and a
   * Claim Win button (F8). The countdown is rendered here; the actual claim
   * fires the claimWin handlers. Call hideDisconnectBanner() if the opponent
   * reconnects within the window.
   */
  showDisconnectBanner(seconds = 60) {
    this.hideDisconnectBanner();
    const banner = document.createElement('div');
    banner.className = 'disconnect-banner';
    banner.id = 'disconnect-banner';
    let remaining = seconds;
    const render = () => {
      banner.innerHTML = `
        <span class="disconnect-text">Opponent disconnected. Claiming the win in <strong>${remaining}s</strong> if they do not return.</span>
        <button class="hud-btn online-btn-sm" id="btn-claim-win">Claim Win Now</button>
      `;
      document.getElementById('btn-claim-win')?.addEventListener('click', () => {
        this.hideDisconnectBanner();
        this.claimWinHandler?.();
      });
    };
    render();
    this.root.appendChild(banner);
    this.disconnectBanner = banner;
    this.disconnectTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.hideDisconnectBanner();
        this.claimWinHandler?.();
        return;
      }
      render();
    }, 1000);
  }

  hideDisconnectBanner() {
    if (this.disconnectTimer !== null) {
      window.clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.disconnectBanner?.parentNode) {
      this.disconnectBanner.parentNode.removeChild(this.disconnectBanner);
    }
    this.disconnectBanner = null;
  }

  /** Whether the disconnect banner is currently showing (so callers can cancel it). */
  isDisconnectBannerShowing(): boolean { return this.disconnectBanner !== null; }

  /** Update the opponent online/offline dot in the online panel (F8). */
  setOpponentPresence(online: boolean) {
    this.lastOpponentOnline = online;
    this.presenceKnown = true;
    this.renderPresence(online);
  }

  /** Reset presence tracking when a new online game begins. */
  resetPresence() {
    this.presenceKnown = false;
    this.lastOpponentOnline = false;
  }

  private renderPresence(online: boolean) {
    const dot = document.getElementById('presence-dot');
    const label = document.getElementById('presence-label');
    if (!dot || !label) return;
    const prefix = this.currentMode === 'online' ? 'Opponent' : 'Players';
    if (!this.presenceKnown) {
      // Until the first presence sync, show a neutral "connecting" state rather
      // than a false "offline" flash.
      dot.classList.remove('online', 'offline');
      label.textContent = `${prefix}: connecting…`;
      return;
    }
    dot.classList.toggle('online', online);
    dot.classList.toggle('offline', !online);
    label.textContent = online ? `${prefix}: online` : `${prefix}: offline`;
  }

  /**
   * Attach the retention store (F2/F15). Wires set/realm cycle gating, renders
   * the HUD profile chip, and shows the first-run onboarding overlay when no
   * prior profile exists. Called once from main.ts after the store loads.
   */
  attachProfile(store: ProfileStore) {
    this.profile = store;
    store.onChange(() => this.renderProfileChip());
    this.renderProfileChip();
    if (store.isFirstRun) this.openOnboarding();
  }

  /** Re-render the compact HUD profile chip (games + streak, flame when >= 2). */
  private renderProfileChip() {
    if (!this.profileChipEl || !this.profile) return;
    const p = this.profile.get();
    const flame = p.currentStreak >= 2 ? ` <span class="chip-flame">${FLAME_GLYPH}${p.currentStreak}</span>` : '';
    this.profileChipEl.innerHTML =
      `<span class="chip-label">Games</span> <strong>${p.gamesPlayed}</strong>` +
      `<span class="chip-sep">&middot;</span><span class="chip-label">Streak</span> <strong>${p.currentStreak}</strong>${flame}`;
  }

  /** Small transient subtitle toast (used for "locked" feedback). */
  private showToast(msg: string) {
    const el = document.getElementById('hud-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    el.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.classList.remove('show');
      this.toastTimer = window.setTimeout(() => { el.style.display = 'none'; }, 300);
    }, 2400);
  }

  /** Programmatic sync — used when boot auto-detects mobile and forces 'low'. */
  setQualityLabel(mode: QualityMode) {
    if (this.qualityBtn) this.qualityBtn.textContent = `Quality: ${this.qualityLabel[mode]}`;
  }

  /**
   * Restore the persisted piece set on boot (F14), without firing the change
   * handler (main.ts applies it to the game directly). Falls back to the
   * default if the stored set is no longer unlocked for this profile.
   */
  restoreSet(set: PieceSetName) {
    const usable = this.profile && !isSetUnlocked(set, this.profile) ? 'fantasy' : set;
    this.currentSet = usable;
    this.setCursor = PIECE_SET_ORDER.indexOf(usable);
    if (this.setBtn) this.setBtn.textContent = `Set: ${PIECE_SET_LABELS[usable]}`;
  }

  /** Restore the persisted realm on boot (F14). Falls back if now locked. */
  restoreEnvironment(env: EnvironmentName) {
    const usable = this.profile && !isRealmUnlocked(env, this.profile) ? 'gothic-night' : env;
    this.currentEnv = usable;
    this.envCursor = ENVIRONMENT_ORDER.indexOf(usable);
    if (this.envBtn) this.envBtn.textContent = `Realm: ${ENVIRONMENT_LABELS[usable]}`;
  }

  /** Restore the persisted AI tier on boot (F14). */
  restoreDifficulty(d: AIDifficulty) {
    this.currentDifficulty = d;
    if (this.difficultyBtn) this.difficultyBtn.textContent = `Skill: ${this.difficultyLabel[d]}`;
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
          <div class="online-presence" id="online-presence">
            <span class="presence-dot" id="presence-dot"></span>
            <span class="presence-label" id="presence-label">Opponent: connecting…</span>
          </div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Leave Game</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        this.renderPresence(this.lastOpponentOnline);
        break;
      case 'watching':
        body.innerHTML = `
          <div class="online-panel-status">Watching as spectator</div>
          <div class="online-panel-code">Room: <span>${state.roomCode}</span></div>
          <div class="online-presence" id="online-presence">
            <span class="presence-dot" id="presence-dot"></span>
            <span class="presence-label" id="presence-label">Players: connecting…</span>
          </div>
          <button class="hud-btn online-btn-sm online-leave" id="btn-online-leave">Stop Watching</button>
        `;
        document.getElementById('btn-online-leave')?.addEventListener('click', () => {
          for (const fn of this.onlineLeaveHandlers) fn();
        });
        this.renderPresence(this.lastOpponentOnline);
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

  // ---------------- Daily Puzzle (F3) ----------------------------------------

  /** Register the callback invoked when the Daily button is pressed. */
  onDailyPuzzle(fn: () => void) { this.dailyHandler = fn; }
  /** Register the callback invoked when the Exit Puzzle button is pressed. */
  onExitPuzzle(fn: () => void) { this.exitPuzzleHandler = fn; }

  /**
   * Mark the daily puzzle button as solved (removes pulse) or unsolved (adds
   * pulse animation so the player notices it). Called on boot and after a solve.
   */
  setDailyPuzzleSolved(solved: boolean) {
    const btn = document.getElementById('btn-daily');
    if (!btn) return;
    btn.classList.toggle('daily-btn-solved', solved);
    btn.classList.toggle('daily-btn-unsolved', !solved);
    btn.title = solved ? 'Daily puzzle (solved today)' : 'Daily puzzle (try today\'s puzzle!)';
  }

  /**
   * Show the puzzle panel (replaces any existing panel). Enters puzzle mode:
   * disables realm/set switching so a mid-puzzle piece rebuild cannot corrupt
   * the puzzle position. The Exit Puzzle button restores normal state.
   *
   * state - 'loading': spinner
   * state - 'active': progress bar + wrong-move feedback
   * state - 'solved': completion summary + share
   * state - 'error': error message
   */
  showPuzzlePanel(state: 'loading' | 'active' | 'solved' | 'error', opts: {
    title?: string;
    source?: 'lichess' | 'fallback';
    credit?: string;
    stepIndex?: number;
    totalSteps?: number;
    attempts?: number;
    streak?: number;
    bestStreak?: number;
    errorMsg?: string;
    date?: string;
  } = {}) {
    this.puzzleActive = true;
    this.hidePuzzlePanel();

    const panel = document.createElement('div');
    panel.className = 'puzzle-panel';
    panel.id = 'puzzle-panel';

    const titleText = opts.title ?? 'Daily Puzzle';
    const sourceTag = opts.source === 'lichess'
      ? '<span class="puzzle-source lichess">Lichess</span>'
      : opts.source === 'fallback'
        ? '<span class="puzzle-source fallback">Classic</span>'
        : '';

    if (state === 'loading') {
      panel.innerHTML = `
        <div class="puzzle-panel-header">
          <span class="puzzle-panel-title">${titleText}</span>
          ${sourceTag}
        </div>
        <div class="puzzle-loading">Loading puzzle<span class="puzzle-loading-dots">...</span></div>
        <button class="hud-btn puzzle-exit-btn" id="btn-exit-puzzle">Exit Puzzle</button>
      `;
    } else if (state === 'active') {
      const step = opts.stepIndex ?? 0;
      const total = opts.totalSteps ?? 1;
      // Player moves only (odd-indexed are replies, so count player steps).
      const playerSteps = Math.ceil(total / 2);
      const playerDone = Math.floor(step / 2);
      const dots = Array.from({ length: playerSteps }, (_, i) =>
        `<span class="puzzle-dot ${i < playerDone ? 'done' : i === playerDone ? 'current' : ''}"></span>`,
      ).join('');
      panel.innerHTML = `
        <div class="puzzle-panel-header">
          <span class="puzzle-panel-title">${titleText}</span>
          ${sourceTag}
        </div>
        <div class="puzzle-instructions">Find the best move(s) for ${opts.stepIndex !== undefined && step % 2 === 0 ? 'your side' : 'your side'}.</div>
        <div class="puzzle-progress" id="puzzle-progress">${dots}</div>
        <div class="puzzle-attempts" id="puzzle-attempts">${(opts.attempts ?? 0) > 0 ? `${opts.attempts} wrong move${(opts.attempts ?? 0) === 1 ? '' : 's'}` : ''}</div>
        <button class="hud-btn puzzle-exit-btn" id="btn-exit-puzzle">Exit Puzzle</button>
      `;
    } else if (state === 'solved') {
      const s = opts.streak ?? 0;
      const best = opts.bestStreak ?? 0;
      const tries = opts.attempts ?? 1;
      const dateStr = opts.date ?? uiTodayIso();
      const streakLine = s >= 2
        ? `<div class="puzzle-streak">${FLAME_GLYPH} ${s}-day puzzle streak! (best ${best})</div>`
        : s === 1
          ? `<div class="puzzle-streak">Puzzle streak started!</div>`
          : '';
      panel.innerHTML = `
        <div class="puzzle-panel-header">
          <span class="puzzle-panel-title">${titleText}</span>
          ${sourceTag}
        </div>
        <div class="puzzle-solved-banner">Solved!</div>
        ${streakLine}
        <div class="puzzle-attempts-final">Solved in ${tries} attempt${tries === 1 ? '' : 's'}.</div>
        <div class="puzzle-actions">
          <button class="hud-btn puzzle-share-btn" id="btn-puzzle-share" data-date="${dateStr}" data-tries="${tries}" data-streak="${s}">Share</button>
          <button class="hud-btn puzzle-exit-btn" id="btn-exit-puzzle">Exit Puzzle</button>
        </div>
      `;
    } else {
      panel.innerHTML = `
        <div class="puzzle-panel-header">
          <span class="puzzle-panel-title">Daily Puzzle</span>
        </div>
        <div class="puzzle-error">${opts.errorMsg ?? 'Could not load puzzle.'}</div>
        <button class="hud-btn puzzle-exit-btn" id="btn-exit-puzzle">Exit Puzzle</button>
      `;
    }

    this.root.appendChild(panel);
    this.puzzlePanelEl = panel;

    document.getElementById('btn-exit-puzzle')?.addEventListener('click', () => {
      this.exitPuzzleHandler?.();
    });
    document.getElementById('btn-puzzle-share')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      const date = btn.dataset['date'] ?? uiTodayIso();
      const tries = parseInt(btn.dataset['tries'] ?? '1', 10);
      const streak = parseInt(btn.dataset['streak'] ?? '0', 10);
      this.copyShareText(this.buildPuzzleShareText(date, tries, streak), btn);
    });
  }

  /** Flash the attempt counter when a wrong move is made. */
  flashWrongMove(attempts: number) {
    const el = document.getElementById('puzzle-attempts');
    if (el) {
      el.textContent = `${attempts} wrong move${attempts === 1 ? '' : 's'}`;
      el.classList.remove('puzzle-wrong-flash');
      // Trigger reflow so the animation restarts.
      void el.offsetWidth;
      el.classList.add('puzzle-wrong-flash');
    }
    // Also flash the panel border.
    const panel = document.getElementById('puzzle-panel');
    if (panel) {
      panel.classList.remove('puzzle-flash-wrong');
      void panel.offsetWidth;
      panel.classList.add('puzzle-flash-wrong');
      setTimeout(() => panel.classList.remove('puzzle-flash-wrong'), 600);
    }
  }

  /** Advance the progress dots when a correct move is made. */
  updatePuzzleProgress(stepIndex: number, totalSteps: number) {
    const container = document.getElementById('puzzle-progress');
    if (!container) return;
    const playerSteps = Math.ceil(totalSteps / 2);
    const playerDone = Math.floor(stepIndex / 2);
    container.innerHTML = Array.from({ length: playerSteps }, (_, i) =>
      `<span class="puzzle-dot ${i < playerDone ? 'done' : i === playerDone ? 'current' : ''}"></span>`,
    ).join('');
  }

  /** Remove the puzzle panel from the DOM and exit puzzle mode. */
  hidePuzzlePanel() {
    this.puzzleActive = false;
    if (this.puzzlePanelEl?.parentNode) {
      this.puzzlePanelEl.parentNode.removeChild(this.puzzlePanelEl);
    }
    this.puzzlePanelEl = null;
    // Remove any lingering panel by id as a safety net.
    document.getElementById('puzzle-panel')?.remove();
  }

  /** Whether the puzzle panel is currently showing. */
  isPuzzleActive(): boolean { return this.puzzleActive; }

  /** Compose the daily puzzle share string (F3 spec). */
  private buildPuzzleShareText(date: string, tries: number, streak: number): string {
    const streakPart = streak >= 1 ? `, streak ${streak}` : '';
    return `Chess 3D Daily #${date} solved in ${tries} tr${tries === 1 ? 'y' : 'ies'}${streakPart}\n${SHARE_URL}`;
  }

  // ---------- Realm/Set switching gate (disabled in puzzle mode) ----------

  /**
   * Override the env/set cycle buttons to be blocked while a puzzle is active,
   * since re-building pieces mid-puzzle would reset the board position.
   * Called by the existing env/set handlers: they check this before firing.
   */
  isPuzzleBlockingSetChange(): boolean { return this.puzzleActive; }

  onEnvironmentChange(fn: (e: EnvironmentName) => void) { this.envHandlers.push(fn); }
  getEnvironment(): EnvironmentName { return this.currentEnv; }
  onPieceSetChange(fn: (s: PieceSetName) => void) { this.setHandlers.push(fn); }
  getPieceSet(): PieceSetName { return this.currentSet; }
  onQualityChange(fn: (q: QualityMode) => void) { this.qualityHandlers.push(fn); }

  private aiThinking = false;
  setAiThinking(thinking: boolean) {
    this.aiThinking = thinking;
    this.aiThinkingEl.style.display = thinking ? '' : 'none';
    // Subtle echo in the HUD status line, but never clobber a check / game-over
    // message (those take priority and own the status element).
    if (this.statusEl && !this.statusEl.classList.contains('check')
        && !this.statusEl.classList.contains('checkmate')
        && !this.statusEl.classList.contains('stalemate')) {
      this.statusEl.textContent = thinking ? 'The opponent is plotting its move…' : '';
    }
  }

  onModeChange(fn: (m: GameMode) => void) { this.modeHandlers.push(fn); }
  onDifficultyChange(fn: (d: AIDifficulty) => void) { this.difficultyHandlers.push(fn); }
  getMode(): GameMode { return this.currentMode; }
  getDifficulty(): AIDifficulty { return this.currentDifficulty; }

  private soundChangeHandlers: Array<(muted: boolean) => void> = [];
  attachSound(s: SoundEngine) {
    const btn = document.getElementById('btn-sound') as HTMLButtonElement;
    // Reflect the restored mute state (F14) in the initial label.
    btn.textContent = s.isMuted() ? 'Sound: Off' : 'Sound: On';
    btn.addEventListener('click', () => {
      const next = !s.isMuted();
      s.setMuted(next);
      btn.textContent = next ? 'Sound: Off' : 'Sound: On';
      for (const fn of this.soundChangeHandlers) fn(next);
    });
  }

  /** Subscribe to sound-mute toggles, so main.ts can persist the choice (F14). */
  onSoundChange(fn: (muted: boolean) => void) { this.soundChangeHandlers.push(fn); }

  onRestart(fn: () => void) {
    this.restartHandlers.push(fn);
  }

  // ---------------- Onboarding overlay (F16) ----------------

  /**
   * First-run / on-demand onboarding. One screen: how to move, the three modes,
   * camera controls, and a dismiss button. Reopened any time via the "?" HUD
   * button. Styled with the gothic palette. Idempotent (closes any prior copy).
   */
  openOnboarding() {
    this.closeOnboarding();
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const cameraLine = coarsePointer
      ? 'Drag to orbit, pinch to zoom, two-finger drag to pan.'
      : 'Drag to orbit, scroll to zoom, right-click drag to pan.';
    const moveLine = coarsePointer
      ? 'Tap one of your pieces, then tap a highlighted square to move it.'
      : 'Click one of your pieces, then click a highlighted square to move it.';
    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.id = 'onboarding-overlay';
    overlay.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-title">Welcome to Chess 3D</div>
        <div class="onboarding-section">
          <div class="onboarding-heading">Making a move</div>
          <p>${moveLine} Green dots are quiet moves, red rings are captures. Promote a pawn and a picker lets you choose the piece.</p>
        </div>
        <div class="onboarding-section">
          <div class="onboarding-heading">Three ways to play</div>
          <ul class="onboarding-list">
            <li><strong>Hot-seat</strong>: two players share one screen, taking turns.</li>
            <li><strong>Vs AI</strong>: play the computer; pick a skill from Beginner to Master.</li>
            <li><strong>Online</strong>: match a stranger or share a room code with a friend.</li>
          </ul>
        </div>
        <div class="onboarding-section">
          <div class="onboarding-heading">Moving the camera</div>
          <p>${cameraLine}</p>
        </div>
        <div class="onboarding-section onboarding-progress">
          <p>Win games to unlock new piece sets and realms. Reopen this guide any time with the <strong>?</strong> button.</p>
        </div>
        <button class="hud-btn onboarding-dismiss" id="btn-onboarding-dismiss">Begin</button>
      </div>
    `;
    // Clicking the backdrop (not the card) also dismisses.
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === overlay) this.closeOnboarding();
    });
    this.root.appendChild(overlay);
    this.onboardingOverlay = overlay;
    document.getElementById('btn-onboarding-dismiss')?.addEventListener('click', () => this.closeOnboarding());
  }

  private closeOnboarding() {
    if (this.onboardingOverlay && this.onboardingOverlay.parentNode) {
      this.onboardingOverlay.parentNode.removeChild(this.onboardingOverlay);
    }
    this.onboardingOverlay = null;
  }

  // ---------------- Profile popover + sharing (F2 / F17) ----------------

  /**
   * Popover anchored to the HUD chip showing the player's record, best streak,
   * captures, and a Share button (reuses the same share string as the game-over
   * modal). Clicking the backdrop closes it.
   */
  private openProfilePopover() {
    if (!this.profile) return;
    // Toggle: a second click on the chip closes an open popover.
    const existing = document.getElementById('profile-popover');
    if (existing) { existing.remove(); return; }
    const p = this.profile.get();
    const overlay = document.createElement('div');
    overlay.className = 'profile-popover';
    overlay.id = 'profile-popover';
    const aiWins = this.profile.totalAiWins();
    const onlineWLD = p.byMode['online'];
    overlay.innerHTML = `
      <div class="profile-popover-card">
        <div class="profile-popover-title">Your Record</div>
        <div class="profile-stats">
          <div class="profile-stat"><span>Games</span><strong>${p.gamesPlayed}</strong></div>
          <div class="profile-stat"><span>Streak</span><strong>${p.currentStreak}${p.currentStreak >= 2 ? ' ' + FLAME_GLYPH : ''}</strong></div>
          <div class="profile-stat"><span>Best streak</span><strong>${p.bestStreak}</strong></div>
          <div class="profile-stat"><span>AI wins</span><strong>${aiWins}</strong></div>
          <div class="profile-stat"><span>Online W/L/D</span><strong>${onlineWLD.wins}/${onlineWLD.losses}/${onlineWLD.draws}</strong></div>
          <div class="profile-stat"><span>Captures</span><strong>${p.totalCaptures}</strong></div>
        </div>
        <button class="hud-btn online-btn-sm" id="btn-profile-share">Share</button>
        <button class="hud-btn online-btn-sm" id="btn-profile-close">Close</button>
      </div>
    `;
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    this.root.appendChild(overlay);
    document.getElementById('btn-profile-close')?.addEventListener('click', () => overlay.remove());
    document.getElementById('btn-profile-share')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      this.copyShareText(this.buildProfileShareText(), btn);
    });
  }

  /** Compose a share string for the standing record (profile popover). */
  private buildProfileShareText(): string {
    if (!this.profile) return SHARE_URL;
    const p = this.profile.get();
    const streakLine = p.currentStreak >= 2
      ? `On a ${p.currentStreak}-game win streak ${FLAME_GLYPH} (best ${p.bestStreak}).`
      : `Best win streak: ${p.bestStreak}.`;
    return `Chess 3D: ${p.gamesPlayed} games played, ${this.profile.totalAiWins()} AI wins. ${streakLine}\nPlay: ${SHARE_URL}`;
  }

  /**
   * Copy text to the clipboard with a textarea fallback for browsers without
   * the async clipboard API (or when it rejects). Flashes the button label.
   */
  private copyShareText(text: string, btn: HTMLButtonElement) {
    const flash = () => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { if (btn) btn.textContent = orig; }, 1400);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
      flash();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else {
      fallback();
    }
  }

  update(state: UIState) {
    this.turnLabel.textContent = `${state.turn === 'w' ? 'White' : 'Black'} to move`;
    this.turnOrb.classList.toggle('black', state.turn === 'b');

    // If the AI is mid-think and there is no higher-priority status (check /
    // game-over), keep the subtle "plotting" hint instead of an empty line.
    const idleStatus = state.status === '' && state.statusClass === 'idle';
    this.statusEl.textContent = idleStatus && this.aiThinking
      ? 'The opponent is plotting its move…'
      : state.status;
    this.statusEl.className = `hud-status ${state.statusClass}`;

    // Captured pieces — left tray shows black losses (captured by white), right shows white losses.
    this.capturedLeftList.innerHTML = state.capturedBlack
      .map((t) => `<span>${PIECE_GLYPH.b[t]}</span>`)
      .join('');
    this.capturedRightList.innerHTML = state.capturedWhite
      .map((t) => `<span>${PIECE_GLYPH.w[t]}</span>`)
      .join('');

    // Stash the latest move count so the modal/share can read it.
    if (typeof state.moveCount === 'number') this.lastMoveCount = state.moveCount;

    // Dedupe on the result kind + winner so the modal pops exactly once per
    // terminal state (draws have winner=null but must still show).
    const resultKey = state.result ? `${state.result.kind}:${state.result.winner ?? ''}` : null;
    if (state.gameOver && state.result && this.gameOverShownFor !== resultKey) {
      this.gameOverShownFor = resultKey;
      if (this.deferGameOverArmed) {
        // Cinematics will reveal the modal when its sequence ends (or is skipped).
        // We mark the dedupe key now so a re-render does not double-fire.
        this.deferGameOverArmed = false;
        this.pendingGameOver = state.result;
      } else {
        this.showGameOver(state.result);
      }
    } else if (!state.gameOver) {
      this.pendingGameOver = null;
      this.removeGameOver();
    }
  }

  /**
   * Arm a one-shot deferral of the next game-over modal (F13). The cinematics
   * layer calls this just before a terminal state propagates so the modal waits
   * for the checkmate / draw camera sequence. It is consumed exactly once.
   */
  deferNextGameOver() {
    this.deferGameOverArmed = true;
  }

  /**
   * Reveal a deferred game-over modal immediately (F13). Called by the cinematics
   * layer when its sequence ends or the user clicks to skip. No-op if there is no
   * pending modal (e.g. it was already shown, or the game was reset meanwhile).
   */
  showGameOverNow() {
    const pending = this.pendingGameOver;
    this.pendingGameOver = null;
    this.deferGameOverArmed = false;
    if (!pending) return;
    if (this.gameOverModal) return; // already on screen
    this.showGameOver(pending);
  }

  private showGameOver(result: GameResult) {
    this.removeGameOver();
    // Decisive outcomes name the victor; draw kinds use a neutral headline.
    const title = result.winner
      ? `${result.winner} Wins`
      : RESULT_HEADLINE[result.kind];
    const subtitle = result.winner
      ? `${RESULT_HEADLINE[result.kind]}: ${RESULT_SUBTITLE[result.kind]}`
      : RESULT_SUBTITLE[result.kind];

    // Stats + streak callout (F2/F17). Profile is already updated for this game
    // because Game fires the game-end hook before this modal renders.
    let statsHtml = '';
    let streakHtml = '';
    if (this.profile) {
      const p = this.profile.get();
      statsHtml = `
        <div class="game-over-stats">
          <span>${p.gamesPlayed} games</span>
          <span>${this.profile.totalAiWins()} AI wins</span>
          <span>${p.totalCaptures} captures</span>
        </div>`;
      if (p.currentStreak >= 2) {
        streakHtml = `<div class="game-over-streak">${FLAME_GLYPH} ${p.currentStreak}-game win streak! (best ${p.bestStreak})</div>`;
      } else if (this.outcomeIsLoss(result) && p.bestStreak > 0) {
        streakHtml = `<div class="game-over-streak muted">Win streak reset. Best so far: ${p.bestStreak}.</div>`;
      }
    }

    const movesLabel = this.lastMoveCount > 0
      ? `<div class="game-over-moves">in ${this.lastMoveCount} move${this.lastMoveCount === 1 ? '' : 's'}</div>`
      : '';

    // Online games (F19): "Play Again" would silently desync the live room, so
    // we replace it with a Rematch button driving the Broadcast handshake. The
    // first action button is rematch online, play-again otherwise.
    const online = this.currentMode === 'online';
    const primaryBtn = online
      ? `<button class="hud-btn" id="btn-rematch">Rematch</button>`
      : `<button class="hud-btn" id="btn-play-again">Play Again</button>`;

    const modal = document.createElement('div');
    modal.className = 'game-over-modal';
    modal.innerHTML = `
      <div class="game-over-card">
        <div class="game-over-title">${title}</div>
        <div class="game-over-subtitle">${subtitle}</div>
        ${movesLabel}
        ${streakHtml}
        ${statsHtml}
        <div class="game-over-actions">
          ${primaryBtn}
          <button class="hud-btn" id="btn-share-result">Share</button>
        </div>
      </div>
    `;
    this.root.appendChild(modal);
    if (online) {
      document.getElementById('btn-rematch')?.addEventListener('click', () => {
        this.rematchHandler?.();
      });
    } else {
      document.getElementById('btn-play-again')!.addEventListener('click', () => {
        this.gameOverShownFor = null;
        this.removeGameOver();
        for (const fn of this.restartHandlers) fn();
      });
    }
    document.getElementById('btn-share-result')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      this.copyShareText(this.buildResultShareText(result), btn);
    });
    this.gameOverModal = modal;
  }

  /**
   * Reflect the rematch handshake phase (F19) on the open game-over modal's
   * Rematch button: "Rematch" (none), "Waiting for opponent..." (offered-by-me),
   * "Opponent wants a rematch! Accept" (offered-by-them), "Setting up..." (agreed).
   */
  setRematchPhase(phase: 'none' | 'offered-by-me' | 'offered-by-them' | 'agreed') {
    const btn = document.getElementById('btn-rematch') as HTMLButtonElement | null;
    if (!btn) return;
    switch (phase) {
      case 'none': btn.textContent = 'Rematch'; btn.disabled = false; break;
      case 'offered-by-me': btn.textContent = 'Waiting for opponent...'; btn.disabled = true; break;
      case 'offered-by-them': btn.textContent = 'Opponent wants a rematch! Accept'; btn.disabled = false; break;
      case 'agreed': btn.textContent = 'Setting up rematch...'; btn.disabled = true; break;
    }
  }

  /** Did this result count as a LOSS for the local player? Used for the reset note. */
  private outcomeIsLoss(result: GameResult): boolean {
    if (!result.winner) return false;
    // In AI / online modes the player has a fixed color; in hot-seat there is no
    // single "you", so a loss note is meaningless and suppressed.
    if (this.currentMode === 'hotseat' || this.currentMode === 'online') return false;
    const myColor = this.currentMode === 'ai-vs-black' ? 'White' : 'Black';
    return result.winner !== myColor;
  }

  /**
   * Compose the share string for a finished game (F17): mode/tier, result, move
   * count, a streak line, and the live URL.
   */
  private buildResultShareText(result: GameResult): string {
    const modeLabel = this.currentMode === 'hotseat'
      ? 'Hot-seat'
      : this.currentMode === 'online'
        ? 'Online'
        : `Vs AI (${this.difficultyLabel[this.currentDifficulty]})`;
    const outcome = result.winner ? `${result.winner} won by ${RESULT_HEADLINE[result.kind].toLowerCase()}` : RESULT_HEADLINE[result.kind];
    const movesPart = this.lastMoveCount > 0 ? ` in ${this.lastMoveCount} moves` : '';
    let streakLine = '';
    if (this.profile) {
      const p = this.profile.get();
      if (p.currentStreak >= 2) streakLine = `\n${FLAME_GLYPH} ${p.currentStreak}-game win streak (best ${p.bestStreak}).`;
    }
    return `Chess 3D (${modeLabel}): ${outcome}${movesPart}.${streakLine}\nPlay: ${SHARE_URL}`;
  }

  private removeGameOver() {
    if (this.gameOverModal && this.gameOverModal.parentNode) {
      this.gameOverModal.parentNode.removeChild(this.gameOverModal);
    }
    this.gameOverModal = null;
  }

  /**
   * Public teardown of the game-over modal + its dedupe key (F19). The online
   * rematch flow calls this when both players agree and the fresh room opens, so
   * the next game's result can re-show the modal.
   */
  removeGameOverModal() {
    this.removeGameOver();
    this.gameOverShownFor = null;
    this.pendingGameOver = null;
    this.deferGameOverArmed = false;
  }
}

/**
 * Return today's date as an ISO YYYY-MM-DD string (UTC).
 * Mirrors DailyPuzzle.todayIso() without creating a circular import dependency.
 */
function uiTodayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format remaining clock ms as M:SS (or M:SS.t under 10s for tension). Clamped
 * at zero. Used by the two online player clocks (F18).
 */
function formatClock(ms: number): string {
  const totalMs = Math.max(0, ms);
  const totalSec = Math.floor(totalMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (totalSec < 10) {
    const tenths = Math.floor((totalMs % 1000) / 100);
    return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
