# Kenosis listening prototype

The existing film stays synchronized to the room clock and loads only when
approaching the lower gallery. It is silent until the visitor chooses to listen.
Look at the white headphones below the screen and press E, or tap LISTEN on a
touch device. The existing game-volume setting controls the film audio.

Listening is personal, not an exclusive reservation. Multiple visitors can use
the same work. Colyseus validates pickup proximity and synchronizes the listening
flag to the other avatars. The server clears it when leaving the gallery or
moving beyond the hearing radius. Benches remain usable while listening.
When no bench/visitor interaction takes priority, E returns the headphones;
looking at the wall headphones also makes the return action available.

The stereo film uses the shared AudioContext, without broadcasting it through
LiveKit. Lobby music fades down while listening; voice controls are unchanged.
No video sound is sent to bystanders. Server validation is for interaction and
avatar state, not DRM: the video asset remains publicly accessible.

Headphones, foam, cable and mounting are white, with different surface roughness.
They use procedural geometry with a seeded foam bump texture. Three meshes
and their geometry/materials are shared between remote visitors. The wall has a
hook, cable and audio socket. No external model, texture or animation loop added.

Validation: TypeScript client/server, production build, server gallery tests,
the full two-browser gallery walk, and a focused desktop/touch listening test.
Tests cover real audio output levels, silent bystanders, simultaneous listeners,
remote headset visibility, proximity enforcement and automatic removal.
Mobile checks use Chrome touch emulation, not a physical Safari device.

This is a local prototype for Kenosis only. Adding other works will require
explicit artwork identifiers and per-work listening state. Publishing requires
both frontend and backend updates because the visitor schema has a new flag.

## Interaction confirmation

Pickup reach uses horizontal distance on the lower floor, so crouching does not
disagree with the server's canonical eye height. Before taking headphones or
sitting, movement stops and the client waits for the server to acknowledge that
input. It then restores the confirmed position before requesting the action.
No arbitrary client coordinates are accepted by the server.

Headphone requests carry an ID and receive an explicit acceptance or rejection.
Retries reuse the same ID; authoritative state can also confirm success if the
direct reply is lost. Disconnects and bounded timeouts terminate the pending UI.
The browser regression includes 300ms round-trip latency, a lost reply and a
deliberately incorrect camera position followed by automatic correction.
