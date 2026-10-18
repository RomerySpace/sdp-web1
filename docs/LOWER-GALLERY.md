# Lower gallery / local spatial trial

Developed and reviewed locally first. Approved for the existing public test;
frontend delivery remains on Vercel and authoritative lobby movement on Render.

## Visit

The running preview is http://localhost:5383/. From the monolith, walk to the
white stairwell centred on its east side (entrance at x=30, z=0). Descend through
the intermediate landing into the room below the monolith. The film occupies
the far wall; its small label is on the right. E uses the existing seat system.

Default startup is `npm run dev:unified` (5373/2587). To use the test ports:

```sh
SDP_WEB_PORT=5383 PORT=2597 LIVEKIT_PORT=7990 LIVEKIT_RTC_TCP_PORT=7991 LIVEKIT_RTC_UDP_PORT=7992 npm run dev:unified
```

## Spatial Model

The room is 24 x 24m, at -7.2m, with a 6.1m ceiling height. Two 18-step flights
are joined by a 1.8m landing; the stair is 7.2m wide. The upper 6.8m are
open to the sky; the remaining 11.2m have a solid roof and restored surface.
Three protected edges prevent entry from the sides or the back, including
while jumping. The opening is centred on the room. Upper ground remains
solid above the room. One scene, one renderer,
and the existing loop and controller are retained. A shared height hint keeps
both overlapping floors separate in prediction and authoritative simulation.

The room has broad 5m-radius curved corners shared by rendering and collision,
a continuous ceiling and fine perimeter light instead of a square ceiling grid.
The lower flight flares from 7.2m to 14m, removing the nested rectangular
portal into the room. Its side walls, treads, landing, sloped soffit and
authoritative corridor share that widening footprint.
The floor is continuous matte mineral material without a tile grid. The film
is 3.2m wide, leaving the wall available for future audiovisual pieces.
Three central two-place benches reuse room-owned reservations. The backend
rejects requests to sit below a player who is still upstairs. Standing and
reconnections preserve the correct ground layer. Room capacity is unchanged.

## Film

`public/gallery/kenosis.mp4` is a copy of the supplied film, not a replacement
or edit of the original. It is 1280 x 720, about 46 seconds and 54 MB. It is
requested only on descent, preserves aspect ratio and uses a Three.js video
texture. Playback loops and aligns on entry using the existing server clock;
this is not sample-accurate synchronization. No constant seeking or pitch
correction is applied.

Audio uses the existing shared AudioContext, a source on the video wall, and
the menu's Game Volume. The music above fades down in the gallery. A small
speaker button is available if a browser needs an additional audio gesture.
Leaving the gallery, hiding the page or changing mode pauses decoding and
silences the film. GPU and audio resources are disposed with the scene.

The existing proximity voice and room-wide text chat remain connected. This
trial does not add private rooms or wall-based occlusion to voice chat.
Before an online release, review media compression, delivery and permissions.

## Visual References

The user's white gallery references guide the architecture: opal ceiling,
mineral surfaces, quiet joints, low seating and a single moving-image work.
Research consulted the scenographer's own portfolio and GOLDRAUM 1, taking
its immersive material treatment as a reference, not copying its gold palette:

- https://tomschneider.info/
- https://magazine.032c.com/magazine/goldraum-1-by-hendrik-schneider-and-tom-schneider

The result is an original SDP trial, not a design by Tom Schneider.

## Validation

`npm run typecheck:all`, `npm run test:server`, `npm run build`.

`npm run test:unified -- --grep 'lower gallery:'` walks two actual browser
clients down and up, including native emulated touch movement, shared seating,
real decoded video frames and measured film audio. Screenshots cover the
entrance, landing, room, label and portrait/landscape views. It is not a
physical iPhone or two-computer validation.
