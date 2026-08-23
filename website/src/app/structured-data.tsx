/**
 * What a search engine is told about this site, in the vocabulary it reads.
 *
 * The page metadata (title, description, canonical, Open Graph) already says
 * what each PAGE is. None of it says what the ORGANISATION is, and that is the
 * half a search engine uses to decide that "tamamhealth", "Tamam Health" and
 * "TamamHealth South Sudan" are one entity, to draw a knowledge panel, and to
 * offer a search box under the result. Without it a two-month-old domain with
 * a name that collides with several unrelated ones — Tamam Medical, Tamam Life,
 * Tamale Teaching Hospital — has nothing to disambiguate itself with.
 *
 * JSON-LD rather than microdata: it sits in one script tag instead of being
 * threaded through the markup, so the copy on the page and the claims made
 * about it can be edited independently.
 */

const BASE = 'https://tamamhealth.org';

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${BASE}/#organization`,
  name: 'TamamHealth',
  alternateName: ['Tamam Health', 'Tamam'],
  url: BASE,
  logo: `${BASE}/assets/tamam-favicon.svg`,
  email: 'support.tamam@gmail.com',
  description:
    "Offline-first electronic health records for South Sudan. TamamHealth replaces paper-based clinical records that get lost, damaged or destroyed with digital records that keep working without power or connectivity.",
  foundingLocation: {
    '@type': 'Place',
    name: 'Tufts University, Medford, Massachusetts, United States',
  },
  areaServed: [
    { '@type': 'Country', name: 'South Sudan' },
    { '@type': 'Place', name: 'Sub-Saharan Africa' },
  ],
  knowsAbout: [
    'Electronic health records',
    'Health management information systems',
    'Offline-first software',
    'Global health informatics',
  ],
};

const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${BASE}/#website`,
  url: BASE,
  name: 'TamamHealth',
  inLanguage: ['en', 'apd'],
  publisher: { '@id': `${BASE}/#organization` },
};

/** The product itself, so a search for what it DOES can match it. */
const SOFTWARE = {
  '@type': 'SoftwareApplication',
  '@id': `${BASE}/#platform`,
  name: 'TamamHealth Platform',
  applicationCategory: 'HealthApplication',
  operatingSystem: 'Web browser, Android',
  url: `${BASE}/platform`,
  publisher: { '@id': `${BASE}/#organization` },
  featureList: [
    'Offline-first patient records',
    'Hospital management (HMIS)',
    'Laboratory and pharmacy workflows',
    'Maternal and child health reporting',
    'Disease surveillance and DHIS2 export',
  ],
};

const GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [ORGANIZATION, WEBSITE, SOFTWARE],
};

export default function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // The value is a constant defined above, never user input — there is no
      // string here that a visitor can influence.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(GRAPH) }}
    />
  );
}
