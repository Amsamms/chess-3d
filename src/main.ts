import { SceneManager } from './engine/SceneManager';
import { Loop } from './engine/Loop';
import { Game } from './game/Game';
import { UI, GameMode, AIDifficulty } from './ui/UI';
import { SoundEngine } from './engine/Sound';
import { AIPlayer, Difficulty } from './ai/AIPlayer';

const loadingBar = document.getElementById('loading-bar-fill') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;

function setProgress(pct: number, text: string) {
  if (loadingBar) loadingBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (loadingStatus) loadingStatus.textContent = text;
}

async function boot() {
  setProgress(8, 'Awakening the renderer…');
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const scene = new SceneManager(canvas);

  setProgress(28, 'Carving the board of ages…');
  await new Promise((r) => requestAnimationFrame(r));

  setProgress(52, 'Forging the pieces…');
  const game = new Game(scene);
  await game.init();

  setProgress(78, 'Lighting the candelabras…');
  await new Promise((r) => requestAnimationFrame(r));

  setProgress(92, 'Setting the stage…');
  const ui = new UI(document.getElementById('ui-root') as HTMLDivElement);
  game.attachUI(ui);
  ui.onRestart(() => game.reset());

  // Sound — needs user gesture to unlock. We start unlocked-on-first-interaction.
  const sound = new SoundEngine();
  const unlockOnce = () => {
    sound.unlock();
    sound.startAmbient();
    window.removeEventListener('pointerdown', unlockOnce);
    window.removeEventListener('keydown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);
  game.attachSound(sound);
  ui.attachSound(sound);

  // AI player — lazily initializes Stockfish worker on first activation.
  let ai: AIPlayer | null = null;
  const applyMode = async (mode: GameMode) => {
    if (mode === 'hotseat') {
      ai?.stop();
      return;
    }
    ai = ai ?? new AIPlayer(game);
    const aiColor = mode === 'ai-vs-black' ? 'b' : 'w';
    const diff = uiDifficultyToAi(ui.getDifficulty());
    await ai.start(aiColor, diff);
  };
  const applyDifficulty = (d: AIDifficulty) => {
    ai?.setDifficulty(uiDifficultyToAi(d));
  };
  ui.onModeChange(applyMode);
  ui.onDifficultyChange(applyDifficulty);
  ui.onEnvironmentChange((env) => scene.setEnvironment(env));
  ui.onPieceSetChange((set) => game.setPieceSet(set));

  const loop = new Loop((dt) => {
    scene.update(dt);
    game.update(dt);
    scene.render();
  });
  loop.start();

  // Dev hook for debugging / Playwright testing.
  (window as unknown as { chess3d: unknown }).chess3d = { scene, game, ui, sound };

  setProgress(100, 'The realm awaits.');
  await new Promise((r) => setTimeout(r, 350));
  loadingScreen.classList.add('hidden');
  setTimeout(() => loadingScreen.remove(), 1300);
}

function uiDifficultyToAi(d: AIDifficulty): Difficulty { return d; }

boot().catch((err) => {
  console.error(err);
  setProgress(100, `Failed to summon: ${(err as Error).message}`);
});
