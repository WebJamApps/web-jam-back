import {
  toSetlistPlayerLink, resolveSetlistItem, resolveSetlistDoc,
} from '#src/model/setlist/setlist-resolve.js';

describe('setlist-resolve', () => {
  describe('toSetlistPlayerLink', () => {
    it('returns undefined for an empty/undefined url', () => {
      expect(toSetlistPlayerLink(undefined)).toBeUndefined();
      expect(toSetlistPlayerLink('')).toBeUndefined();
    });

    it('converts a Dropbox widget link (dl=1) to the player form (dl=0), preserving rlkey', () => {
      const widget = 'https://dl.dropboxusercontent.com/s/abc123/song.mp3?rlkey=xyz789&dl=1';
      const player = toSetlistPlayerLink(widget);
      expect(player).toBe('https://www.dropbox.com/s/abc123/song.mp3?rlkey=xyz789&dl=0');
    });

    it('converts a Dropbox widget link with no dl param, leaving other params alone', () => {
      const widget = 'https://dl.dropboxusercontent.com/s/abc123/song.mp3';
      const player = toSetlistPlayerLink(widget);
      expect(player).toBe('https://www.dropbox.com/s/abc123/song.mp3');
    });

    it('converts a YouTube embed link to the watch form', () => {
      const embed = 'https://www.youtube.com/embed/ach2ubW21h4?enablejsapi=1&origin=https://web-jam.com';
      expect(toSetlistPlayerLink(embed)).toBe('https://www.youtube.com/watch?v=ach2ubW21h4');
    });

    it('leaves a Spotify link unchanged', () => {
      const spotify = 'https://open.spotify.com/track/abc123';
      expect(toSetlistPlayerLink(spotify)).toBe(spotify);
    });

    it('leaves an already-normal YouTube watch link unchanged', () => {
      const watch = 'https://www.youtube.com/watch?v=abc123';
      expect(toSetlistPlayerLink(watch)).toBe(watch);
    });

    it('returns the original string unchanged when it is not a parseable URL', () => {
      expect(toSetlistPlayerLink('not a url')).toBe('not a url');
    });
  });

  describe('resolveSetlistItem', () => {
    it('resolves title/artist/playLink from a populated Song, converting the url', () => {
      const item = resolveSetlistItem({
        _id: 'item1',
        order: 1,
        notes: 'capo 2',
        songId: {
          _id: 'song1',
          title: 'Wagon Wheel',
          artist: 'Old Crow Medicine Show',
          url: 'https://www.youtube.com/embed/xyz?enablejsapi=1',
        },
      });
      expect(item).toEqual({
        _id: 'item1',
        order: 1,
        songId: 'song1',
        notes: 'capo 2',
        title: 'Wagon Wheel',
        artist: 'Old Crow Medicine Show',
        playLink: 'https://www.youtube.com/watch?v=xyz',
      });
    });

    it('uses the inline title/artist/playLink for an uncatalogued cover (no songId)', () => {
      const item = resolveSetlistItem({
        order: 2,
        title: 'Folsom Prison Blues',
        artist: 'Johnny Cash',
        playLink: 'https://youtu.be/abc',
      });
      expect(item.songId).toBeUndefined();
      expect(item.title).toBe('Folsom Prison Blues');
      expect(item.artist).toBe('Johnny Cash');
      expect(item.playLink).toBe('https://youtu.be/abc');
    });

    it('falls back to the raw songId when the reference did not populate (dangling ref)', () => {
      const item = resolveSetlistItem({ order: 3, songId: null });
      expect(item.songId).toBeUndefined();
      expect(item.title).toBeUndefined();
    });
  });

  describe('resolveSetlistDoc', () => {
    it('resolves every item in a mixed setlist (referenced + inline)', () => {
      const doc = resolveSetlistDoc({
        name: 'Gig Set',
        items: [
          {
            order: 1,
            songId: { _id: 's1', title: 'Ref Song', artist: 'Ref Artist', url: 'https://open.spotify.com/track/x' },
          },
          { order: 2, title: 'Inline Cover', artist: 'Cover Artist', playLink: 'https://youtu.be/inline' },
        ],
      });
      expect(doc.items).toHaveLength(2);
      expect(doc.items[0].title).toBe('Ref Song');
      expect(doc.items[0].playLink).toBe('https://open.spotify.com/track/x');
      expect(doc.items[1].title).toBe('Inline Cover');
    });

    it('passes through a doc with no items array unchanged', () => {
      const doc = { name: 'Empty' } as { name: string; items?: unknown[] };
      expect(resolveSetlistDoc(doc)).toBe(doc);
    });

    it('passes through a null/undefined doc unchanged', () => {
      expect(resolveSetlistDoc(null as unknown as { items?: unknown[] })).toBeNull();
    });
  });
});
