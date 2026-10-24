# Runtime and deployment checks

## Public health

`GET /health` is a lightweight liveness check, without matchmaking, physics
creation, voice requests or a query for every room. It returns region, revision,
uptime, total visitor capacity and room capacities (25 Limbo / 15 Shooter).
Legacy `capacity` remains Limbo's limit. Render supplies `RENDER_GIT_COMMIT`;
local builds may use `SDP_BUILD_SHA`, otherwise revision is `local`.
`voice: configured` means credentials exist, NOT that LiveKit accepts connections.
HTTP 200 does not certify performance, geographic latency or 300-user capacity.

## Runtime logs

Every five seconds the process samples current rooms and resources. Every
30 seconds it emits one `[SDP] Runtime` JSON record in the existing server logs:

- CPU percentage relative to ONE core; RSS / heap / external memory in MiB.
- Event-loop p95 / maximum delay over that window, at 20 ms resolution.
- Admission capacity, admitted visits, connected waiting visitors and detached
  queue reservations. Admitted visits include reserved/transitioning visitors.
- Per-mode room count, connected players and disconnected reserved avatars.
- Actual simulation ticks/second for active rooms with consecutive samples:
  minimum, mean and count below 90% of the room's configured target.

First samples and previously empty rooms have no measured tick rate. Disposed
rooms leave sampler history. These measurements describe the backend, not
browser FPS or Internet ping. No usernames, room/session identifiers, positions,
admission tickets, chat or authentication tokens are logged by this sampler.

Sampling never changes gameplay, admission or health status. Correlate occasional
slow windows with loading and provider metrics. Persistent slow rooms, high CPU,
or growing memory warrant investigation; transient slow ticks should not trigger
automatic restarts. Uptime helps identify restarts but is not a crash counter.

## Optional private endpoint

`GET /diagnostics` reads the cached sample, without a new room query. Disabled by
default (404). Enable later with a random 32-128 character URL-safe
`SDP_DIAGNOSTICS_TOKEN` on the backend. Invalid nonempty configuration fails startup.
Never put it in frontend/VITE variables or a URL.

Requests require `Authorization: Bearer <secret>` and an allowed Origin when
present. Wrong/missing credentials return 404, untrusted Origins 403, responses
are `no-store`. Authentication uses constant-time hash comparison. The response
is aggregate-only; `sampleAgeSeconds` exposes a stale sampler. No public metrics
dashboard, monitoring account or paid alerting service is created by this change.

## Release checklist

1. Run `npm run test:server`, `npm run typecheck:all`, `npm run build`,
   `npm run test:regions` and relevant session browser tests.
2. Deploy backend before frontend when changing protocols. Confirm Render is live
   at the intended commit, `/health` has the expected region/revision, and Vercel
   has completed the same release.
3. Test public entry, two-client chat, lazy Shooter entry, connection cuts and
   return to Limbo. Do not implicitly load-test the free public backend.
4. Inspect logs and provider metrics for restarts, memory and simulation slowdowns.
   A green `/health` does not rule them out. Configure external uptime monitoring
   and alerting when launch infrastructure is selected.
5. Validate voice separately: LiveKit 429 cannot be fixed by upgrading Render alone.

Region activation: [SERVER-REGIONS.md](SERVER-REGIONS.md). Queue guarantees and
in-memory restart limits: [ADMISSION.md](ADMISSION.md). Multi-process regional
coordination, paid-region sizing, 300-user load validation and Cloud voice
validation remain launch work.
