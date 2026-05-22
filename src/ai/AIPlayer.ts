import { Game } from '../game/Game';
import { StockfishEngine } from './StockfishEngine';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';

interface DifficultySpec {
  skill: number;     // 0..20 — official UCI skill knob
  movetimeMs: number; // how long the engine thinks
}

const DIFFICULTY_PRESETS: Record<Difficulty, DifficultySpec> = {
  beginner:     { skill: 1,  movetimeMs: 250 },
  intermediate: { skill: 8,  movetimeMs: 600 },
  advanced:     { skill: 14, movetimeMs: 1200 },
  master:       { skill: 20, movetimeMs: 2500 },
};

export type AIColor = 'w' | 'b';

/**
 * Hooks Stockfish into the Game's turn cycle.
 * When it's the AI's color, it queries Stockfish, waits for bestmove, then executes via game.devMove.
 */
export class AIPlayer {
  private engine = new StockfishEngine();
  private active = false;
  private aiColor: AIColor = 'b';
  private difficulty: Difficulty = 'intermediate';
  /**
   * Bumped on every stop() call. start() captures the current value at entry
   * and only finalizes (sets active=true, hooks listener, triggers maybeMove)
   * if no stop arrived during its async init. Without this, a stop() that
   * fires while engine.init() is awaiting WASM load is silently overwritten
   * when start() resumes — and the AI plays a ghost move into whatever mode
   * the user has since switched to (e.g., a freshly-created online room).
   */
  private startEpoch = 0;
  private listenerSubscribed = false;

  constructor(private readonly game: Game) {}

  async start(aiColor: AIColor, difficulty: Difficulty): Promise<void> {
    this.aiColor = aiColor;
    this.difficulty = difficulty;
    this.startEpoch += 1;
    const myEpoch = this.startEpoch;
    if (!this.engine.isReady()) {
      await this.engine.init();
    }
    // If stop() (or another start) ran while we were awaiting init, give up.
    if (myEpoch !== this.startEpoch) return;
    this.engine.setSkill(DIFFICULTY_PRESETS[difficulty].skill);
    this.active = true;
    // Subscribe ONCE — repeat starts shouldn't keep stacking listeners.
    if (!this.listenerSubscribed) {
      this.game.onAfterMove(() => this.maybeMove());
      this.listenerSubscribed = true;
    }
    this.maybeMove();
  }

  stop() {
    this.active = false;
    this.startEpoch += 1; // invalidate any in-flight start()
    this.engine.stop();
  }

  private async maybeMove() {
    if (!this.active) return;
    const chess = this.game.devChess();
    if (chess.turn() !== this.aiColor) return;
    if (chess.isGameOver()) return;
    if (this.game.isAnimating()) return;

    const fen = chess.fen();
    const spec = DIFFICULTY_PRESETS[this.difficulty];
    this.game.setAiThinking(true);
    const move = await this.engine.bestMove(fen, spec.movetimeMs);
    this.game.setAiThinking(false);
    if (!move || !this.active) return;
    await this.game.devMove({ from: move.from, to: move.to, promotion: move.promotion });
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.engine.setSkill(DIFFICULTY_PRESETS[d].skill);
  }
}
