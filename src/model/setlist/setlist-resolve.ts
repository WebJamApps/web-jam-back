// Hybrid-setlist resolution helpers (web-jam-back#937 follow-up, #946). A setlist
// item either REFERENCES a catalogued Song via songId (source of truth: no
// duplicated data stored) or carries its own inline title/artist/playLink for an
// uncatalogued cover. These pure functions turn a populated, lean setlist
// document into the uniform response shape consumers expect — no stored
// duplication, resolved at read time.

// Song.url is stored in the WEBSITE-WIDGET form (built for embedding/downloading
// on the site). A setlist wants a click-to-play PLAYER link instead, so we
// convert at resolve time rather than storing a second copy of the link.
export function toSetlistPlayerLink(url?: string): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname === 'dl.dropboxusercontent.com') {
    parsed.hostname = 'www.dropbox.com';
    if (parsed.searchParams.has('dl')) parsed.searchParams.set('dl', '0');
    return parsed.toString();
  }
  if (parsed.hostname === 'www.youtube.com' && parsed.pathname.startsWith('/embed/')) {
    const videoId = parsed.pathname.slice('/embed/'.length);
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  // Spotify or anything else — leave unchanged.
  return url;
}

interface SongLean {
  _id?: unknown;
  title?: string;
  artist?: string;
  url?: string;
}

export interface SetlistItemLean {
  _id?: unknown;
  order?: number;
  songId?: SongLean | string | null;
  title?: string;
  artist?: string;
  playLink?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface ResolvedSetlistItem {
  _id?: unknown;
  order?: number;
  songId?: unknown;
  notes?: string;
  title?: string;
  artist?: string;
  playLink?: string;
}

// A populate('items.songId') result is a Song object when the reference
// resolved; null when the ref doc no longer exists; absent entirely for a
// plain inline cover item.
function populatedSong(item: SetlistItemLean): SongLean | null {
  const { songId } = item;
  return songId && typeof songId === 'object' ? (songId as SongLean) : null;
}

export function resolveSetlistItem(item: SetlistItemLean): ResolvedSetlistItem {
  const song = populatedSong(item);
  return {
    _id: item._id,
    order: item.order,
    songId: song ? song._id : (item.songId ?? undefined),
    notes: item.notes,
    title: song ? song.title : item.title,
    artist: song ? song.artist : item.artist,
    playLink: song ? toSetlistPlayerLink(song.url) : item.playLink,
  };
}

export function resolveSetlistDoc<T extends { items?: SetlistItemLean[] }>(doc: T): T {
  if (!doc || !Array.isArray(doc.items)) return doc;
  return { ...doc, items: doc.items.map(resolveSetlistItem) };
}

export default { toSetlistPlayerLink, resolveSetlistItem, resolveSetlistDoc };
