# Regional servers

## Current state

EU / FRANKFURT uses the existing backend. USA / VIRGINIA is visible but unavailable
unless explicitly configured. This change does not provision services, change
plans, or publish a second backend.

The selector appears in the username form after CLICK TO ENTER. Selection is
remembered locally. Region changes are allowed only before entering; reload to
return to that form. Losing connection never silently moves a visitor to another
region. Mode transitions and invitation acceptance keep the selected backend.

Names, invitations, admission queues and reservations are independent per backend.
Friends must select the same region. Matching names in different regions are valid.
The current directory is process-local: multiple replicas in one region would
require shared coordination before deployment.

## Future activation

1. Deploy the backend in the intended location, using the existing deployment
   settings and secrets. Set `SDP_REGION=eu` in Frankfurt or `SDP_REGION=us` in
   Virginia. This identifies the service; it does not choose its hosting location.
2. Allow the actual frontend origins with the existing `ALLOWED_ORIGINS` setting.
   Verify `/health` reports `status: "ok"`, the matching `region`, and an allowed
   browser Origin receives the corresponding CORS header.
3. Configure the frontend build:

   ```dotenv
   VITE_SDP_EU_SERVER_URL=https://<frankfurt-backend>
   VITE_SDP_US_SERVER_URL=https://<virginia-backend>
   VITE_SDP_US_ENABLED=true
   ```

4. Rebuild and deploy the frontend only after both backends are ready. Test each
   endpoint, cross-mode invitations, reconnects, voice and real network latency.

USA requires an enabled flag and a valid endpoint distinct from EU. HTTPS pages
reject insecure HTTP/WS endpoints. Explicit regional URLs are verified against
`/health` before joining. A mismatched or unreachable backend leaves the name form
available with an error, rather than routing the user elsewhere. Region identity
is configuration validation, not a claim of measured geographic latency.

Without an explicit EU URL, the existing `VITE_SDP_SERVER_URL` or same-origin
`/multiplayer` proxy remains supported without requiring new health metadata.

## Stored visits

Admission and reconnect keys are scoped to the canonical backend URL. EU tokens
are never submitted to USA. Legacy keys migrate once, only into EU when its URL
matches the previous endpoint. Keep that canonical URL unchanged to preserve
stored visits. Changing endpoints intentionally does not migrate reservations.

## Local verification

```sh
npm run test:regions
npm run test:server
npm run typecheck:all
npm run build
```

The regional browser suite starts two temporary local backend processes. It tests
independent matching usernames, duplicate rejection within one server, regional
invitation isolation, lazy Shooter loading, persisted selection, reload recovery,
connection cuts and return to Limbo. The entry form is also checked on desktop
and mobile viewports, with USA unavailable by default.

These are local tests, not validation of 300 concurrent users, paid hosting,
intercontinental latency, or LiveKit Cloud capacity. No new cloud resources are
created by the suite.
