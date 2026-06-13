import { SceneManager } from './engine/SceneManager';
import { Loop } from './engine/Loop';
import { Game } from './game/Game';
import { UI, GameMode, AIDifficulty } from './ui/UI';
import { SoundEngine } from './engine/Sound';
import { AIPlayer, Difficulty } from './ai/AIPlayer';
import { Quality, autoDetectQuality } from './engine/Quality';
import { MultiplayerSession } from './net/MultiplayerSession';
import { NetworkPlayer } from './net/NetworkPlayer';
import { ProfileStore } from './meta/Profile';
import type { Outcome, AITier } from './meta/Profile';
import { loadSettings, saveSettings, defaultSettings } from './meta/Settings';
import { isRealmUnlocked, isSetUnlocked } from './meta/Unlocks';
import { toppleKing } from './vfx/Topple';
import { celebrate } from './vfx/Confetti';
import { gsap } from 'gsap';
import { DailyPuzzle } from './puzzle/DailyPuzzle';

const loadingBar = document.getElementById('loading-bar-fill') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;

function setProgress(pct: number, text: string) {
  if (loadingBar) loadingBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (loadingStatus) loadingStatus.textContent = text;
}

async function boot() {
  // Restore persisted settings (F14) + profile (F2) BEFORE anything renders, so
  // the first paint already uses the saved quality / realm / set.
  const profile = ProfileStore.load();
  const settings = loadSettings();

  // Pick a quality preset BEFORE the renderer is built so the first paint uses
  // the right pixel ratio / shadow setting. A persisted choice wins; otherwise
  // auto-detect (phones default to 'low'). (F14)
  Quality.set(settings.quality ?? autoDetectQuality());

  setProgress(8, 'Awakening the renderer…');
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const scene = new SceneManager(canvas);
  // Restore the saved realm before first paint (F14). Only if it is currently
  // unlocked for this profile; otherwise it stays the default Gothic Night.
  if (settings.realm !== 'gothic-night' && isRealmUnlocked(settings.realm, profile)) {
    scene.setEnvironment(settings.realm);
  }

  setProgress(28, 'Carving the board of ages…');
  await new Promise((r) => requestAnimationFrame(r));

  setProgress(52, 'Forging the pieces…');
  const game = new Game(scene);
  await game.init();
  // Restore the saved piece set before first paint (F14), if unlocked.
  if (settings.set !== 'fantasy' && isSetUnlocked(settings.set, profile)) {
    game.setPieceSet(settings.set);
  }

  setProgress(78, 'Lighting the candelabras…');
  await new Promise((r) => requestAnimationFrame(r));

  setProgress(92, 'Setting the stage…');
  const ui = new UI(document.getElementById('ui-root') as HTMLDivElement);
  game.attachUI(ui);

  // AI player: lazily initializes Stockfish worker on first activation.
  let ai: AIPlayer | null = null;
  // Network player + session: lazily initialized when entering online mode.
  let session: MultiplayerSession | null = null;
  let netPlayer: NetworkPlayer | null = null;

  // Sound — needs user gesture to unlock. We start unlocked-on-first-interaction.
  const sound = new SoundEngine();
  // Restore the saved mute preference before attachSound reads it for the label. (F14)
  sound.setMuted(settings.soundMuted);
  const unlockOnce = () => {
    sound.unlock();
    if (!sound.isMuted()) sound.startAmbient();
    window.removeEventListener('pointerdown', unlockOnce);
    window.removeEventListener('keydown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);
  game.attachSound(sound);
  ui.attachSound(sound);

  // Attach the retention store: wires set/realm gating, renders the HUD chip,
  // and shows first-run onboarding when no profile exists yet. (F2/F15/F16)
  ui.attachProfile(profile);
  // Sync the cycle-button labels + cursors to the restored set/realm/tier (F14).
  ui.restoreSet(settings.set);
  ui.restoreEnvironment(settings.realm);
  ui.restoreDifficulty(settings.difficulty);

  // -- Settings persistence (F14): write through on every relevant change. ----
  const persist = () => {
    saveSettings({
      ...defaultSettings(),
      set: ui.getPieceSet(),
      realm: ui.getEnvironment(),
      mode: ui.getMode(),
      difficulty: ui.getDifficulty(),
      quality: Quality.current,
      soundMuted: sound.isMuted(),
    });
  };
  ui.onSoundChange(() => persist());

  // -- Profile recording (F2): credit captures live + record the final result.
  // The local player's color decides which captures count as "mine"; in
  // hot-seat there is no single player so every capture is credited.
  const localPlayerColor = (): 'w' | 'b' | null => {
    const mode = ui.getMode();
    if (mode === 'ai-vs-white') return 'b'; // AI is White, you are Black
    if (mode === 'ai-vs-black') return 'w'; // AI is Black, you are White
    if (mode === 'online') return netPlayer?.getMyColor() ?? null;
    return null; // hot-seat: count every capture
  };
  game.onCapture((capturedColor) => {
    const me = localPlayerColor();
    // A capture is "mine" when the captured piece is the opponent's color. In
    // hot-seat (me === null) we credit all captures.
    if (me === null || capturedColor !== me) profile.recordCapture(1);
  });
  game.onGameEnd((result) => {
    const mode = ui.getMode();
    const me = localPlayerColor();
    let outcome: Outcome;
    if (!result.winner) {
      outcome = 'draw';
    } else if (mode === 'hotseat') {
      // No single player: a hot-seat decisive game is recorded as a 'win' for
      // bookkeeping (gamesPlayed increments) but the streak is excluded inside
      // recordGameEnd, so it never affects the streak either way.
      outcome = 'win';
    } else {
      const myColor = me === 'w' ? 'White' : 'Black';
      outcome = result.winner === myColor ? 'win' : 'loss';
    }
    const tier: AITier | undefined = (mode === 'ai-vs-white' || mode === 'ai-vs-black')
      ? ui.getDifficulty()
      : undefined;
    profile.recordGameEnd({ mode, tier, outcome, capturesThisGame: 0 });
  });

  // -- Cinematics (F13) ------------------------------------------------------
  // Capture juice: a value-scaled camera FOV punch + shake at the moment of each
  // capture. The director skips it under reduced-motion or while dragging.
  game.onCaptureFx(({ value }) => {
    scene.director.capturePunch(value);
  });

  // Terminal cinematic: on checkmate, dolly to the mated king, brief slow-mo,
  // topple the king, fire a winner-colored particle burst, do a short victory
  // orbit, THEN reveal the game-over modal. Draws get a gentler push-in (no
  // topple). The modal is deferred via ui.deferNextGameOver() and revealed by
  // showGameOverNow() when the sequence ends or the user clicks to skip. Game
  // state is never blocked: this is pure presentation.
  // Any reset (Restart, mode switch, piece-set change, rematch) cancels a running
  // cinematic and hands clean camera control back. onAfterReset fires at the end
  // of game.reset() for every reset path, so this single hook covers them all.
  game.onAfterReset(() => {
    scene.director.cancel();
  });

  game.onTerminalCinematic(({ result, kingWorld, kingMesh }) => {
    // Always arm the deferral first so ui.update() (which runs right after this
    // listener inside refreshUI) holds the modal back for the sequence.
    ui.deferNextGameOver();
    const reveal = () => ui.showGameOverNow();
    const focus = kingWorld ?? scene.controls.target.clone();
    if (result.kind === 'checkmate' && result.winner) {
      // Topple + celebrate happen alongside the camera dolly.
      if (kingMesh) toppleKing(kingMesh);
      celebrate(game.vfx, focus, result.winner);
      scene.director.playCheckmate(focus, 4000, reveal);
    } else {
      // Stalemate / draws / resignation / timeout / abandonment: gentle push-in.
      scene.director.playDraw(focus, 3000, reveal);
    }
  });

  const teardownOnline = async () => {
    netPlayer?.deactivate();
    netPlayer = null;
    if (session) {
      await session.disconnect();
      session = null;
    }
    game.setInputColorLock(null);
    ui.setOnlineGameActive(false);
    ui.hideDisconnectBanner();
    ui.hideDrawPrompt();
    game.reset();
  };

  /**
   * Wire all the live online-game callbacks (presence/disconnect F8, draw
   * offers, resign, rematch F19, result plumbing) between the active
   * NetworkPlayer and the UI. Called once per activated online game (create /
   * join / find / rematch). `isSpectator` hides player-only controls; `clock`
   * activates the two HUD clocks (F18, players only for now). The roomCode and
   * myColor let the rematch-room handshake re-route into a fresh room.
   */
  const wireOnlineGame = (opts: { isSpectator: boolean; clock: boolean }) => {
    if (!netPlayer) return;
    const np = netPlayer;
    ui.setOnlineGameActive(true, { spectator: opts.isSpectator, clock: opts.clock });

    // F8: opponent presence dot + disconnect banner with 60s claim-win countdown.
    np.onPresence((online) => {
      ui.setOpponentPresence(online);
      if (opts.isSpectator) return; // spectators see the dot but cannot claim
      if (online) {
        // Reconnection within the window cancels the countdown.
        ui.hideDisconnectBanner();
      } else if (!np.isGameDecided()) {
        // Only warn about a disconnect while the game is still live (not after a
        // resignation / draw / flag has already decided it).
        ui.showDisconnectBanner(60);
      }
    });

    // Claim Win after the opponent stays gone past the window (or the button).
    ui.onClaimWin(() => { void np.claimAbandonment(); });

    // Resign / draw wiring.
    ui.onResign(() => { void np.resign(); });
    ui.onOfferDraw(() => { void np.offerDraw(); ui.noteDrawState('Draw offer sent.'); });
    ui.onAcceptDraw(() => { void np.acceptDraw(); });
    ui.onDeclineDraw(() => { void np.declineDraw(); });
    np.onIncomingDrawOffer(() => { if (!opts.isSpectator) ui.showDrawPrompt(); });

    // Rematch handshake (F19): modal Rematch button -> NetworkPlayer handshake.
    ui.onRematch(() => { void np.requestRematch(); });
    np.onRematch((phase) => { ui.setRematchPhase(phase); });
    np.onRematchRoom((code, myNewColor) => {
      void enterRematchRoom(code, myNewColor);
    });
  };

  /**
   * Enter the freshly created rematch room with swapped colors (F19). The host
   * (old black -> new white) already created and re-subscribed its session; the
   * guest (old white -> new black) must join by code. Both clients reset the
   * board and re-wire. No manual code entry on either side.
   */
  const enterRematchRoom = async (code: string, myNewColor: 'w' | 'b') => {
    try {
      ui.removeGameOverModal();
      game.setInputColorLock(null);
      game.reset();
      if (myNewColor === 'w') {
        // I am the host: my session already points at the new room (createRematchRoom).
        netPlayer?.deactivate();
        netPlayer = new NetworkPlayer(game, session!);
        await netPlayer.activate('w', true);
        game.setInputColorLock('w');
        history.replaceState(null, '', `${location.pathname}#/r/${code}`);
        ui.renderOnlinePanel({ status: 'waiting', roomCode: code, myColor: 'w' });
        session!.onPeerJoined(() => {
          ui.renderOnlinePanel({ status: 'playing', roomCode: code, myColor: 'w' });
          netPlayer?.startClockIfReady();
        });
        wireOnlineGame({ isSpectator: false, clock: true });
      } else {
        // I am the guest: join the host's new room as black.
        netPlayer?.deactivate();
        if (session) { await session.disconnect(); }
        session = new MultiplayerSession();
        const { myColor } = await session.joinRoom(code);
        history.replaceState(null, '', `${location.pathname}#/r/${code}`);
        netPlayer = new NetworkPlayer(game, session);
        await netPlayer.activate(myColor, true);
        game.setInputColorLock(myColor);
        ui.renderOnlinePanel({ status: 'playing', roomCode: code, myColor });
        wireOnlineGame({ isSpectator: false, clock: true });
      }
    } catch (err) {
      console.error('[online] rematch room entry failed:', err);
      ui.renderOnlinePanel({ status: 'error', errorMsg: (err as Error).message });
    }
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
      await netPlayer.activate(myColor, true);
      game.setInputColorLock(myColor);
      ui.renderOnlinePanel({ status: 'waiting', roomCode, myColor });
      session.onPeerJoined(() => {
        ui.renderOnlinePanel({ status: 'playing', roomCode, myColor });
        netPlayer?.startClockIfReady();
      });
      wireOnlineGame({ isSpectator: false, clock: true });
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
      const spectator = role === 'spectator';
      await netPlayer.activate(spectator ? null : myColor, true);
      game.setInputColorLock(spectator ? 'spectator' : myColor);
      const status = spectator ? 'watching' : 'playing';
      ui.renderOnlinePanel({ status, roomCode: code, myColor: spectator ? null : myColor });
      wireOnlineGame({ isSpectator: spectator, clock: true });
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
      await netPlayer.activate(null, true);
      game.setInputColorLock('spectator');
      ui.renderOnlinePanel({ status: 'watching', roomCode: code, myColor: null });
      wireOnlineGame({ isSpectator: true, clock: true });
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
      await netPlayer.activate(myColor, true);
      game.setInputColorLock(myColor);
      ui.renderOnlinePanel({ status: 'playing', roomCode, myColor });
      wireOnlineGame({ isSpectator: false, clock: true });
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
      // Switching to hot-seat mid-think: clear the thinking indicator/lock so
      // hot-seat input is not left frozen waiting on a search we abandoned. (F5)
      game.setAiThinking(false);
      return;
    }
    if (mode === 'online') {
      ai?.stop();
      game.setAiThinking(false);
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

  // Restart: stop the AI FIRST (race-free thanks to the ai-calibration package's
  // generation/epoch guards) so an in-flight search can't drop a ghost move into
  // the fresh game, THEN reset (which clears aiThinking/animatingMove). For AI
  // modes we then re-start the AI in the fresh position so an AI-plays-White
  // opens the new game instead of freezing. Online "Play Again" is handled by
  // the online package (rematch), so we do NOT reset the live room here. (F5)
  ui.onRestart(() => {
    const mode = ui.getMode();
    ai?.stop();
    if (mode === 'online') return; // online rematch is driven by the online layer
    game.reset();
    if (mode === 'ai-vs-white' || mode === 'ai-vs-black') {
      ai = ai ?? new AIPlayer(game);
      const aiColor = mode === 'ai-vs-black' ? 'b' : 'w';
      void ai.start(aiColor, uiDifficultyToAi(ui.getDifficulty()));
    }
  });

  // Each setting change also writes through to localStorage (F14). applyMode is
  // async, so we persist after it settles. Quality/env/set/difficulty persist
  // synchronously after applying.
  ui.onModeChange((m) => { void applyMode(m).then(persist); });
  ui.onDifficultyChange((d) => { applyDifficulty(d); persist(); });
  ui.onEnvironmentChange((env) => { scene.setEnvironment(env); persist(); });
  ui.onPieceSetChange((set) => { game.setPieceSet(set); persist(); });
  ui.onQualityChange((q) => { scene.setQuality(q); persist(); });
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
  } else if (settings.mode === 'ai-vs-white' || settings.mode === 'ai-vs-black') {
    // Restore a saved AI mode (F14): online is never restored on boot. This
    // syncs the HUD label and actually starts the AI so an AI-plays-White opens
    // the game. Hot-seat needs no action (it is the default).
    ui.setMode(settings.mode);
    void applyMode(settings.mode);
  }

  const loop = new Loop((dt) => {
    scene.update(dt);
    // Cinematics slow-mo (F13): scale the dt fed to game.update (VFX bursts,
    // piece/character animation) by the director's timeScale so the checkmate
    // slow-mo reads. The director's own shake/FOV decay uses real time (sampled
    // inside scene.update), so the cinematic timing itself is never slowed.
    game.update(dt * scene.director.getTimeScale());
    // Online clock: pump the Fischer clock each frame, detect flag falls (F18),
    // and render the two HUD clocks from the live view.
    if (netPlayer) {
      netPlayer.tick();
      const cv = netPlayer.clockView();
      if (cv) ui.updateClocks(cv.whiteMs, cv.blackMs, cv.running);
    }
    scene.render();
  });
  loop.start();

  // Best-effort leave signal on tab close (F8): untrack presence so the
  // opponent's disconnect banner fires promptly. Fire-and-forget; the browser
  // may not flush async work, but presence untrack is sent over an open socket.
  window.addEventListener('beforeunload', () => {
    session?.leaveBeacon();
  });

  // -- Daily puzzle setup (F3) ------------------------------------------------
  const dailyPuzzle = new DailyPuzzle(profile, sound);

  // True while the board is occupied by the daily puzzle.
  let puzzleMode = false;
  // Guards against re-entrant validation (e.g. the reply devMove triggering
  // our own onAfterMove listener a second time while we are still processing).
  let puzzleValidating = false;
  // Set to false after exit so the registered onAfterMove listener is a no-op.
  let puzzleMoveActive = false;

  /**
   * Show or refresh the 'active' puzzle panel based on the current DailyPuzzle
   * state. Extracted so both the initial show and the wrong-move re-show reuse it.
   */
  const refreshActivePuzzlePanel = (src: ReturnType<DailyPuzzle['getPuzzle']>, stepIndex: number, attempts: number) => {
    if (!src) return;
    const streakInfo = dailyPuzzle.getStreakInfo();
    ui.showPuzzlePanel('active', {
      title: src.title,
      source: src.source,
      stepIndex,
      totalSteps: src.solution.length,
      attempts,
      streak: streakInfo.currentStreak,
      bestStreak: streakInfo.bestStreak,
      date: src.date,
    });
  };

  // One-time registration of the puzzle afterMove listener. The flag
  // puzzleMoveActive controls whether it actually does anything.
  game.onAfterMove(async () => {
    if (!puzzleMoveActive || puzzleValidating) return;
    puzzleValidating = true;
    try {
      const hist = game.devChess().history({ verbose: true });
      if (!hist.length) { puzzleValidating = false; return; }
      const last = hist[hist.length - 1]!;
      const uci = last.from + last.to + (last.promotion ?? '');
      const accepted = await dailyPuzzle.handlePlayerMove(uci, game);
      if (!accepted) {
        // Wrong move: revert. undoPuzzleMove() calls loadPuzzleFen internally
        // which rebuilds the board from the current chess.js state after undo.
        game.undoPuzzleMove();
        // Refresh panel so the wrong-move count is visible.
        const src = dailyPuzzle.getPuzzle();
        if (src) {
          // Access attempts via DailyPuzzle.getSave() - expose it via a getter.
          const info = dailyPuzzle.getSaveInfo();
          ui.flashWrongMove(info.attempts);
          refreshActivePuzzlePanel(src, dailyPuzzle.getCurrentStep(), info.attempts);
        }
      }
    } finally {
      puzzleValidating = false;
    }
  });

  const startPuzzle = async (forceOffline = false) => {
    if (puzzleMode) return;
    ai?.stop();
    game.setAiThinking(false);
    game.setInputColorLock(null);
    puzzleMode = true;

    ui.showPuzzlePanel('loading', { title: 'Daily Puzzle' });

    let src;
    try {
      src = await dailyPuzzle.load(game, forceOffline);
    } catch (err) {
      console.error('[puzzle] load failed:', err);
      ui.showPuzzlePanel('error', { errorMsg: 'Could not load puzzle. Check your connection.' });
      puzzleMode = false;
      return;
    }

    const alreadySolved = dailyPuzzle.isTodaySolved();
    const streakInfo = dailyPuzzle.getStreakInfo();

    if (alreadySolved) {
      // Already solved today: show solved state immediately (still loads the
      // position so the player can review).
      dailyPuzzle.startSession();
      const saveInfo = dailyPuzzle.getSaveInfo();
      ui.showPuzzlePanel('solved', {
        title: src.title,
        source: src.source,
        attempts: saveInfo.attempts || 1,
        streak: streakInfo.currentStreak,
        bestStreak: streakInfo.bestStreak,
        date: src.date,
      });
      // Do NOT arm the move listener: board is view-only when already solved.
      return;
    }

    dailyPuzzle.startSession();

    dailyPuzzle.setCallbacks({
      onWrongMove: (attempts) => {
        // Visual feedback is handled in the onAfterMove listener above.
        // The sound cue goes here.
        sound.playCheck?.();
        void attempts; // already used in the listener
      },
      onCorrectMove: (nextIndex, total) => {
        ui.updatePuzzleProgress(nextIndex, total);
      },
      onOpponentReply: () => { /* animation is handled by devMove inside handlePlayerMove */ },
      onSolved: (attempts, streak) => {
        ui.setDailyPuzzleSolved(true);
        puzzleMoveActive = false; // no more moves to validate
        const info = dailyPuzzle.getStreakInfo();
        ui.showPuzzlePanel('solved', {
          title: src.title,
          source: src.source,
          attempts,
          streak,
          bestStreak: info.bestStreak,
          date: src.date,
        });
        sound.playCheckmate?.();
      },
      onStatusChange: (state) => {
        if (state === 'abandoned') {
          puzzleMoveActive = false;
          puzzleMode = false;
        }
      },
    });

    refreshActivePuzzlePanel(src, 0, 0);
    // Arm the move validator.
    puzzleMoveActive = true;
  };

  const exitPuzzleMode = () => {
    if (!puzzleMode) return;
    dailyPuzzle.abandon();
    puzzleMode = false;
    puzzleMoveActive = false;
    ui.hidePuzzlePanel();
    // Restore normal game: a fresh board is the documented behavior on exit.
    game.reset();
    const mode = ui.getMode();
    if (mode === 'ai-vs-white' || mode === 'ai-vs-black') {
      ai = ai ?? new AIPlayer(game);
      const aiColor = mode === 'ai-vs-black' ? 'b' : 'w';
      void ai.start(aiColor, uiDifficultyToAi(ui.getDifficulty()));
    }
  };

  ui.onDailyPuzzle(() => { void startPuzzle(); });
  ui.onExitPuzzle(() => { exitPuzzleMode(); });

  // On boot: set the Daily button solved state.
  ui.setDailyPuzzleSolved(dailyPuzzle.isTodaySolved());

  // Dev hook for debugging / Playwright testing. cinematicActive is a live getter
  // so testers can poll window.chess3d.cinematicActive to detect a running
  // cinematic (intro orbit, capture juice, or the endgame sequence). (F13)
  // Exposed ONLY in dev builds (import.meta.env.DEV) or when the URL contains
  // ?dev=1 so the production bundle ships zero debug surface. Nothing inside the
  // production game-loop reads window.chess3d; all internal callers (AIPlayer,
  // NetworkPlayer, DailyPuzzle) reference the game/session variables directly.
  const isDev = import.meta.env.DEV || new URLSearchParams(location.search).get('dev') === '1';
  if (isDev) {
    const chess3d = { scene, game, ui, sound, gsap, dailyPuzzle, startPuzzle };
    Object.defineProperty(chess3d, 'cinematicActive', {
      get: () => scene.director.isActive(),
      enumerable: true,
    });
    (window as unknown as { chess3d: unknown }).chess3d = chess3d;
  }

  setProgress(100, 'The realm awaits.');
  await new Promise((r) => setTimeout(r, 350));
  loadingScreen.classList.add('hidden');
  setTimeout(() => loadingScreen.remove(), 1300);

  // Intro cinematic (F13): a slow ~5s orbit that eases into the play position,
  // started after the loading screen begins to fade. Any user input skips it
  // instantly (handled inside the director). Honours reduced-motion (no-op) and
  // is suppressed when we boot straight into an online room route, so a joiner
  // is not orbiting while the opponent is already moving.
  if (!routeMatch) {
    scene.director.playIntro();
  }
}

function uiDifficultyToAi(d: AIDifficulty): Difficulty { return d; }

boot().catch((err) => {
  console.error(err);
  setProgress(100, `Failed to summon: ${(err as Error).message}`);
});
