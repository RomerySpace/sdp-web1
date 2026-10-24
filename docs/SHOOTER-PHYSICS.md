# Shooter rooms and collision optimization

For the later movement-query optimization, day-only Shooter and the mixed-load
comparison, see [SHOOTER-OPTIMIZATION-2026-10-24.md](SHOOTER-OPTIMIZATION-2026-10-24.md).

## Room limits

`SHOOTER_MAX_PLAYERS` in `shared/ShooterProtocol.ts` is 15. Both the authoritative
room and its schema advertise this value. Limbo retains 25. The global admission
capacity remains separate and unchanged; this work does not raise it to 300.

Socket tests check that visitor 16 goes to a second Shooter room, direct joins to
the full room fail and a disconnected player's reserved seat is not stolen.

## Shared physical surfaces

The original visual GLB and its marble materials are unchanged. The build script
uses the existing meshoptimizer dependency to weld identical positions, simplify
with `LockBorder` and a 0.005 m absolute error setting, then compact unused vertices.
Settings live in `shared/ShooterCollisionAsset.ts`.

Before accepting each block, deterministic ray probes compare the original and
candidate collision surfaces with a 0.015 m ray-distance tolerance. Hit/miss
differences or larger distance changes retain the original block. This build used
26,051 probes and conservatively retained 12 of the 76 original blocks.
Navigation is regenerated from the resulting surfaces: 66 outdoor spawn points,
five map zones and 3,217 connected cells. These sampled checks are safeguards,
not proof that every possible grazing ray is identical to the original mesh.

The server and browser load identical portable little-endian typed-buffer data.
Headers, versions, index bounds, finite coordinates and spawn points are checked.
The browser downloads/decompresses the asset only on explicit Shooter entry,
caches it between entries and builds a separate Rapier world per active mode.
No meshoptimizer WASM or build tooling is shipped to the browser.

Regenerate with:

```sh
npm run prepare:shooter
```

Generated files:

- `server/assets/dust2-colliders-v4.bin.gz`: ignored, regenerated during Render build.
- `public/shooter/physics/dust2-colliders-v4.bin.gz`: tracked, served by Vercel.

Include the public file whenever regenerating physics. Coordinate frontend/backend
deployments. The new separate browser physics download is approximately 5.18 MiB,
once per page session; previously the browser reconstructed physics from the
visual map. This trades some initial Shooter download size for shared validated
geometry, lower working memory and less runtime geometry processing.

## Local measurements

| Collision data | Before | After |
| --- | --- | --- |
| Triangles | 847,353 | 672,039 |
| Vertex/index bytes | 22,108,812 | 14,515,452 |
| Compressed server asset | 7.24 MiB | 5.18 MiB |

`server/scripts/profile-shooter.ts` measures 15 moving controllers per room in a
fresh local process, 30 warm-up steps and 120 measured steps per stage. It excludes
networking, chat, rendering, voice and real-time scheduling. RSS includes Node,
cached collision data and Rapier, not just the map. It is not a Render measurement.

| Rooms / players | RSS before | RSS after | All-room step mean before / after |
| --- | --- | --- | --- |
| 1 / 15 | 337.41 MiB | 301.41 MiB | 2.64 / 2.67 ms |
| 2 / 30 | 438.23 MiB | 382.39 MiB | 6.90 / 6.59 ms |
| 3 / 45 | 538.89 MiB | 463.83 MiB | 12.49 / 11.52 ms |

The observed CPU improvement is modest and not present in every case; do not
infer production capacity or guaranteed FPS from this microbenchmark. Raw local
reports are ignored under `.local/shooter-physics-before.json` and
`.local/shooter-physics-after.json`.

```sh
cd server
node --import tsx scripts/profile-shooter.ts --output ../.local/shooter-physics-after.json
node --import tsx --test scripts/optimize-collider.test.mjs
node --import tsx --test --test-concurrency=1 tests/*.test.ts
cd ..
npm run typecheck:all
npm run build
```

Further simplification should be guided by additional map traversal/shot tests.
Several full rooms still require production CPU/memory testing and appropriate
hosting; the free Render plan is not certified for these measured populations.

## Validation (2026-10-23)

- Frontend/backend TypeScript checks and production build passed.
- Full server suite: 85 tests passed. Socket tests verify 15+1 room allocation,
  rejection of direct entry into a full room and reserved-seat reconnection.
- Simplifier test preserves an opening and rejects displaced collision surfaces.
- Desktop Playwright passed lazy asset loading, visible rendering, controls,
  repeated transitions and one physics download across repeated entries.
- Mobile Playwright passed two connected touch clients, simultaneous movement,
  look/fire, crouching, jumping, reloading and returning to Limbo.
- Earlier desktop attempts encountered a development HMR reload during an edit
  and a resume-button/pointer-lock test race. After stabilizing the test helper,
  the complete desktop scenario passed without runtime edits during execution.

These checks are local, not a production load test or LiveKit Cloud capacity
validation. Deployment additionally requires online smoke checks.
