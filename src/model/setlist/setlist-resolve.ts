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

function compareStr(valA?: string, valB?: string, isDesc?: boolean): number {
  const strA = String(valA || '').trim();
  const strB = String(valB || '').trim();
  const cmp = strA.localeCompare(strB, undefined, { sensitivity: 'base', numeric: true });
  return isDesc ? -cmp : cmp;
}

export function sortSetlistItems<T extends { title?: string; artist?: string; order?: number }>(
  items: T[],
  sortOption?: string,
): T[] {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const opt = (sortOption || '').trim().toLowerCase();

  const isDesc = opt.endsWith(':desc') || opt.endsWith('_desc') || opt.endsWith('-desc');
  const field = opt.replace(/[:_-]desc$/, '').replace(/[:_-]asc$/, '');

  return items.slice().sort((a, b) => {
    if (field === 'title') {
      const cmp = compareStr(a.title, b.title, isDesc);
      return cmp !== 0 ? cmp : Number(a.order ?? 0) - Number(b.order ?? 0);
    }
    if (field === 'artist') {
      const cmp = compareStr(a.artist, b.artist, isDesc);
      return cmp !== 0 ? cmp : compareStr(a.title, b.title, false);
    }
    if (field === 'order' && isDesc) {
      return Number(b.order ?? 0) - Number(a.order ?? 0);
    }
    return Number(a.order ?? 0) - Number(b.order ?? 0);
  });
}

export function resolveSetlistDoc<T extends { items?: SetlistItemLean[] }>(doc: T, sortOption?: string): T {
  if (!doc || !Array.isArray(doc.items)) return doc;
  const resolvedItems = doc.items.map(resolveSetlistItem);
  const sortedItems = sortSetlistItems(resolvedItems, sortOption);
  return { ...doc, items: sortedItems };
}

export default {
  toSetlistPlayerLink, resolveSetlistItem, resolveSetlistDoc, sortSetlistItems,
};
