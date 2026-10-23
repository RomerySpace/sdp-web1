# Local validation: 22 October 2026

## Scope

Baseline: `08d073a`. No production deployment or Cloud voice consumption was
required for these tests. This is not a release certification or a 300-user test.

## Completed

- All 82 server tests passed, run serially. These cover authoritative combat,
  movement, spawn safety, admission, session recovery, chat isolation, seating,
  the instrument, gallery access, inactivity and round state transitions.
- Six existing Chrome session tests passed: desktop/mobile disconnection UI,
  queue and seven-second connection recovery, gallery headphones, instrument
  interaction, corrected positions/seating/inactivity, and automatic round start.
- A new two-browser test passed three actual Limbo/Shooter/Limbo round trips.
  The other visitor remained in Limbo, empty Shooter rooms were disposed,
  authoritative player counts recovered and only one scene canvas remained.
- The revised seating socket test passed: a dropped connection frees the seat,
  reconnects with the same identity and closes without retaining a test reservation.
- Four benchmark utility tests passed.
- A real local WebRTC test passed with two Chrome browsers and synthetic microphone
  input: audio bytes and speaking levels arrived, avatar speaking feedback changed,
  chat arrived, music stayed uninterrupted across push-to-talk, voice disconnected
  in Shooter and reconnected in Limbo, with one remaining live AudioContext.
- Frontend/backend TypeScript checks and the production build passed.

The first WebRTC run passed its audio assertions but failed at an obsolete test
shortcut that only teleported the camera to the sculpture. Authoritative position
reconciliation correctly undid that shortcut. The test now walks to the sculpture,
and the complete test passed on rerun. The unified browser configuration now uses
IPv4 loopback explicitly for reliable local readiness checks.

Round tests advance the trusted server fixture clock. They verify the configured
seven-minute duration and automatic restart, but are not seven-minute soak tests.
Mobile coverage here means Chrome touch/viewport emulation, not physical Safari.

## Small local load test

An isolated backend on `127.0.0.1:2619`, without voice, was exercised for 20 seconds
per measured phase, after a three-second warm-up. All test sockets were removed.

| Measurement | 5 clients | 25 clients |
| --- | --- | --- |
| Unexpected disconnections | 0 | 0 |
| Moving clients | 5 | 25 |
| Delivered/expected chat messages | 10/10 | 50/50 |
| Observed simulation Hz | 20.01 | 19.97 |
| Input acknowledgement p95, ms | 102.26 | 104.76 |
| WebSocket ping p95, ms | 1 | 2 |

Input acknowledgement includes the input/patch scheduling cycle; it is not the
internet round-trip latency. These results exclude GPU rendering, Shooter load,
voice traffic and network distance. They cannot size Frankfurt/Virginia or prove
production capacity.

The initial combined 5/25 run stopped before the second measurement because the
previous phase's admission handover reservations were still valid. The independent
25-client run passed after expiry. The benchmark now waits at least 31 seconds
between phases; it does not weaken production reservation rules.

Raw reports (ignored by Git):

- `.local/stability-load-2026-10-22.json`
- `.local/stability-load-25-2026-10-22.json`

## Still required

- Real microphone/proximity/mute checks on physical devices and separate networks.
- Physical iOS Safari/Android testing, including HTTPS microphone permissions.
- Longer multi-round soak tests and interrupted scene-loading/reconnection tests.
- Progressive Shooter/multi-room load tests and production resource sizing.
- Authorized Cloud voice tests, regional routing and shared reservation storage.
- Production observation after the incomplete-JOIN crash correction.

## Reproduce

```sh
cd server
node --import tsx --test --test-concurrency=1 tests/*.test.ts
cd ..
node node_modules/@playwright/test/cli.js test --config playwright.session.config.ts
node node_modules/@playwright/test/cli.js test --config playwright.unified.config.ts --grep 'real WebRTC media work'
node --import ./server/node_modules/tsx/dist/loader.mjs --test scripts/load-multiplayer.test.mjs
npm run typecheck:all
npm run build
```

The session browser suite creates isolated local room/Vite fixtures. Do not point
trusted fixture clock manipulation or load tests at production.
The WebRTC test additionally requires the unified local backend and LiveKit; verify
that the voice access URL is `/voice` before using it as a no-Cloud test.
