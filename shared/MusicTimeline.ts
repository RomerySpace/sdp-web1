export interface MusicTrack { id: string; title: string; artist: string; url: string; duration: number }
// A fixed broadcast epoch means both rooms (and multiple server processes) share a programme.
export const MUSIC_EPOCH = Date.UTC(2026, 0, 1);
export function musicPosition(tracks: readonly MusicTrack[], now: number) {
  const total = tracks.reduce((sum, track) => sum + track.duration, 0);
  if (!tracks.length || !Number.isFinite(total) || total <= 0) return undefined;
  let offset = (((now - MUSIC_EPOCH) / 1000) % total + total) % total;
  for (const track of tracks) { if (offset < track.duration) return { track, offset }; offset -= track.duration; }
  return { track: tracks[0], offset: 0 };
}
export function validMusicTracks(raw: unknown): MusicTrack[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.filter((v): v is MusicTrack => Boolean(v && typeof v === 'object' &&
    ['id', 'title', 'artist', 'url'].every(key => typeof v[key] === 'string' && v[key].trim()) &&
    Number.isFinite(v.duration) && v.duration > 0 &&
    (/^https:\/\//.test(v.url) || /^\/(?!\/)/.test(v.url)))).filter(track => { if (ids.has(track.id)) return false; ids.add(track.id); return true; });
}
