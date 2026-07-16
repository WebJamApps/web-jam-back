// src/lib/caption-text.ts — web-jam-back#962
//
// Converts a TinyMCE-authored gig-announce caption (rich HTML) into the plain
// text the Instagram Content Publishing API and Facebook Pages API both
// require (neither accepts HTML in a caption/message field). Keeps
// paragraph/line breaks, flattens `<a href>` links down to their raw URL
// (both surfaces auto-linkify a bare URL, so the link text isn't needed), and
// drops all styling tags outright.
//
// Reuses decodeHtmlEntities from gig-venue-link.ts (web-jam-back#964) rather
// than duplicating it — same TinyMCE-entity-decoding need (`&amp;`, `&#39;`,
// etc.), now shared by both the venue-name matcher and this caption converter.
import { decodeHtmlEntities } from './gig-venue-link.js';

// Anchors are flattened to their raw href, discarding the link text entirely.
// The lazy `[\s\S]*?` is bounded by the literal closing tag (no nested
// quantifiers), so it's linear despite the generic slow-regex lint warning;
// TinyMCE never emits nested anchors.
// eslint-disable-next-line sonarjs/slow-regex
const ANCHOR_RE = /<a\b[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi;

// <br> in any written form -> a single newline.
const BR_RE = /<br\s*\/?>/gi;

// Closing block-level tags -> a paragraph break (two newlines). The matching
// opening tags (and every remaining inline/styling tag) are stripped
// generically by REMAINING_TAG_RE below.
const BLOCK_CLOSE_RE = /<\/(p|div|li|h[1-6]|blockquote)>/gi;

// Everything left (opening block tags, <strong>/<em>/<span>/etc.) is dropped
// outright. Negated-class quantifier — linear, no nested quantifiers, safe
// from catastrophic backtracking despite the generic slow-regex lint warning.
// eslint-disable-next-line sonarjs/slow-regex
const REMAINING_TAG_RE = /<[^>]*>/g;

export function htmlCaptionToText(html: string): string {
  const withLinks = (html || '').replace(ANCHOR_RE, (_m, href: string) => href);
  const withBreaks = withLinks.replace(BR_RE, '\n').replace(BLOCK_CLOSE_RE, '\n\n');
  const stripped = withBreaks.replace(REMAINING_TAG_RE, '');
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
