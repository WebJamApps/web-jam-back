export interface SalesPitchEntry {
  id: string;
  label: string;
  matches: (lowerText: string) => boolean;
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

// Each entry counts once however often it appears.
export const SALES_PITCH_ENTRIES: readonly SalesPitchEntry[] = [
  { id: 'virtual-assistant', label: 'virtual assistant', matches: (t) => t.includes('virtual assistant') },
  { id: 'seo', label: 'SEO', matches: (t) => /\bseo\b/.test(t) || t.includes('search engine optimization') },
  { id: 'lead-generation', label: 'lead generation', matches: (t) => t.includes('lead generation') },
  { id: 'marketing-services', label: 'marketing services', matches: (t) => t.includes('marketing services') },
  {
    id: 'social-media-services',
    label: 'social media services',
    matches: (t) => includesAny(t, ['social media management', 'social media marketing']),
  },
  { id: 'web-design', label: 'web design', matches: (t) => includesAny(t, ['website design', 'web design services']) },
  { id: 'link-selling', label: 'link selling', matches: (t) => includesAny(t, ['backlinks', 'guest post']) },
  { id: 'search-ranking', label: 'search ranking', matches: (t) => includesAny(t, ['first page of google', 'rank your website']) },
  { id: 'service-pitch', label: 'service pitch', matches: (t) => includesAny(t, ['we offer', 'our services']) },
  { id: 'call-to-discuss', label: 'call to discuss', matches: (t) => t.includes('open for discussion') },
  { id: 'crypto', label: 'crypto', matches: (t) => includesAny(t, ['crypto', 'bitcoin']) },
  { id: 'web-link', label: 'web link', matches: (t) => includesAny(t, ['http://', 'https://', 'www.']) },
];

export function matchedSalesPitchEntries(message: string): string[] {
  const normalized = message.toLowerCase();
  if (!normalized.trim()) return [];
  return SALES_PITCH_ENTRIES.filter((entry) => entry.matches(normalized)).map((entry) => entry.id);
}

export function isSalesPitchMessage(message: string): boolean {
  return matchedSalesPitchEntries(message).length >= 2;
}
