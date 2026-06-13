import { Game } from '../game/Game';
import { StockfishEngine, BestMoveResult } from './StockfishEngine';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'master';

// ---- Difficulty configuration -----------------------------------------------
//
// Design targets (approximate ELO feel):
//   Beginner     ~800-1000  - plausible but blundering chess; varies per game
//   Intermediate ~1350-1500 - plays proper chess with occasional oversights
//   Strong       ~1900      - solid; UCI_LimitStrength in effect
//   Master       ~2800+     - full engine, no artificial weakening
//
// Stockfish's UCI_Elo floor is 1320. For Beginner we cannot use UCI_Elo alone
// (1320 is already too strong for a novice). Instead we combine:
//   - Skill Level 0 (maximally blundering)
//   - Very short movetime OR very shallow fixed depth
//   - MultiPV randomization: request 4 candidates, pick stochastically with
//     exponential weights so rank-1 gets ~40%, rank-2 ~27%, rank-3 ~18%,
//     rank-4 ~12% (approximately). This means the beginner plays plausibly
//     but not optimally, and picks different moves each game.
//
// Opening variety for all tiers below Master: during the first OPENING_PLIES
// half-moves we use MultiPV + weighted random to avoid a fixed repertoire.
// -------------------------------------------------------------------------------

interface DifficultySpec {
  skill: number;        // UCI Skill Level 0..20
  movetimeMs: number;   // search budget per move
  useELO: boolean;      // enable UCI_LimitStrength + UCI_Elo
  elo?: number;         // target ELO (only if useELO)
  openingMultiPV: number; // MultiPV during opening plies (1 = no randomisation)
  midgameMultiPV: number; // MultiPV after opening (1 = play best move)
}

const DIFFICULTY_PRESETS: Record<Difficulty, DifficultySpec> = {
  beginner: {
    skill: 0,
    movetimeMs: 100,   // 100ms cap keeps depth very shallow
    useELO: false,     // cannot use UCI_Elo (floor 1320 > target ~900)
    openingMultiPV: 4,
    midgameMultiPV: 4, // keep random throughout; beginner "forgets" plans
  },
  intermediate: {
    skill: 5,
    movetimeMs: 500,
    useELO: true,
    elo: 1400,
    openingMultiPV: 3,
    midgameMultiPV: 1,
  },
  advanced: {
    skill: 14,
    movetimeMs: 1200,
    useELO: true,
    elo: 1900,
    openingMultiPV: 2,
    midgameMultiPV: 1,
  },
  master: {
    skill: 20,
    movetimeMs: 2500,
    useELO: false,     // full strength, no artificial cap
    openingMultiPV: 1,
    midgameMultiPV: 1,
  },
};

// Half-move count beyond which we stop applying opening-variety randomisation.
const OPENING_PLIES = 14; // roughly moves 1-7 for each side

// ---- Weighted random selection -----------------------------------------------
// Weights for MultiPV ranks 1..N (exponential decay so rank-1 is most likely
// but lower ranks still get a fair share, especially for Beginner).
// If there are fewer candidates than weights, we use however many arrived.
const MULTIPV_WEIGHTS = [0.40, 0.27, 0.18, 0.12, 0.03];

function weightedPick(candidates: BestMoveResult[]): BestMoveResult {
  const n = Math.min(candidates.length, MULTIPV_WEIGHTS.length);
  const weights = MULTIPV_WEIGHTS.slice(0, n);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[0]; // fallback
}

// ---- AIPlayer ----------------------------------------------------------------

export type AIColor = 'w' | 'b';

/**
 * Hooks Stockfish into the Game's turn cycle.
 * When it is the AI's color, it queries Stockfish, waits for bestmove, then
 * executes via game.devMove.
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
   * when start() resumes - and the AI plays a ghost move into whatever mode
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

    this.applyDifficultyOptions(difficulty);
    this.active = true;

    // Subscribe ONCE - repeat starts should not keep stacking listeners.
    if (!this.listenerSubscribed) {
      this.game.onAfterMove(() => this.maybeMove());
      // After a Restart the board is wiped and no afterMove fires, so the AI
      // would never open the game when it plays White. onAfterReset re-evaluates
      // whether it is the AI's turn in the fresh position. (F5)
      this.game.onAfterReset(() => this.maybeMove());
      this.listenerSubscribed = true;
    }
    this.maybeMove();
  }

  stop() {
    this.active = false;
    this.startEpoch += 1; // invalidate any in-flight start()
    this.engine.stop();   // engine.stop() also bumps generation to discard stale bestmove
  }

  private applyDifficultyOptions(difficulty: Difficulty) {
    const spec = DIFFICULTY_PRESETS[difficulty];
    this.engine.setSkill(spec.skill);
    if (spec.useELO && spec.elo !== undefined) {
      this.engine.setELO(spec.elo);
    } else {
      this.engine.disableLimitStrength();
    }
  }

  private async maybeMove() {
    if (!this.active) return;
    const chess = this.game.devChess();
    if (chess.turn() !== this.aiColor) return;
    if (chess.isGameOver()) return;
    if (this.game.isAnimating()) return;

    const fen = chess.fen();
    const spec = DIFFICULTY_PRESETS[this.difficulty];

    // Determine the current half-move number (fullmove * 2 - offset).
    // chess.fen() field 5 is the fullmove number; field 1 is active color.
    const fenParts = fen.split(' ');
    const fullmove = parseInt(fenParts[5] ?? '1', 10);
    const activeColor = fenParts[1] ?? 'w';
    const halfPly = (fullmove - 1) * 2 + (activeColor === 'b' ? 1 : 0);

    const isOpening = halfPly < OPENING_PLIES;
    const multiPV = isOpening ? spec.openingMultiPV : spec.midgameMultiPV;
    // Only supply the selector when MultiPV > 1; otherwise pass undefined
    // so bestMove resolves straight to the engine's top choice.
    const selector = multiPV > 1 ? weightedPick : undefined;

    this.game.setAiThinking(true);
    const move = await this.engine.bestMove(fen, spec.movetimeMs, multiPV, selector);
    this.game.setAiThinking(false);

    if (!move || !this.active) return;
    await this.game.devMove({ from: move.from, to: move.to, promotion: move.promotion });
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.applyDifficultyOptions(d);
  }
}
