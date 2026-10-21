# Admission and reconnecting

The production server requires a private admission ticket for both gameplay modes.
`SDPAdmission` admits visitors FIFO; switching modes reuses the same ticket.
`SDP_VISITOR_CAPACITY` is the total number of admitted visitors on this server,
including disconnected reserved players. Default: 25. Each gameplay room still
has its own 25-player limit and Colyseus allocates additional rooms as needed.
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
