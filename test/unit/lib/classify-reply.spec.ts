import { buildPrompt, parseSuggestion, classifyReply } from '#src/lib/classify-reply.js';

describe('classify-reply', () => {
  describe('buildPrompt', () => {
    it('names the venue and asks for JSON-only with the expected keys', () => {
      const p = buildPrompt('We are interested!', 'The Bridge');
      expect(p).toContain('The Bridge');
      expect(p).toContain('ONLY a JSON object');
      expect(p).toContain('"sentiment"');
      expect(p).toContain('"proposedBookingStatus"');
      expect(p).toContain('We are interested!');
    });
    it('falls back to a generic name and truncates a huge reply', () => {
      const p = buildPrompt('x'.repeat(5000), '');
      expect(p).toContain('the venue');
      expect(p).not.toContain('x'.repeat(4001)); // body capped at 4000
    });
  });

  describe('parseSuggestion', () => {
    it('parses a full valid suggestion', () => {
      const raw = 'Here you go: {"sentiment":"positive","proposedBookingStatus":"booking","proposedInterested":true,"rationale":"They said yes"}';
      expect(parseSuggestion(raw)).toEqual({
        sentiment: 'positive', proposedBookingStatus: 'booking', proposedInterested: true, rationale: 'They said yes',
      });
    });
    it('drops fields whose values are not recognized enums', () => {
      const raw = '{"sentiment":"meh","proposedBookingStatus":"maybe","proposedInterested":true}';
      expect(parseSuggestion(raw)).toEqual({ proposedInterested: true });
    });
    it('returns null when no JSON object is present', () => {
      expect(parseSuggestion('no json here')).toBeNull();
    });
    it('returns null on malformed JSON', () => {
      expect(parseSuggestion('{ not valid json ')).toBeNull();
    });
    it('returns null when nothing recognizable was produced', () => {
      expect(parseSuggestion('{"rationale":"hmm","foo":"bar"}')).toBeNull();
    });
  });

  describe('classifyReply', () => {
    it('returns null under test (no API call)', async () => {
      await expect(classifyReply('We are interested', 'The Bridge')).resolves.toBeNull();
    });
  });
});
