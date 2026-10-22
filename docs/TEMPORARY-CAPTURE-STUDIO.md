# Temporary capture studio

Black room centred at (-20, 10), near the initial spawn at (0, 9).
From the first spawn facing the monolith, turn left. Enter through the east
doorway at (-12, 10), pass around the black light baffle and face the west wall.
Use the existing H shortcut to hide the lobby HUD for screenshots.

Three floating point/contour clouds reuse the already loaded holographic assets
and their shader. Local geometry copies scatter the particles into abstract
volumes so no photograph remains recognizable; original graphics are untouched.
No image panels, video, extra asset download, renderer or
animation loop is created. The studio materials bypass lighting and fog so
the enclosure stays black and the particles remain visible. Grass is masked
inside; rain is hidden while viewing from inside. Server and client share walls.

To retire this experiment, set `temporaryCaptureStudio.enabled` to false in
`shared/TemporaryCaptureStudio.ts`. This disables the room, grass mask, exclusion
zone and collisions together. Remove its two files, SceneManager hooks and
capture-studio tests later if a full cleanup is wanted.
