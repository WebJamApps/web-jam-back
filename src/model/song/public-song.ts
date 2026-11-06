// This is the public contract. New database fields stay private unless explicitly
// added here. Keep the legacy music-page shape during the frontend rollout.
export const PUBLIC_SONG_FIELDS = [
  '_id', 'title', 'artist', 'composer', 'category', 'album', 'year', 'url', 'image', 'orderBy',
] as const;

export function publicSong(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_SONG_FIELDS
    .filter((field) => doc[field] !== undefined)
    .map((field) => [field, doc[field]]));
}
