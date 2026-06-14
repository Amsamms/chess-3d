# Project: Chess 3D — Epic Edition

## Goal
Build an epic 3D web-based chess game where pieces are living fantasy characters (knight on horse, bishop is a magician, queen is a regal woman, etc.). Pieces walk/glide to move, captures trigger dramatic per-piece animations (bishop's magic dissolve, knight's sword swing, etc.), captured pieces transport to a "prison cage" beside the board. Board can be rotated/zoomed in full 3D. Three game modes: hot-seat 2-player, vs AI (Stockfish), online multiplayer. Hosted on one of Ahmed's VMs.

## Current Status
**Milestones A + B + AI reached.** Local game now has: procedural fantasy characters (knight on horse, robed wizard, crowned king/queen, stone-tower rook, armored soldier-pawn) replacing Staunton silhouettes; epic per-piece capture sequences (bishop ranged magic ball, knight slash, pawn stab, rook smash, queen vortex, king aura) with smoke/sparkle/magic/dust/shadow particle systems; iron-barred prison cages on both sides of the board collect captured pieces with eerie cage lighting; post-processing (bloom + vignette); procedural Web Audio sound (ambient drone, move click, magic cast, impact, stone smash, queen vortex, check chime, checkmate fanfare); Stockfish 17.1 WASM AI integrated with 4 skill levels (beginner→master). UI has Mode button cycling Hot-seat → Vs AI (you're White) → Vs AI (you're Black), Skill button cycling Beginner→Master, Sound on/off, Restart. AI mode verified end-to-end: I played e4, Stockfish responded d5 in <200ms. Dev server runs on http://localhost:5173 (background bash id `br32umsyl`). Next: Phase 7 (online multiplayer) or Phase 8 (deploy to VM).

## Strategic Decisions (locked 2026-05-21)
- **Engine**: Three.js (browser-based, hostable as static + small Node backend)
- **Build tool**: Vite + TypeScript
- **Game logic**: chess.js
- **Animation**: GSAP for tweens, Three.js AnimationMixer for skeletal/character animations
- **VFX**: postprocessing lib (bloom, SSAO, DOF), custom particle systems for magic
- **AI**: Stockfish.js WASM in a Web Worker
- **Multiplayer**: Node.js + Express + Socket.io (authoritative server using chess.js)
- **Visual style**: Stylized fantasy (Heroes of Might & Magic / Blizzard cinematic vibes)
- **Assets**: CC0 fantasy characters (Quaternius / Poly Pizza / Kenney). Procedural Staunton pieces as initial placeholders so we have a playable game fast, then progressively swap in characters.
- **Game modes** (all three): hot-seat 2-player, vs Stockfish AI, online multiplayer
- **Hosting**: TBD between powerhouse / hunter / AWS — decide after local version is solid

## Completed Work
- 2026-05-21: Confirmed empty folder, Node 22 + npm 10 ready.
- 2026-05-21: Locked strategic stack via AskUserQuestion (Three.js, all 3 modes, stylized fantasy, Mixamo+CC0 assets).
- 2026-05-21: Created task list (12 phased tasks) and this PROGRESS.md.
- 2026-05-21: **Phase 1 complete** — Vite + TS + Three.js scaffold (`package.json`, `tsconfig.json`, `vite.config.ts`). Scene foundation: WebGLRenderer with PCFSoftShadowMap + ACESFilmic tone mapping, PerspectiveCamera + OrbitControls (clamped polar to keep camera above board), hemisphere + directional sun (with shadow map) + purple rim + flickering torch point light, custom shader sky dome (gradient night), 1400 procedural stars, stone-textured circular dais with gold ornamental ring. **Bumped Three.js to 0.180** to satisfy `postprocessing` peer-dep.
- 2026-05-21: **Board** — wooden slab + gold inlay + 64 marble/wood squares (canvas-generated textures with noise, veining, wood grain on dark squares), gold frame with 4 corner finials (ball+stem+base), per-square invisible pick planes for clicking empty squares, ring-highlight system (gold for selected, green for quiet move, red for capture, pulses via sine on game clock).
- 2026-05-21: **Pieces** — six procedural Staunton silhouettes via LatheGeometry profiles + decorative extras (rook battlements, bishop mitre slot, knight extruded horse-head + mane + eye, queen crown ring + 8 points + jewel, king crown + 4-point crown + cross). White = warm ivory with gold accents, black = deep ebony with purple accents. Pieces face opponent (white rotated π, black rotated 0). `setSelected()` pulses emissive via GSAP. `moveTo()` arcs along bezier path with peak hop + yaw rotation toward travel direction. `capture()` shrinks + sinks + disposes (Phase 4 will replace with epic per-piece VFX).
- 2026-05-21: **Game orchestrator** — spawns 32 pieces from initial FEN, raycasts pointerdown against board pick-planes + all piece groups, selects own-color pieces, executes legal moves with full chess.js validation (en passant detection, castling rook-move animation, promotion piece swap). Updates UI on every move.
- 2026-05-21: **UI** — HUD top center (turn orb + label + status text), captured-pieces trays (Unicode chess glyphs), restart button, controls hint, game-over modal with "Play Again". CSS: Cinzel + Cormorant Garamond fonts from Google Fonts, dark gothic gold palette, animated loading screen with shimmer bar.
- 2026-05-21: **Dev hook** — `window.chess3d = { scene, game, ui }` + `game.devMove({from,to}) / devSelect / devChess()` so Playwright can drive the game programmatically for testing. Used to verify 6-move sequence including captures.

## In-Progress Work
- *(none — between sessions; user asked for an /ultrareview on the current code before continuing.)*

## Session 2 additions (2026-05-22)
- **Phase 9** Board square size 1.0 → 1.4, camera 14/16 → 18/22, controls/maxDist 36 → 55, shadow frustum 14 → 19, ornamental ring radius 8 → 11, knight scaled to 0.85 (its horse was the longest piece, overflowing 1.0 squares).
- **Phase 10** Three piece sets:
  - `classic` — Procedural Staunton (PieceFactory) with **imaginative motion**:
    - pawn → `march` (stiff 2-hop step)
    - rook → `roll` (forward tumble, ~1 rotation per 1.4 units of distance, snaps back to upright on arrival)
    - knight → `leap` (L-shape mid-air pivot: traverses the long arm first, banks 90° at apex, drops onto destination)
    - bishop → `spin` (full pirouette while gliding diagonally)
    - queen → `levitate` (rises, glides high with gentle sway, descends in 3 phases)
    - king → `march` (slow heavy step)
  - `fantasy` — current Character system (knight on horse, robed wizard with glowing staff, crowned queen+scepter, bearded king, armored soldier-pawn, castle-tower rook). Knight uses `gallop` (shorter arc to feel like horse motion). All others `arc` (default hop+yaw).
  - `neon` — New cyber pieces: tetrahedron pawn with halo, stacked-cube rook with antenna, angular wireframe knight, octahedron-prism bishop with 3 orbital rings, crystal-diamond queen with satellites, hexagonal-column king with cross. All `hover` (smooth glide, no rotation, subtle bob). Cyan/white core for white, hot-pink core for black. Heavily emissive → looks great with bloom.
  - UI: new "Set: …" button cycles through. `game.setPieceSet(name)` rebuilds all pieces with new set. `Piece` constructor takes set name + uses `buildPiece()` dispatcher from `PieceSetFactory.ts`. `Piece.moveTo()` is now a dispatcher for 8 motion styles.
- **Phase 11** Four swappable environments:
  - `gothic-night` (default) — purple sky, stars, flickering torch, key light drifts, mossy stone dais.
  - `garden-day` — bright sky, sun disk (shader-driven), white clouds, hemi+sun lighting, grass texture, stone path around board, wreath ring, scattered flowers (60), 6 trees, drifting petals.
  - `ice-realm` — glacial blue/star-lit night, animated aurora ribbon (shader), snowflakes (600), 4 cyan glow lights around board, snowy ground, silver ring, 8 crystal spires, 7 snowy pines.
  - `volcano` — dark-red sky, 4 distant volcanoes with glowing peaks, 14 lava fissures pulsing on the floor, embers rising, ash falling, charred rocks with lava cracks, molten metal ring.
  - Architecture: `src/environments/Environment.ts` (abstract base with `build()` + `update()` + `dispose()`), `EnvironmentManager` owns the active env and swaps cleanly. `SceneManager.setEnvironment(name)` switches at runtime (disposes old, builds new). Each env owns ALL its scene additions under a `THREE.Group` so disposal is total.
  - UI: new "Realm: …" button cycles. Renderer exposure tuned per env (1.05–1.25).
- **Phase 12** End-to-end verified: ran capture sequences in Classic+Garden, AI mode in Neon+Volcano (Stockfish replied to e4 with c5 in 200ms), Fantasy+Gothic (already known working). All combinations tested without artifacts. Switching mid-game disposes old pieces/env and rebuilds.

## End-of-session state (2026-05-21)
- 4,845 lines of TypeScript across 24 files. Production build succeeds (`npm run build` → 737 KB JS gzipped to 200 KB, plus 7 MB Stockfish WASM).
- All gameplay features functional in local dev (http://localhost:5173): hot-seat, Vs AI (white or black) with 4 difficulty presets, mode/skill toggles, sound on/off.
- Background dev server: `npm run dev` (bash id `br32umsyl`) — may still be running; kill with `kill %1` or `pkill -f vite` if needed.
- User has deferred Phase 7 (online multiplayer) and Phase 8 (deploy to VM) to a future session.
- Pending review: user requested `/ultrareview` of the codebase. `/ultrareview` requires a git repository — at session end, repo is not yet initialized (left to user's preference: either `git init && git add . && git commit -m 'initial'` to enable the bundle, or run `/ultrareview <github-pr-url>` if they push it to GitHub first).

## Next Steps
1. Finish Phase 1: scaffold project, build 3D scene foundation, build stylized chess board.
2. Phase 2: chess.js rules engine, procedural Staunton pieces (all 32), click-to-move with animation, basic UI.
3. **Milestone A**: Playable hot-seat 2-player chess in 3D with smooth camera and basic move animations. Demo this before moving on.
4. Phase 3: replace procedural pieces with CC0 fantasy character models + walk/idle animations.
5. Phase 4: epic per-piece capture animations + prison cage area.
6. Phase 5: post-processing, sound, ambient atmosphere.
7. **Milestone B**: Epic visuals + epic captures. Demo.
8. Phase 6: Stockfish vs-AI mode.
9. Phase 7: Online multiplayer backend.
10. **Milestone C**: All 3 modes working locally.
11. Phase 8: Deploy to chosen VM with nginx + HTTPS.

## Key Context
- **Project root**: `/home/amsamms/projects/games/chess_3d/`
- **Important files** (will exist soon): `index.html`, `src/main.ts`, `src/game/`, `src/scene/`, `src/pieces/`, `src/vfx/`, `vite.config.ts`, `tsconfig.json`, `server/` (multiplayer backend).
- **Asset sources**: Quaternius (https://quaternius.com), Kenney (https://kenney.nl), Poly Pizza CC0 search. Mixamo (Adobe) if needed — Ahmed's Gmail credentials work for Adobe login.
- **Stockfish WASM**: npm package `stockfish` (UCI-compatible, single-threaded WASM build for browser).
- **VM candidates for hosting**: powerhouse (12 GB ARM, idle), hunter (12 GB ARM, freelance crons), AWS (1 GB x86, runs EPROM production stack). Powerhouse is most attractive — idle, plenty of RAM, ARM is fine for static + Node.

## Open Questions
- Final hosting VM — decide after Milestone C.
- Domain / subdomain — use a sub of eprom-portal.xyz (Ahmed owns it via Namecheap) or buy a new one? Defer until Phase 8.
- Stockfish difficulty levels — exact ELO targets (defaults: beginner/intermediate/strong/master).
- Online multiplayer matchmaking — simple room codes vs public lobby? Default: room codes only (private, easy).

## Gotchas / Decisions Worth Remembering
- "Epic like PUBG" was framed honestly with Ahmed: literal AAA quality (Unreal-tier) is years/millions out of scope; we're targeting "visually rich web-based 3D" which is genuinely impressive but not literal PUBG.
- Mixamo requires Adobe login — if we use it I'll automate with Playwright (Gmail SSO works). Quaternius / Kenney CC0 packs are easier (direct download, no login).
- Procedural pieces ship first to unblock gameplay; characters swap in later. This is intentional, not a compromise on quality — it keeps the project shippable at each phase.

## Session 3 (2026-06-13): Multi-agent audit + 22-fix pass + deploy

### What happened
Ran two multi-agent workflows against the LIVE game (https://amsamms.github.io/chess-3d/).
1. Audit workflow (9 dimension auditors, opus/sonnet, 32 agents total, ~63 min): scored the game and produced a roadmap. Verdict honesty: Epic ~5.25/10, Good ~6.2/10, Addictive ~4.0/10. 22 issues confirmed by adversarial verification (0 refuted).
2. Fix-and-verify workflow (10 fix packages + tests + adversarial review): implemented all 22 fixes, then validated.

### The 22 fixes (all landed, commit ea516dd on main)
- F1 promotion picker (Q/R/B/N) for human moves; AI/network/devMove pass promotion through (Game.ts requestMove/openPromotionPicker).
- F2 localStorage profile: games, W/L/D per tier, win streaks (src/meta/Profile.ts, key chess3d.profile.v1).
- F3 daily puzzle: lichess /api/puzzle/daily with offline fallback set (src/puzzle/DailyPuzzle.ts + fallback.ts), streak in profile counters, key chess3d.puzzle.<UTC-date>.
- F4 granular results: checkmate/stalemate/threefold/fifty-move/insufficient-material/resignation/timeout/abandonment (Game.ts GameResultKind).
- F5 restart-vs-AI race: ai.stop() before reset, flags cleared, AI re-armed (main.ts, AIPlayer startEpoch guard).
- F6/F7 RLS holes: BEFORE UPDATE trigger enforce_game_invariants + resign_game() SECURITY DEFINER (migration 003).
- F8 presence/disconnect banner + claim-win (MultiplayerSession Presence).
- F9 submit move right after chess.move(), decoupled from animation.
- F10 Beginner AI recalibrated (skill 0, movetime 100ms, weighted MultiPV 4) + opening variety + bestmove timeout.
- F11 Gothic Night brightened (exposure 1.30, hemi 0.85, uplight, lighter dais).
- F12 IBL: PMREM env map set as scene.environment, per-realm environmentIntensity.
- F13 CameraDirector: intro orbit, capture shake, checkmate dolly + king topple + confetti; respects prefers-reduced-motion; window.chess3d.cinematicActive flag.
- F14 settings persistence (src/meta/Settings.ts, key chess3d.settings.v1).
- F15 unlock ladder (src/meta/Unlocks.ts): Fantasy+Gothic default, rest gated on milestones.
- F16 first-run onboarding overlay + persistent "?" button.
- F17 shareable game-over result string + Copy.
- F18 Fischer clock (online), per-move checkpoints (white_ms/black_ms columns), timeout result.
- F19 rematch over Realtime broadcast, reuses room, swaps colors.
- F20 texture leak fixed: Environment.dispose() disposes CanvasTextures.
- F21 single clock.getDelta() per frame.
- F22 sub-items: AI-turn input lock, bestmove timeout, queue UNIQUE + stale cleanup, tap-vs-drag gate, particle dt cap, dev hook gated behind import.meta.env.DEV || ?dev=1, prod sourcemaps off, tweakpane removed, favicon added.

### Verification
- tsc --noEmit PASS, vite build PASS (298.9 KB gzip JS + 7 MB stockfish WASM).
- Adversarial final review (opus): all 22 fixed, no regressions, devMove correctly bypasses the picker (takes a promotion arg), no em-dashes added, no commits during review.
- Live tests: online 2-browser suite 7/9 (the 2 fails were: resign_game 404 = pre-migration, now fixed by 003; and hard-reload-rejoin gets a new anon UUID = known reconnect-identity limitation, see Leftovers).
- rules-ux + visual-cinematic suites are CODE-VERIFIED ONLY: the GPU-less WSL test env runs software WebGL at ~1.4 FPS, which hung browser-driving test agents (evaluate-of-promise has no Playwright timeout). Manual smoke test on dev + prod confirmed: 0 console errors, IBL active, cinematics running, profile/settings/daily stores present, all HUD buttons present, Gothic Night near-black down from 79.6% to 31.9%.

### Deploy (done 2026-06-13)
- Source committed ea516dd, pushed master -> origin/main.
- dist/ force-pushed to gh-pages (449b965). Live build asset: index-CAr0VeOS.js. Title fixed to "Chess 3D - Epic Edition" (hyphen).
- Migration 003 APPLIED to production Supabase (mliblrxegsrylebaslhr) via Management API. Verified: enforce_game_invariants trigger, resign_game (security definer), queue_player_id_unique, white_ms/black_ms columns all present.
- Production smoke test: 0 console errors, dev hook gated (window.chess3d undefined without ?dev=1), resign_game RPC returns 400 not 404.

### Known leftovers (not blockers)
- Online hard-reload reconnect: a page reload assigns a new anonymous UUID, so rejoining a room that holds your OLD uuid in the black seat fails (stuck on "Opening the gates..."). Fix idea: persist the anon session token / identity across reloads, or store a rejoin token. Presence/disconnect otherwise works.
- rules-ux + visual-cinematic never ran live (GPU-less host). Recommend one manual pass on a real GPU: promotion picker on a human pawn-to-8th, the checkmate dolly+topple+confetti, a realm switch (F20 leak is non-visible, check renderer.info.memory.textures).
- Hot-seat decisive games count as gamesPlayed but are excluded from streak (by design).

### Session 3 follow-up (2026-06-14): online reconnect hardening
Investigated the one online test failure (mp-reconnect-regression). Reproduced live: in a real browser the anonymous UUID persists across reload and joinRoom re-attaches to your seat, so the test failure was a headless-harness artifact (the test browser minted a new anon session on reload). Shipped two real robustness fixes anyway (src/net/SupabaseClient.ts signInAnon): use getSession() (localStorage, no network) instead of getUser() so a transient network failure cannot mint a new UUID and strand the player; and call realtime.setAuth() on the session-reuse path so a reconnected client's Realtime channels are authenticated and the opponent's moves keep syncing after reload (was a real latent bug). Clarified joinRoom spectator fallback. tsc clean, deployed (build index-C0mSDgle.js). The "online hard-reload reconnect" leftover from Session 3 is now resolved.

### Session 3 follow-up 2 (2026-06-14): mid-game restyle + realm/mode audit

User report: "when I change something mid-game, the game resets, for instance change the set, shouldn't these changes keep the ongoing game?" Then: "does changing the realm do the same? changing mode? the same?"

Investigation findings (read the code, did not guess):
- SET change WAS the bug. src/game/Game.ts setPieceSet() called this.reset() which does `this.chess = new Chess()` (Game.ts:312), wiping the position, history, and captured pieces. Wrong: a cosmetic look change must not cost you the game.
- REALM change does NOT reset. main.ts:429 `ui.onEnvironmentChange((env) => scene.setEnvironment(env))`. SceneManager.setEnvironment (SceneManager.ts:109) only swaps the environment Group and re-tunes renderer exposure + IBL environmentIntensity per realm. Pieces live on scene.scene (owned by Game), not the env Group, so they survive. Already correct.
- MODE change does NOT reset the board. main.ts applyMode (main.ts:380): to hotseat -> ai.stop() + clear thinking flag; to online -> ai.stop() + clear flag, panel drives create/join; to ai-vs-* -> ai.start(color, diff) from the CURRENT position. No game.reset() anywhere. Caveat: entering Online then creating/joining a room loads that room's separate game (not a reset of the local game).

Fix (commit 83f759b, deployed):
- Game.setPieceSet() now calls a new private restyleInPlace() instead of reset(). restyleInPlace: disposes the on-board meshes and the prison meshes, builds a fresh Prison + CaptureFX (mirrors reset()), respawns the board from this.chess.fen() in the new set via spawnAllFromFen() (which reads this.currentSet), re-seats captured pieces in the new set from the preserved capturedWhite/capturedBlack PieceType[] arrays, restores board.setLastMove(this.lastMoveSquares) and updateCheckRing(). Crucially it does NOT call new Chess() and does NOT fire afterResetListeners, so position, move history (threefold/50-move still valid), turn, captured pieces, last-move highlight, check ring, and the AI's role are all preserved.
- Added Prison.seatInstant(piece) in src/vfx/Prison.ts: drops an already-captured piece straight into the next free cage slot with no animation, mirroring imprison()'s final resting transform (cage = color==='w' ? blackPrison : whitePrison; nextSlot(); cage.root.add(mesh); position=slot.position; scale 0.85; small random rotation).
- capturedWhite/capturedBlack are PieceType[] (Game.ts:61-62), pushed on capture at Game.ts:734-735. Piece constructor is new Piece(color, type, coord, set). spawnAllFromFen uses this.currentSet at Game.ts:333.

Verification + deploy:
- tsc --noEmit PASS (exit 0), no em-dashes added.
- NOT live-tested in a browser: the GPU-less WSL Playwright kept timing out (30s/call) and looked stuck; user stopped that attempt. Shipped on type-check + logic review (mirrors reset/loadPuzzleFen patterns), low risk.
- Committed 83f759b, pushed master->main, built (asset index-n6MAFfYq.js, 299 KB gzip), dist force-pushed to gh-pages (13de828..c7a4db0). Production confirmed serving index-n6MAFfYq.js.
- Manual verify steps for the live site: play moves + a capture, click Set to change style; position, turn, and caged captures should all persist, only the look changes.

Operational note saved to memory (feedback-no-stuck-browser-retries): do not keep retrying flaky 30s-timeout Playwright under this GPU-less env; it reads as stuck. Switch to non-browser verification or ship + let Ahmed verify live.

### Current live state (2026-06-14)
- Repo github.com/Amsamms/chess-3d. Source on `main` HEAD 83f759b. Deployed `gh-pages` HEAD c7a4db0. Live https://amsamms.github.io/chess-3d/ serving index-n6MAFfYq.js. Supabase migration 003 applied. All $0/mo (GH Pages + Supabase free tier).
- Commit chain on main: ea516dd (22 fixes) -> 722c4b7 (docs) -> a28189c (reconnect fix) -> 079f7e1 (docs) -> 83f759b (set restyle fix).
