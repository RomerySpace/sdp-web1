# Session activity and lobby reconciliation

The server removes a session after five minutes without meaningful activity in
either Limbo or Shooter. Movement, looking, chat, valid actions and user control
events renew activity. Receiving state, automatic input heartbeats, voice token
refreshes, music and incoming chat do not. Actual local voice activity also renews
the session; merely leaving a microphone enabled does not.

The server owns the deadline. The client reports trusted user events at most
once per ten seconds. This is resource management, not an anti-bot mechanism.
Expiry removes the player and releases their seat/instrument/voice session through
the existing leave lifecycle. Close code 4001 disables automatic reconnection.
The disconnected screen offers an explicit REJOIN action that reloads the entry.

Limbo records predicted feet positions per input sequence. Authoritative state is
compared to the corresponding acknowledged sample rather than the current camera
position. Corrections also shift outstanding samples, preserving unacknowledged
motion without applying the same correction repeatedly. Small corrections adjust
simulation immediately and decay the camera offset. Large discrepancies snap to
the server location and clear stale history/velocity. Seating and reconnecting
reset history. Movement pauses during a lost connection. Clients still cannot
submit arbitrary positions.

Stationary recovery additionally compares the current feet position to settled
server updates, even when an acknowledgement has no matching history sample.
It waits until the last moving input has been acknowledged, avoiding corrections
back to pre-movement snapshots. A 1.5-second stale-state guard stops prediction
during a half-open connection and restores authoritative position on recovery.

The instrument uses one shared reach rule measured from the tabletop edge.
Every claim has a request ID and a direct accepted/rejected response carrying
the authoritative player position. Pending claims display feedback, time out
explicitly, and release late/cancelled ownership. Bench distance rejections also
send a position correction. Gameplay E is not swallowed by a focused HUD button.

Round results now have a prominent NEXT ROUND countdown and progress indicator
above the ranking. The display uses server time plus snapshot age, and the server
continues to control the automatic restart.

Parameters: `shared/SessionPolicy.ts`; round duration: `shared/GameplayConfig.ts`.

Validation:

```sh
npm run typecheck:all
npm run test:server
npm run test:session
npm run test:unified -- --grep 'lower gallery:'
npm run build
```

The session browser tests use an isolated local server. Test-process clock changes
exercise the actual eviction and round restart without waiting five/seven minutes;
there is no public clock-control endpoint. Two real browser clients verify a forced
position discrepancy, successful shared seating, and no reconnect after expiry.
Desktop and mobile-sized screenshots verify the countdown layout.
