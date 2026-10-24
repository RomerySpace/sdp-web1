# Admission and reconnecting

The production server requires a private admission ticket for both gameplay modes.
`SDPAdmission` admits visitors FIFO; switching modes reuses the same ticket.
`SDP_VISITOR_CAPACITY` is the total number of admitted visitors on this server,
including disconnected reserved players. Default: 25. Limbo rooms allow 25 players;
Shooter rooms allow 15. Colyseus allocates additional rooms as needed.
Increasing this setting is not evidence that the server can handle that load.

- An unexpected disconnect preserves the player, room and position for 120 seconds.
- The SDK retries automatically; a page reload in the same tab can recover the
  private reconnection token from session storage. Tokens are not public IDs.
- Queue visitors retain their place for 120 seconds after disconnecting.
- An unused admission grant expires after 30 seconds.
- A normal room change has a 30-second handover allowance. Idle eviction releases
  admission immediately and does not reserve an inactive visitor's place.
- When a reservation expires, the visitor must enter the queue again.

Coordination is deliberately single-process and in-memory. Restarts invalidate
reservations. Before multiple backend instances/regions share a capacity, move
admission and queue ordering into a shared transactional store. No Redis or paid
infrastructure has been added here.

Deploy the backend before the new frontend: old clients without admission tickets
must reload once to receive this version. Vercel and Render configurations remain
unchanged; optional `SDP_VISITOR_CAPACITY` belongs on the backend only.

The introduction displays an indeterminate loading bar while the sculpture/HDR
prepare, then during connection/queue admission. It does not fabricate a download
percentage or preload Shooter assets.

## Stalled connections and recovery feedback

The admission room sends a status heartbeat at least every five seconds, including
when a visitor's queue position has not changed. The client closes a queue socket
after 15 seconds without a valid status and retries through the existing bounded
backoff. It retains the private ticket, so a valid reservation restores its FIFO
position. Heartbeats do not create new tickets or extend a disconnected queue
reservation. Timers are cleared on entry, errors, cancellation and disposal.

The disconnect screen distinguishes browser-offline status, automatic recovery,
an expired reservation, queue position and a ready admission. Repeated status
updates do not restart its countdown or replace an expired-reservation message
with a promise of another two minutes. The countdown is a local estimate of the
maximum recovery allowance; the server remains authoritative about admission.
Inactivity releases capacity immediately and offers REJOIN without promising a
reserved place. A backend restart also invalidates in-memory reservations.

Checks:

```sh
npm run test:server
npm run test:session -- --grep 'silently stalled queue|disconnect screen|entry queue|REJOIN after real idle|recover connection cuts|expired and malformed'
npm run typecheck:all
npm run build
```

The stalled-queue browser test uses three visitors and a server capacity of one.
It suppresses queue status delivery without closing the socket, verifies automatic
replacement of that connection with the same ticket and order, then releases a
place and checks automatic entry. This is a recovery test, not a 300-user capacity
or regional WAN benchmark.
