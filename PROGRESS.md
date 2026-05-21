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
