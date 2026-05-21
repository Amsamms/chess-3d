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

  constructor(private readonly game: Game) {}

  async start(aiColor: AIColor, difficulty: Difficulty): Promise<void> {
    this.aiColor = aiColor;
    this.difficulty = difficulty;
    if (!this.engine.isReady()) {
      await this.engine.init();
    }
    this.engine.setSkill(DIFFICULTY_PRESETS[difficulty].skill);
    this.active = true;
    // Subscribe to game move events
    this.game.onAfterMove(() => this.maybeMove());
    // Trigger immediately if it's AI's turn (e.g., AI plays white)
    this.maybeMove();
  }

  stop() {
    this.active = false;
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
