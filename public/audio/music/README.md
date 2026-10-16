# SDP music

Put MP3 tracks here. Register each track in `../playlist.json` with a unique id,
title, artist, URL (`/audio/music/filename.mp3`) and its duration in seconds.
Use the actual decoded duration to keep the shared timeline aligned.

Only the current track is requested after entry. Music follows the shared server
clock, fades in with the lobby and is spatialized above the monolith. It becomes
quieter with horizontal distance and fades out in Shooter. Menu music volume and
global mute remain independent of microphone transmission.

The test track is Steve Hauschildt - Time We Have (353.28 seconds).
Ambient audio, ground reflectance, upper-column fade and voice opacity settings
are in `src/core/LobbyAmbience.ts` (relative to the project root).

For CDN hosting, replace track URLs with HTTPS URLs that support CORS and seeking.
