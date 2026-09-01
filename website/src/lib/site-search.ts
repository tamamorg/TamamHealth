/**
 * Site search — the index behind the header's search panel.
 *
 * The panel used to be a text field that did nothing (no state, no submit) and
 * seven hard-coded chips. Typing "DHIS2" and pressing Enter went nowhere,
 * because nothing read the field.
 *
 * The index is derived from site-data wherever site-data already holds the
 * content — products, challenges, stories, the six levels of care, the footer's
 * link columns — so a new product or story is searchable the moment it is added
 * there. Only the pages and in-page sections that exist nowhere else as data
 * are written out by hand below.
 *
 * Everything here is a few dozen short strings; the search runs client-side on
 * every keystroke and needs no request, which is what makes it work in the same
 * conditions the product is built for.
 */

import {
  ADVISORS,
  CARE_LEVELS,
  CHALLENGES,
  FOOTER_COLS,
  NEWS,
  PRODUCTS,
  TEAM,
} from "./site-data";

export type SearchKind = "Page" | "Section" | "Product" | "Challenge" | "Story";

export interface SearchEntry {
  title: string;
  kind: SearchKind;
  href: string;
  /** One line under the title in the results list. */
  summary: string;
  /** Matched but never shown — synonyms, acronyms, place names. */
  keywords?: string;
}

/* The routes themselves. A reader who types "donate" or "terms" is looking for
   the page, not a paragraph inside it. */
const PAGES: SearchEntry[] = [
  {
    title: "Home",
    kind: "Page",
    href: "/",
    summary: "Transforming fragmented records into connected care.",
    keywords: "tamam tamamhealth start front page overview",
  },
  {
    title: "The platform",
    kind: "Page",
    href: "/platform",
    summary: "One offline-first record behind every product, from the front desk to the national report.",
    keywords: "technology architecture sync offline record how it works",
  },
  {
    title: "Products",
    kind: "Page",
    href: "/products",
    summary: "Six systems: HMIS, CMS, LIS, RIS, PMS and the patient portal.",
    keywords: "catalogue modules software systems",
  },
  {
    title: "The health system",
    kind: "Page",
    href: "/health-system",
    summary: "South Sudan's six levels of care, the 2025 EHSP, and the conditions the platform is built for.",
    keywords: "ministry of health national alignment ehsp levels country",
  },
  {
    title: "About Tamam",
    kind: "Page",
    href: "/about",
    summary: "Founded at Tufts University, starting in South Sudan: the crisis, the goal and the team.",
    keywords: "who we are mission story founders tufts",
  },
  {
    title: "News & updates",
    kind: "Page",
    href: "/news",
    summary: "What the venture has done lately, in full rather than as a headline.",
    keywords: "press blog announcements stories",
  },
  {
    title: "Goal",
    kind: "Page",
    href: "/donate",
    summary: "Fund the pilot: $100,000 to launch across 10 clinics in South Sudan.",
    keywords: "donate give funding support contribute pilot money goal target",
  },
  {
    title: "Get in touch",
    kind: "Page",
    href: "/contact",
    summary: "Facility, NGO, funder or partner: tell us what you are building.",
    keywords: "contact email phone partner demo enquiry inquiry",
  },
  {
    title: "Terms & privacy",
    kind: "Page",
    href: "/terms",
    summary: "How patient data is held, who may see it, and what leaves a facility.",
    keywords: "legal policy data protection consent privacy",
  },
];

/* In-page sections worth landing on directly. Each href's anchor exists in the
   page it names — a section entry whose id has been renamed sends the reader to
   the top of the page instead, which reads exactly like search being broken. */
const SECTIONS: SearchEntry[] = [
  {
    title: "DHIS2 reporting",
    kind: "Section",
    href: "/platform#how-it-works",
    summary: "Every visit tallies as it happens, so the monthly national report is generated rather than assembled.",
    keywords: "dhis2 dhis 2 idsr hmis reporting ministry national report export surveillance month end",
  },
  {
    title: "Works with no power and no signal",
    kind: "Section",
    href: "/platform#offline",
    summary: "The record is written locally and syncs when a connection returns.",
    keywords: "offline first power cut electricity internet connectivity sync outage",
  },
  {
    title: "The reality we build for",
    kind: "Section",
    href: "/health-system#reality",
    summary: "4% of facilities have an internet-connected computer; 13% have power on site.",
    keywords: "statistics conditions infrastructure evidence data",
  },
  {
    title: "The Ministry's own diagnosis",
    kind: "Section",
    href: "/health-system#diagnosis",
    summary: "Parallel, disconnected systems: named as a gap by the Ministry of Health.",
    keywords: "ehsp policy government fragmentation",
  },
  {
    title: "Six levels of care",
    kind: "Section",
    href: "/health-system#levels",
    summary: "From the Boma health worker to the national referral hospital, and what Tamam runs at each.",
    keywords: `tiers structure ${CARE_LEVELS.map((l) => `${l.level} ${l.role}`).join(" ")}`,
  },
  {
    title: "The eight failures",
    kind: "Section",
    href: "/health-system#challenges",
    summary: "What actually goes wrong inside a facility, failure by failure.",
    keywords: "challenges problems ground truth what breaks",
  },
  {
    title: "Deployment footprint",
    kind: "Section",
    href: "/#footprint",
    summary: "Pilot and planned sites across South Sudan.",
    keywords: "map clinics sites juba coverage where locations pilot",
  },
  {
    title: "The team",
    kind: "Section",
    href: "/about#team",
    summary: "Who is building this.",
    keywords: `founders people staff ${TEAM.map((m) => `${m.name} ${m.role}`).join(" ")}`,
  },
  {
    title: "Our leadership",
    kind: "Section",
    href: "/about#leadership",
    summary: "The advisors to TamamHealth.",
    keywords: `advisors board leadership ${ADVISORS.map((a) => `${a.name} ${a.role} ${a.institutions.join(" ")}`).join(" ")}`,
  },
  {
    title: "The crisis",
    kind: "Section",
    href: "/about#crisis",
    summary: "Why this venture exists.",
    keywords: "origin story kakuma problem background",
  },
];

/** Sign-in doors live on the platform, not this site, so they are absolute
    URLs — the results list opens them the same way the header's portal menu
    does rather than pushing them through the router. */
const isExternal = (href: string) => /^https?:\/\//.test(href) || href.startsWith("mailto:");

function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [
    ...PAGES,
    ...SECTIONS,

    ...PRODUCTS.map((p): SearchEntry => ({
      title: `${p.acronym}: ${p.title}`,
      kind: "Product",
      href: `/products/${p.slug}`,
      summary: p.tagline,
      keywords: `${p.acronym} ${p.title} ${p.description} ${p.modules.join(" ")}`,
    })),

    ...CHALLENGES.map((c): SearchEntry => ({
      title: c.title,
      kind: "Challenge",
      href: `/challenges/${c.slug}`,
      summary: c.short,
      // `cost` and `fix` carry the words a reader actually searches for
      // ("stock-out", "referral", "month end") — matched, not shown.
      keywords: `${c.body} ${c.cost} ${c.fix} ${c.products.join(" ")}`,
    })),

    ...NEWS.map((n): SearchEntry => ({
      title: n.title,
      kind: "Story",
      href: `/news/${n.slug}`,
      summary: n.summary,
      keywords: `${n.tag} ${n.date} ${n.body.join(" ").slice(0, 900)}`,
    })),

    // The footer's link columns are already the site's own map of itself.
    // Anything there that is not indexed above joins as a section.
    ...FOOTER_COLS.flatMap((col) =>
      col.links
        .filter((l) => !l.external)
        .map((l): SearchEntry => ({
          title: l.label,
          kind: "Section",
          href: l.href,
          summary: col.title,
        })),
    ),
  ];

  // First entry for a URL wins: the hand-written summaries above beat the
  // footer's bare label for the same destination.
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.href) ? false : (seen.add(e.href), true)));
}

export const SEARCH_INDEX: SearchEntry[] = buildIndex();

/** Lower-case, strip accents and punctuation, keep digits (so "dhis2" survives)
    and Arabic letters (so the Juba Arabic locale searches too). */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

/** Word-start match, which is what makes "rep" find "reporting" but not
    "misreported". */
const startsWord = (haystack: string, token: string) =>
  haystack === token || haystack.startsWith(`${token} `) || haystack.includes(` ${token}`);

function scoreEntry(entry: SearchEntry, tokens: string[], translate?: (text: string) => string): number {
  // Match the English source AND the reader's own language: the site ships a
  // Juba Arabic locale, and someone reading it types what they can see.
  const title = normalise(translate ? `${entry.title} ${translate(entry.title)}` : entry.title);
  const summary = normalise(translate ? `${entry.summary} ${translate(entry.summary)}` : entry.summary);
  const keywords = normalise(entry.keywords ?? "");

  let score = 0;
  for (const token of tokens) {
    let best = 0;
    if (title === token) best = 26;
    else if (startsWord(title, token)) best = 18;
    else if (title.includes(token)) best = 12;
    else if (startsWord(summary, token)) best = 7;
    else if (summary.includes(token)) best = 5;
    else if (startsWord(keywords, token)) best = 4;
    else if (keywords.includes(token)) best = 2;
    // Every token has to land somewhere, or the entry is not a result:
    // "lab results" must not match every page that says "results".
    if (best === 0) return 0;
    score += best;
  }

  // The whole query as typed, in order, at the front of the title.
  const phrase = tokens.join(" ");
  if (title.startsWith(phrase)) score += 14;
  else if (title.includes(phrase)) score += 6;

  // A page beats a paragraph when both match equally well.
  if (entry.kind === "Page") score += 2;

  return score;
}

export interface SearchHit extends SearchEntry {
  external: boolean;
}

/**
 * Ranked matches for what has been typed, best first.
 *
 * `translate` is the header's `t` — passing it lets a reader search in the
 * language they are reading. Returns [] for an empty or single-character
 * query, so the panel keeps showing its suggestions until the query means
 * something.
 */
export function searchSite(
  query: string,
  translate?: (text: string) => string,
  limit = 8,
): SearchHit[] {
  const tokens = normalise(query).split(" ").filter(Boolean);
  if (!tokens.length || normalise(query).length < 2) return [];

  return SEARCH_INDEX
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, translate) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      a.entry.title.length - b.entry.title.length ||
      a.entry.title.localeCompare(b.entry.title))
    .slice(0, limit)
    .map((r) => ({ ...r.entry, external: isExternal(r.entry.href) }));
}
