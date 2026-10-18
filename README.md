# SDP — Unified Limbo / Shooter

This working copy integrates both existing experiences on the `feature/unified-sdp` branch. Start it with `npm run dev:unified` at **http://localhost:5373**. For the architecture, imported modules, actual limitations and Spanish setup/testing instructions, see [UNIFIED-SDP.md](./UNIFIED-SDP.md). Production uses Vercel for the frontend and Render for Colyseus; publish matching versions together.

A local, first-person sculpture exhibition in a luminous white environment. Vite, TypeScript, Three.js/WebGL 2, native pointer lock and Web Audio, with Colyseus multiplayer rooms of up to 25 people, shared room text chat and LiveKit proximity voice. For the HTTPS two-computer Wi-Fi test, run `npm run dev:lan` and follow [LAN.md](LAN.md), including certificate trust on both devices.

For beginner-friendly setup and two-window testing in Spanish, see [MULTIJUGADOR.md](./MULTIJUGADOR.md).

For an online two-computer test using Vercel, Render and LiveKit Cloud, see [ONLINE.md](./ONLINE.md). Deployment configuration is included in `vercel.json` and `render.yaml`; cloud credentials stay exclusively on the backend.

The ambient music station adds four shared loop tracks, a chromatic computer/touch piano, six surrounding two-seat benches and an exclusive performer lease. Controls, audio limits and testing: [AMBIENT-INSTRUMENT.md](./docs/AMBIENT-INSTRUMENT.md).

## Run locally

Use Node.js 22.12+ (Node 24 is supported), then:

```sh
npm run install:all
npm run dev:all
```

Open **http://127.0.0.1:5173**. Keep the terminal running. Click **CLICK TO ENTER** to reveal the exhibit and grant mouse control.

The game server listens on `0.0.0.0:2567`. `npm run dev` still starts only Vite; `npm run dev:server` starts the backend separately. `dev:all` starts movement and text over local HTTP; `dev:lan` also starts trusted-certificate HTTPS and a local LiveKit server. Configure ports/IP in `.env.local`; the browser uses same-origin `/multiplayer` and `/voice` reverse proxies, not another computer's localhost. No cloud credentials are required for the generated local LiveKit configuration.

```sh
npm run typecheck
npm run build
npm run preview
```

`build` checks TypeScript and creates `dist/`. `preview` serves that production build locally. Microphone access requires localhost or HTTPS.

## Controls

| Control | Action |
| --- | --- |
| W A S D | Walk at 3 m/s with smooth acceleration and pedestal collision |
| Mouse | Look around while pointer lock is active |
| Enter | Open room chat; Enter again sends non-empty text |
| Esc | Close chat, or release the cursor using browser behavior |
| V | Microphone activation: HOLD or ON / OFF, selected in the Limbo P menu |
| E near the pedestal, looking at the sculpture | Inspect directly; the discreet JOIN SHOOTER TEST button loads the simulation |
| Hold SHIFT in Limbo | Sprint smoothly at the configured speed (currently 2.25x walking) |
| H in Limbo | Hide or restore the entire lobby HUD, without floating icons; P always opens the menu (double-tap on touch devices while hidden) |
| Drag / mouse wheel during inspection | Rotate the sculpture / zoom within fixed limits |
| P | Open/close settings in Limbo, or the ranking/settings menu in Shooter |
| F | Toggle fullscreen throughout the experience, except while typing |

Press P to access settings without needing the cursor first. Fullscreen, mute, sensitivity, game/music volume, microphone activation are inside the menu. Preferences persist between modes and visits. Music volume controls the supplied playlist independently of Shooter effects; it does not mute proximity voice. Click the resume prompt after releasing the cursor with Esc. Chat disables movement, fullscreen and voice shortcuts, but preserves an already active ON/OFF microphone. HOLD silences the microphone on release; ON/OFF silences it on the next press. Both modes silence on focus loss and stop capture on room changes, hidden pages or disposal. Pending permissions never override a later mute. Voice stays in the corresponding LiveKit room and is never played back to its sender. Spatial playback is full at 0-3m, attenuated at 3-15m and silent beyond 15m; the listener follows the camera.

Touch devices can explore both modes without pointer lock. The left analog joystick moves, the right side controls the camera, and the sprint button toggles running. Approach and face the sculpture to tap INTERACT; drag or pinch to inspect it, then tap X to return. Shooter adds a hold-to-fire button that also supports drag-to-look, toggle ADS/crouch, jump, reload and AUTO/SEMI switching. Separate fingers can move and fire/look simultaneously. Chat has send/close buttons; hold the microphone button for Limbo voice. The menu contains ranking, sensitivity, volumes and fullscreen where the browser supports it. Controls clear on pause, cancellation, orientation changes, death and respawn. Desktop controls remain unchanged; only non-touch browsers without pointer lock retain the limited viewing fallback. If WebGL 2 is unavailable, the page displays a readable fallback.

Touch controls use Pointer Events, safe-area insets and portrait/landscape layouts, with no extra animation loop. The joystick's left-side hit area remains active while its visuals appear only during a movement contact; release, cancellation, focus loss and resizing clear it. The mobile Shooter HUD hides the large streak announcement and unavailable rewards, retains usable 44px reward buttons, and limits the feed to the latest two eliminations. Compact landscape hides optional score/chat previews; opening chat still exposes the full history. Analog values are validated in [-1, 1], diagonals are capped, and existing authoritative physics/speed limits still apply. `src/input/InputCapabilities.ts` holds joystick dead zone and look sensitivity; `src/styles/touch.css` holds HUD layout. `npm run test:unified -- --grep 'touch|mobile'` exercises native Chrome touch input via CDP, multiplayer and mic cleanup. The layout tests also use WebKit: install its test binary with `npx playwright install webkit`. Browser emulation and WebKit fixtures do not guarantee performance or permissions on a physical iPhone.

On desktop, inspection opens directly after approaching within 3m and facing the sculpture (E / INTERACT). It renders a centered copy of the sculpture using Three.js OrbitControls and a separate camera, sharing geometry without moving the visitor or changing their multiplayer position. Walking is stopped, but push-to-talk remains available; Enter opens chat. E, Esc, the close button or focus loss leave inspection. The camera can zoom in to 1.12 times the model's bounding-sphere radius, staying outside the mesh, and out to 1.5 times its fitted distance. Pan is disabled and portrait viewports are reframed. Both sculptures keep rotating: the exhibition completes a turn in 54 seconds and inspection in 80 seconds. Soft key, fill and rim lighting reveal the matte-black details.

## Interaction And Atmosphere Refinements

### Visitor Boundaries And Listening Clearing

Look at a visitor within 6m and press E (or tap their name on touch devices) to open visitor options. Mute voice silences received audio and its speaking glow; Hide messages removes that sender's current history and filters subsequent messages; Block visitor combines both. All actions are local and reversible through P > VISITORS, including after a visitor disconnects. Unhiding does not recover discarded messages. These settings use server-issued session IDs and last only for this page visit: they are not account bans, do not prevent the other person hearing your published voice, and cannot stop someone returning under a new session. They do not kick anyone or change room population. Durable blocking requires authenticated identities and backend enforcement in a later phase.

One listening tree sits at x=36, z=-24, roughly 43m diagonally from the monolith. Three rounded white benches face the tree from about 6m away, directly on grass without a platform. Look at a bench within 2.7m and press E (or tap SIT) to sit; E / STAND UP, walking or jumping gets up. Sitting smoothly lowers the camera, preserves free look, voice and text chat, and appears as a seated pose to other visitors. The server validates distance, chooses all seat/exit coordinates, reserves one visitor per bench and releases it on disconnection. It will not stand a visitor inside another avatar or a scene collider. Pausing/chat does not vacate a bench. No private voice room is added. Grass is suppressed only inside the bench footprints. `shared/LobbyRetreat.ts` defines layout, interaction distance, seated eye height and exits for client/server use; existing spawns stay clear. The supplied Lloque model is adapted to white materials and simplified from 496,781 to 108,077 triangles; the GLB is approximately 0.99MB rather than the original 12MB. It loads asynchronously without blocking entry or initializing Shooter. Its decoder lives at `/draco/`, separate from Shooter-only assets. Attribution: `/models/tree-LICENSE.txt` (hanandess, CC BY 4.0). Regenerate with `node server/scripts/prepare-lobby-tree.mjs /path/to/tree.glb` after installing server dependencies. The source is not modified. Publishing this revision requires both the frontend and the updated Colyseus backend.

The Limbo preferences menu groups look sensitivity, independent game/music volumes, microphone HOLD / ON-OFF and fullscreen. H hides/restores the HUD, as shown in the lobby instructions. Microphone mode persists locally; selecting ON/OFF does not authorize or start the microphone by itself. V (or the touch mic button) starts/stops it. ON/OFF remains active through chat and menus; V also toggles it in the menu, but never while typing a message. HOLD releases when opening interfaces. Focus loss, hidden pages, permission loss and room changes still silence capture for safety. The existing muted capture can remain prepared between transmissions to avoid audio-route interruptions.

Each of the three retreat benches has two independent server-owned seating slots. Aim at a half and press E (or tap SIT); if that half is occupied, the other free half is offered. Both occupied means unavailable. E, movement or jumping stands up; disconnecting releases the place, including during the reconnection grace period.

Music runs at the recording's original 1x rate. It aligns to the shared programme when entering/resuming or starting a track, without continuous clock-driven speed changes or mid-listening seeks. Small device-clock drift is tolerated instead of audibly correcting playback. The existing sky-positioned audio and hall reverb remain intact.

The sky gradient is evaluated from world-space viewing direction, not viewport UVs, so its horizon no longer sticks to the camera. Visitor names appear only under the centre reticle within 6m, respect the sculpture/pedestal occlusion and disappear on look-away, disconnect or Hide HUD. Adjust this radius in `lobbyAmbience.identity.distance`.

Chat freezes the current world framing, including ADS/FOV and sculpture inspection. The renderer ignores software-keyboard viewport reductions until chat closes and the viewport recovers. On phones this is covered by Chrome touch/viewport emulation, not physical-device certification.

Shooter uses the same Rapier movement controller on client and server: ballistic gravity, a 120ms jump buffer, 100ms coyote time and airborne crouching that draws the feet up. Obstacles and ceiling clearance still apply. Recoil retains automatic climb, resets its burst pattern after 260ms, and recovers 85% of uncompensated kick after a 120ms delay. Mouse compensation cancels the corresponding pending recovery instead of dragging the aim down twice.

`src/core/LobbyAmbience.ts` configures rain density/timing and speaking glow. Rain has deterministic UTC-based intermittent episodes, six-second fades and a single GPU-instanced draw (450 drops on touch devices, 1,100 on desktop). It stays hidden before entry and outside normal Limbo rendering. Voice opacity remains intact and now also drives emissive brightness and a soft silhouette halo from the existing received-microphone levels, without extra lights or audio contexts. `shared/GameplayConfig.ts` contains recoil recovery controls; `src/modes/shooter/config/gameConfig.ts` contains jump and air-control settings.

## Assets

- **`public/hdr/puresky.exr`** — the supplied asset is preserved and loaded with `EXRLoader`, prefiltered with `PMREMGenerator`, and used for material lighting/reflections. The visible background is a separate atmospheric shader. Diffuse lights remain available if loading fails.
- **`public/audio/ambient.mp3`** — optional and intentionally not supplied. Add your own licensed, loop-ready ambient track and **restart Vite**, or rebuild for production. Missing audio produces one development warning and no failing request or broken UI. The sound system decodes and loops the asset, filters it, adds a restrained convolution reverb and fades it in. A clean musical loop depends on the supplied recording's loop boundaries. Mute preference persists in localStorage; playback never starts before entry.
- **`public/SDP/SDPv1.glb`** — the supplied sculpture replaces the rectangular placeholder. `GLTFLoader` loads it during initialization; its height is normalized to 0.95m (approximately 2m long), fitting over the 2.4m pedestal, and its baseline remains 0.13m above the original pedestal. All meshes use a uniform matte-black material without texture maps, with 0.82 roughness and restrained HDR reflections. If loading fails, the exhibition remains usable and inspection stays unavailable.

All asset paths are relative to the site root; the current configuration assumes root-path hosting.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `src/core` | App lifecycle, animation loop and explicit INTRO / ENTERING / EXPLORING / CHATTING / INSPECTING / PAUSED states |
| `src/scene` | Renderer, EXR lighting, white atmosphere, floor/pedestal, rotating sculpture and isolated inspection camera |
| `src/player` | Keyboard input, yaw/pitch camera and circle-versus-AABB collision with sliding |
| `src/ui` | HTML intro, HUD, accessible settings, chat and pause prompt |
| `src/chat` | Bounded server-echoed room history, independent of distance |
| `src/audio` | Optional ambience, microphone push-to-talk, LiveKit transport and 3D voice playback |
| `src/network` | Colyseus connection/session lifecycle, input synchronization, chat and session-bound voice token requests |
| `shared` | Validated movement protocol and common movement rules |
| `server` | Local TypeScript/Colyseus WebSocket server, 25-player rooms and isolated 20 Hz authoritative simulation |

The renderer caps device pixel ratio at 1.75, uses 1024px variance shadows, shares atmospheric uniforms and avoids postprocessing. A single background draw and material fog shaders create moving diffusion and distance-dependent contrast. The 3.6s reveal uses quintic easing. Animation and movement use capped delta time; rendering stops while the tab is hidden. Resources and event listeners are disposed on page exit and Vite hot reload.

`MultiplayerConnection` separates room snapshots, session/status events, server-owned spawns, movement inputs, room chat and token requests from rendering. `RemotePlayerManager` retains shared capsule geometry and buffered 100ms interpolation. The server still validates sequenced inputs and simulates constant 50ms steps with a 3m/s speed limit, normalized diagonals, pedestal collisions and a 250ms stale-input stop. Short drops reserve a session for five seconds; confirmed disconnects remove avatars immediately. `ChatPolicy` validates/rate-limits text and the server fixes the sender. `VoiceSessions` issues 60-second microphone-only tokens bound to the Colyseus room/session. `LiveKitVoiceTransport` handles WebRTC and PannerNode/GainNode playback independently from rendering and microphone permission handling. Continuous movement reconciliation remains future work.

## Browser validation

For staged multiplayer load tests with 25, 50 and 100 simulated clients, see [LOAD-TEST.md](./LOAD-TEST.md). Run `npm run test:load` against the local backend. Remote tests require explicit owner authorization and `--allow-remote`; they do not exercise graphics or LiveKit voice.

```sh
npm test
```

To smoke-test the production build on macOS/Linux after `npm run build`:

```sh
SDP_PREVIEW=1 npm test -- --grep 'HDR, reveal'
```

The Playwright suite launches the local Vite server and installed **Google Chrome**. Test-only Chrome flags provide a synthetic microphone; no real microphone or remote service is needed. Tests cover EXR loading, reveal states, pointer lock/recovery, chat sanitation and input isolation, microphone release/permission races/denial, mute persistence, fullscreen, mobile viewing, delta-time movement, collision sliding/tunnelling and state consistency. Screenshots are saved under `test-results/` and failure traces are retained. The optional audio test runs only when `ambient.mp3` is present.

Frontend runtime dependencies: Three.js, the official Colyseus SDK (0.17 series), LiveKit client and Lucide icons. The separate backend uses compatible Colyseus core/WebSocket packages, schema synchronization and Express routing. TypeScript, Vite, Playwright, concurrently and Sharp are development tools. Visual performance should be measured on the intended visitors' GPUs; 60 FPS is a target, not a guarantee established by headless browser tests.

## Digital memory fragments

The existing scene now includes world-space reconstructions of the images in `public/graficos/`. The sculpture, pedestal, HDR, atmosphere, entry sequence, player controls, UI, chat and audio retain their existing implementations. `SceneManager` owns the fragment manager and updates it in the same render loop, using the existing camera.

```sh
npm run process:graphics
npm run test:graphics
npm run build
```

Add or replace PNG, JPG, JPEG or WEBP files, including subfolders, then run `process:graphics` again. Source files are never modified. The script also accepts a root-level `graficos/` folder. It reports unreadable or unsupported files, processes the remaining valid images, and writes `public/generated/graphics/manifest.json` with source hashes, reconstruction choices and counts. Assets absent from the new manifest are no longer loaded.

Sharp is used only by the offline development pipeline. It decodes and orients images, preserving aspect ratio and alpha. The script smooths noise, computes Sobel gradients, uses non-maximum suppression and hysteresis to identify significant edges, traces their contours, and simplifies them with Ramer-Douglas-Peucker. A separate tile-based salience pass selects sparse image details. Luminance, local contrast and contours supply restrained pseudo-depth; this is an artistic relief, not inferred physical depth. Photographs combine contours and denser points, while high-contrast graphics favour contours with fewer points. Rounded JSON coordinates keep the three current assets under 330 KiB combined before HTTP compression.

`src/scene/graphics/` contains the reusable fragment, manager, loader, materials and configuration. Each asset owns just two shared `BufferGeometry` objects, reused by its instances. All fragments share two fog-aware shader materials. Each instance submits at most one `LineSegments` draw and one `Points` draw, with no image textures, surfaces, colliders, extra cameras or renderers. Vertex attributes progressively reveal sections and individual points, converge small offsets, and add very slow drift. Reconstruction takes 3.2 seconds by default.

The manager activates after the introductory reveal. Seeded 8m cells generate stable positions without storing an unbounded visited-world history. It keeps up to 12 nearby instances, recycles dissolved/distant instances, and protects a 6m exclusion radius plus each fragment's bounds around the pedestal. The starting sightline stays clear. Opacity increases between 18m and 4m, dissolves near the visitor, and blends with scene fog. Slow-frame averages reduce submitted geometry with draw ranges, retaining the strongest contours and details first. This is a bounded quality fallback, not a hardware-independent 60 FPS guarantee.

Defaults and all tunable parameters live in `FragmentConfig.ts`. For development only, open `/?graphicsDebug=1` to expose the manager in the browser console:

```js
sdpGraphics.config
sdpGraphics.stats
sdpGraphics.snapshot
sdpGraphics.configure({ maximumOpacity: 0.5, depthStrength: 1.1 })
sdpGraphics.configure({ enabled: false })
```

The normal URL exposes no debug controls, and production builds never expose this console object. `configure()` validates ranges; changing placement-related parameters regenerates the nearby layout. Tune `fragmentCount`, `spawnRadius`, `exclusionRadius`, `minimumOpacity`, `maximumOpacity`, `reconstructionDuration`, `depthStrength`, `pointDensity`, `lineDensity`, `fragmentScale`, `driftSpeed` and `visibilityDistance`. `cellSize` and `seed` control spatial distribution. Resource disposal releases pending requests, shared buffers and shader materials.

The processing tests check a known silhouette, deterministic reproduction of all supplied images, source SHA-256 hashes, aspect ratios, depth variation and error handling. The browser tests additionally check hidden introduction state, actual WASD movement, progressive reconstruction, near/far dissolution, parallax, chunk recycling, stable revisits, shared resources and disposal. Existing interaction tests continue to cover the exhibition controls and audio lifecycle.

API references: [Three.js EXRLoader](https://threejs.org/docs/pages/EXRLoader.html), [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html), [Vite](https://vite.dev/guide/).

## Listening garden trial

An open, grass-filled conversation enclosure sits at `(3, 46)`, over 40 metres
from the sculpture, tree and field instrument. A 25m-wide depression descends
1.65m through a smooth grassy slope into a broad flat centre. Eight curved,
inward-facing seats form an interrupted arc; each has two server-reserved places.
Use the existing E interaction to sit or stand. No platform, extra soundtrack or
private chat room is added: voice still uses normal proximity and text remains
room-wide. Its layout lives in `shared/ListeningGarden.ts`; existing seat IDs
stay stable. The same height profile drives the actual ground mesh, instanced
grass, local prediction, server movement and seating. Outside the garden the
floor remains level. The instrument supports overlap its underframe and tabletop.
