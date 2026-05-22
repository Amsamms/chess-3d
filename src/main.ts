import { SceneManager } from './engine/SceneManager';
import { Loop } from './engine/Loop';
import { Game } from './game/Game';
import { UI, GameMode, AIDifficulty } from './ui/UI';
import { SoundEngine } from './engine/Sound';
import { AIPlayer, Difficulty } from './ai/AIPlayer';
import { Quality, autoDetectQuality } from './engine/Quality';
import { MultiplayerSession } from './net/MultiplayerSession';
import { NetworkPlayer } from './net/NetworkPlayer';
import { gsap } from 'gsap';

const loadingBar = document.getElementById('loading-bar-fill') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;

function setProgress(pct: number, text: string) {
  if (loadingBar) loadingBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (loadingStatus) loadingStatus.textContent = text;
}

async function boot() {
  // Pick a quality preset BEFORE the renderer is built so the first paint
  // uses the right pixel ratio / shadow setting on phones.
  Quality.set(autoDetectQuality());

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
  // Network player + session — lazily initialized when entering online mode.
  let session: MultiplayerSession | null = null;
  let netPlayer: NetworkPlayer | null = null;

  const teardownOnline = async () => {
    netPlayer?.deactivate();
    netPlayer = null;
    if (session) {
      await session.disconnect();
      session = null;
    }
    game.setInputColorLock(null);
    game.reset();
  };

  const startOnlineCreate = async () => {
    ai?.stop();
    await teardownOnline();
    ui.renderOnlinePanel({ status: 'creating' });
    try {
      session = new MultiplayerSession();
      const { roomCode, myColor } = await session.createRoom({
        pieceSet: ui.getPieceSet(),
        environment: ui.getEnvironment(),
      });
      history.replaceState(null, '', `${location.pathname}#/r/${roomCode}`);
      netPlayer = new NetworkPlayer(game, session);
      await netPlayer.activate(myColor);
      game.setInputColorLock(myColor);
      ui.renderOnlinePanel({ status: 'waiting', roomCode, myColor });
      session.onPeerJoined(() => {
        ui.renderOnlinePanel({ status: 'playing', roomCode, myColor });
      });
    } catch (err) {
      console.error('[online] create failed:', err);
      ui.renderOnlinePanel({ status: 'error', errorMsg: (err as Error).message });
    }
  };

  const startOnlineJoin = async (code: string) => {
    ai?.stop();
    await teardownOnline();
    ui.renderOnlinePanel({ status: 'creating' });
    try {
      session = new MultiplayerSession();
      const { myColor } = await session.joinRoom(code);
      history.replaceState(null, '', `${location.pathname}#/r/${code}`);
      netPlayer = new NetworkPlayer(game, session);
      const role = session.getRole();
      await netPlayer.activate(role === 'spectator' ? null : myColor);
      game.setInputColorLock(role === 'spectator' ? 'spectator' : myColor);
      const status = role === 'spectator' ? 'watching' : 'playing';
      ui.renderOnlinePanel({ status, roomCode: code, myColor: role === 'spectator' ? null : myColor });
    } catch (err) {
      console.error('[online] join failed:', err);
      ui.renderOnlinePanel({ status: 'error', errorMsg: (err as Error).message });
    }
  };

  const startOnlineWatch = async (code: string) => {
    ai?.stop();
    await teardownOnline();
    ui.renderOnlinePanel({ status: 'creating' });
    try {
      session = new MultiplayerSession();
      const { fen, moves } = await session.watchRoom(code);
      void fen; void moves;
      history.replaceState(null, '', `${location.pathname}#/watch/${code}`);
      netPlayer = new NetworkPlayer(game, session);
      await netPlayer.activate(null);
      game.setInputColorLock('spectator');
      ui.renderOnlinePanel({ status: 'watching', roomCode: code, myColor: null });
    } catch (err) {
      console.error('[online] watch failed:', err);
      ui.renderOnlinePanel({ status: 'error', errorMsg: (err as Error).message });
    }
  };

  const startOnlineFind = async () => {
    ai?.stop();
    await teardownOnline();
    ui.renderOnlinePanel({ status: 'searching' });
    try {
      session = new MultiplayerSession();
      const { roomCode, myColor } = await session.findGame(() => {
        ui.renderOnlinePanel({ status: 'searching' });
      });
      history.replaceState(null, '', `${location.pathname}#/r/${roomCode}`);
      netPlayer = new NetworkPlayer(game, session);
      await netPlayer.activate(myColor);
      game.setInputColorLock(myColor);
      ui.renderOnlinePanel({ status: 'playing', roomCode, myColor });
    } catch (err) {
      console.error('[online] find failed:', err);
      ui.renderOnlinePanel({ status: 'error', errorMsg: (err as Error).message });
    }
  };

  const leaveOnline = async () => {
    await teardownOnline();
    history.replaceState(null, '', location.pathname);
    ui.renderOnlinePanel({ status: 'idle' });
  };

  const applyMode = async (mode: GameMode) => {
    if (mode !== 'online') {
      // Leaving online mode tears down the session.
      await teardownOnline();
    }
    if (mode === 'hotseat') {
      ai?.stop();
      return;
    }
    if (mode === 'online') {
      ai?.stop();
      return; // panel will drive create/join from here
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
  ui.onQualityChange((q) => scene.setQuality(q));
  ui.onOnlineCreate(() => { void startOnlineCreate(); });
  ui.onOnlineJoin((code) => { void startOnlineJoin(code); });
  ui.onOnlineLeave(() => { void leaveOnline(); });
  ui.onOnlineFind(() => { void startOnlineFind(); });
  // Sync the HUD label in case autoDetectQuality picked 'low' for us.
  ui.setQualityLabel(Quality.current);

  // URL routing — hash-based so we work under a path prefix (e.g. GitHub Pages
  // `/chess-3d/`) without needing server-side SPA rewrites. Accepts:
  //   - /r/<code> or #/r/<code>  → join (player or spectator)
  //   - /watch/<code> or #/watch/<code> → spectator-only
  const parseRoute = (raw: string) => raw.match(/\/(r|watch)\/([A-Z0-9]{6})\/?$/i);
  const routeMatch = parseRoute(window.location.hash) || parseRoute(window.location.pathname);
  if (routeMatch) {
    const which = routeMatch[1]!.toLowerCase();
    const code = routeMatch[2]!.toUpperCase();
    ui.setMode('online');
    setTimeout(() => {
      if (which === 'watch') void startOnlineWatch(code);
      else void startOnlineJoin(code);
    }, 0);
  }

  const loop = new Loop((dt) => {
    scene.update(dt);
    game.update(dt);
    scene.render();
  });
  loop.start();

  // Dev hook for debugging / Playwright testing.
  (window as unknown as { chess3d: unknown }).chess3d = { scene, game, ui, sound, gsap };

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
