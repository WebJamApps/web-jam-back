import {
  toSetlistPlayerLink, resolveSetlistItem, resolveSetlistDoc, sortSetlistItems, type SetlistItemLean,
} from '#src/model/setlist/setlist-resolve.js';

describe('setlist-resolve', () => {
  describe('toSetlistPlayerLink', () => {
    it('returns undefined for an empty/undefined url', () => {
      expect(toSetlistPlayerLink(undefined)).toBeUndefined();
      expect(toSetlistPlayerLink('')).toBeUndefined();
    });

    it('converts a Dropbox widget link (dl=1) to the player form (dl=0), preserving rlkey', () => {
      const widget = 'https://dl.dropboxusercontent.com/scl/fi/abc/take1.mp3?rlkey=k&dl=1';
      const player = toSetlistPlayerLink(widget);
      expect(player).toBe('https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=0');
    });

    it('converts a www.dropbox.com link ending dl=1 to dl=0, preserving rlkey', () => {
      const share = 'https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=1';
      expect(toSetlistPlayerLink(share)).toBe('https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=0');
    });

    it('leaves a www.dropbox.com link ending dl=0 unchanged', () => {
      const player = 'https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=0';
      expect(toSetlistPlayerLink(player)).toBe(player);
    });

    it('converts a Dropbox widget link with no dl param, leaving other params alone', () => {
      const widget = 'https://dl.dropboxusercontent.com/s/abc123/song.mp3';
      const player = toSetlistPlayerLink(widget);
      expect(player).toBe('https://www.dropbox.com/s/abc123/song.mp3');
    });

    it('converts a YouTube embed link to the watch form', () => {
      expect(toSetlistPlayerLink('https://www.youtube.com/embed/xyz')).toBe('https://www.youtube.com/watch?v=xyz');
      const embed = 'https://www.youtube.com/embed/ach2ubW21h4?enablejsapi=1&origin=https://web-jam.com';
      expect(toSetlistPlayerLink(embed)).toBe('https://www.youtube.com/watch?v=ach2ubW21h4');
    });

    it('leaves a Spotify link unchanged', () => {
      const spotify = 'https://open.spotify.com/track/xyz';
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

    it('preserves key, capo, tempo, durationSeconds, and converts Dropbox links on catalog song url, inline playLink, and leadSheetUrl', () => {
      const catalogResolved = resolveSetlistItem({
        _id: 'item-cat',
        order: 1,
        key: 'G',
        capo: '2',
        tempo: '120',
        durationSeconds: 215,
        leadSheetUrl: 'https://www.dropbox.com/scl/fi/sheet1/lead.pdf?rlkey=s1&dl=1',
        songId: {
          _id: 'song-cat',
          title: 'Catalog Song',
          artist: 'Josh & Maria',
          url: 'https://dl.dropboxusercontent.com/scl/fi/abc/take1.mp3?rlkey=k&dl=1',
        },
      });
      expect(catalogResolved).toEqual({
        _id: 'item-cat',
        order: 1,
        songId: 'song-cat',
        notes: undefined,
        title: 'Catalog Song',
        artist: 'Josh & Maria',
        playLink: 'https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=0',
        key: 'G',
        capo: '2',
        tempo: '120',
        durationSeconds: 215,
        leadSheetUrl: 'https://www.dropbox.com/scl/fi/sheet1/lead.pdf?rlkey=s1&dl=0',
      });

      const inlineResolved = resolveSetlistItem({
        _id: 'item-inline',
        order: 2,
        title: 'Inline Song',
        artist: 'Guest Artist',
        playLink: 'https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=1',
        key: 'Am',
        capo: '3',
        tempo: '98',
        durationSeconds: 180,
        leadSheetUrl: 'https://dl.dropboxusercontent.com/scl/fi/sheet2/lead.docx?rlkey=s2&dl=1',
      });
      expect(inlineResolved).toEqual({
        _id: 'item-inline',
        order: 2,
        songId: undefined,
        notes: undefined,
        title: 'Inline Song',
        artist: 'Guest Artist',
        playLink: 'https://www.dropbox.com/scl/fi/abc/take1.mp3?rlkey=k&dl=0',
        key: 'Am',
        capo: '3',
        tempo: '98',
        durationSeconds: 180,
        leadSheetUrl: 'https://www.dropbox.com/scl/fi/sheet2/lead.docx?rlkey=s2&dl=0',
      });
    });
  });

  describe('sortSetlistItems', () => {
    const items = [
      { order: 1, title: 'Wagon Wheel', artist: 'Old Crow Medicine Show' },
      { order: 2, title: 'Folsom Prison Blues', artist: 'Johnny Cash' },
      { order: 3, title: 'Amie', artist: 'Pure Prairie League' },
    ];

    it('defaults to stored order ascending', () => {
      const sorted = sortSetlistItems(items);
      expect(sorted.map((i) => i.title)).toEqual(['Wagon Wheel', 'Folsom Prison Blues', 'Amie']);
    });

    it('sorts by title A-Z for sort=title', () => {
      const sorted = sortSetlistItems(items, 'title');
      expect(sorted.map((i) => i.title)).toEqual(['Amie', 'Folsom Prison Blues', 'Wagon Wheel']);
    });

    it('sorts by title Z-A for sort=title:desc', () => {
      const sorted = sortSetlistItems(items, 'title:desc');
      expect(sorted.map((i) => i.title)).toEqual(['Wagon Wheel', 'Folsom Prison Blues', 'Amie']);
    });

    it('sorts by artist A-Z for sort=artist', () => {
      const sorted = sortSetlistItems(items, 'artist');
      expect(sorted.map((i) => i.artist)).toEqual(['Johnny Cash', 'Old Crow Medicine Show', 'Pure Prairie League']);
    });

    it('sorts by artist Z-A for sort=artist:desc', () => {
      const sorted = sortSetlistItems(items, 'artist:desc');
      expect(sorted.map((i) => i.artist)).toEqual(['Pure Prairie League', 'Old Crow Medicine Show', 'Johnny Cash']);
    });

    it('sorts by order descending for sort=order:desc', () => {
      const sorted = sortSetlistItems(items, 'order:desc');
      expect(sorted.map((i) => i.order)).toEqual([3, 2, 1]);
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

    it('sorts resolved items when sortOption is provided', () => {
      const doc = resolveSetlistDoc({
        name: 'Sorted Set',
        items: [
          { order: 1, title: 'Zebra' },
          { order: 2, title: 'Apple' },
        ],
      }, 'title');
      expect(doc.items[0].title).toBe('Apple');
      expect(doc.items[1].title).toBe('Zebra');
    });

    it('passes through a doc with no items array unchanged', () => {
      const doc = { name: 'Empty' } as { name: string; items?: SetlistItemLean[] };
      expect(resolveSetlistDoc(doc)).toBe(doc);
    });

    it('passes through a null/undefined doc unchanged', () => {
      expect(resolveSetlistDoc(null as unknown as { items?: SetlistItemLean[] })).toBeNull();
    });
  });
});
