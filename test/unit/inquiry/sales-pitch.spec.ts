import {
  isSalesPitchMessage,
  matchedSalesPitchEntries,
  SALES_PITCH_ENTRIES,
} from '#src/model/inquiry/sales-pitch.js';

describe('SALES_PITCH_ENTRIES', () => {
  it('defines all 12 design entries in order', () => {
    expect(SALES_PITCH_ENTRIES.map((e) => e.id)).toEqual([
      'virtual-assistant',
      'seo',
      'lead-generation',
      'marketing-services',
      'social-media-services',
      'web-design',
      'link-selling',
      'search-ranking',
      'service-pitch',
      'call-to-discuss',
      'crypto',
      'web-link',
    ]);
  });

  it.each([
    ['virtual-assistant', 'Hire a virtual assistant today'],
    ['virtual-assistant', 'Trained human Virtual Assistants ready now'],
    ['seo', 'Boost your SEO rankings'],
    ['seo', 'Full Search Engine Optimization package'],
    ['lead-generation', 'Targeted B2B lead generation'],
    ['marketing-services', 'Affordable marketing services for you'],
    ['social-media-services', 'Social media management for musicians'],
    ['social-media-services', 'Expand with social media marketing'],
    ['web-design', 'Custom website design for bands'],
    ['web-design', 'Professional web design services'],
    ['link-selling', 'High authority backlinks available'],
    ['link-selling', 'Publish a guest post on music blogs'],
    ['search-ranking', 'Reach the first page of Google fast'],
    ['search-ranking', 'We can rank your website higher'],
    ['service-pitch', 'We offer affordable help for artists'],
    ['service-pitch', 'Try our services this quarter'],
    ['call-to-discuss', 'Open for discussion this week?'],
    ['crypto', 'Invest in our crypto fund'],
    ['crypto', 'Accept bitcoin payments effortlessly'],
    ['web-link', 'Visit http://spam.example for details'],
    ['web-link', 'See https://spam.example now'],
    ['web-link', 'Check out www.spam.example'],
  ])('matches entry %s on form %j (case-insensitive)', (entryId, message) => {
    expect(matchedSalesPitchEntries(message)).toEqual([entryId]);
    expect(matchedSalesPitchEntries(message.toUpperCase())).toEqual([entryId]);
  });

  it('requires whole-word match for SEO so substrings like museo do not match', () => {
    expect(matchedSalesPitchEntries('Playing at El Museo next Friday')).toEqual([]);
  });

  it('counts each entry at most once even when multiple forms of that entry appear', () => {
    const repeatedOneEntry = 'We offer great help and our services cover everything; WE OFFER more.';
    expect(matchedSalesPitchEntries(repeatedOneEntry)).toEqual(['service-pitch']);
    expect(isSalesPitchMessage(repeatedOneEntry)).toBe(false);
  });

  it('drops the design spam sample matching entries 1, 3, 9 and 10', () => {
    const spam =
      'We offer trained human Virtual Assistants supported by our custom-built AI system '
      + 'and Lead Generation outreach. Open for discussion?';
    expect(matchedSalesPitchEntries(spam)).toEqual([
      'virtual-assistant',
      'lead-generation',
      'service-pitch',
      'call-to-discuss',
    ]);
    expect(isSalesPitchMessage(spam)).toBe(true);
  });

  it('allows the design winery coordinator message matching only entry 12', () => {
    const legit =
      "I'm the marketing coordinator at a winery, here's our site www.example.com, can you play our fall festival?";
    expect(matchedSalesPitchEntries(legit)).toEqual(['web-link']);
    expect(isSalesPitchMessage(legit)).toBe(false);
  });
});
