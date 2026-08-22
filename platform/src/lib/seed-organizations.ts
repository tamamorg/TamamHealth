/**
 * The organizations every installation starts with.
 *
 * Lives in its own module — deliberately free of any PouchDB import — because
 * two very different callers need the same definitions and only one of them
 * runs in a browser:
 *
 *   - `db-seed.ts` writes them into the browser's local replica;
 *   - `scripts/seed-organizations.mjs` writes them into CouchDB in Node, where
 *     importing `db.ts` (pouchdb-browser) would blow up on `self`.
 *
 * Keeping one definition matters more here than it looks. The organizations
 * database is server-writes-only, so a browser-seeded installation can end up
 * with no organization documents on the server at all, and every server-side
 * check against an organization then fails closed — the symptom being that an
 * organization admin cannot create a single staff account. The recovery script
 * has to write the SAME tenants the app already believes in; a second copy of
 * these ids would quietly provision the wrong ones.
 */
import type { OrganizationDoc } from './db-types';
import { BRAND_PRIMARY, BRAND_SECONDARY } from './theme-colors';

export const PUBLIC_ORG_ID = 'org-moh-ss';
export const PRIVATE_ORG_ID = 'org-mercy-hospital';

export const DEFAULT_ORGANIZATIONS: Omit<OrganizationDoc, '_rev'>[] = [
  {
    _id: PUBLIC_ORG_ID,
    type: 'organization',
    name: 'Republic of South Sudan',
    slug: 'moh-ss',
    primaryColor: BRAND_PRIMARY,
    secondaryColor: BRAND_SECONDARY,
    accentColor: BRAND_PRIMARY,
    subscriptionStatus: 'active',
    subscriptionPlan: 'enterprise',
    maxUsers: 1000,
    maxHospitals: 200,
    featureFlags: { epidemicIntelligence: true, mchAnalytics: true, dhis2Export: true, communityHealth: true, facilityAssessments: true },
    orgType: 'public',
    contactEmail: 'support.tamam@gmail.com',
    country: 'South Sudan',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    _id: PRIVATE_ORG_ID,
    type: 'organization',
    name: 'Mercy Hospital Group',
    slug: 'mercy-hospital',
    // Default brand palette — orgs only carry a custom color when an admin
    // deliberately rebrands (see branding.ts, which also rejects non-hex
    // values so buttons never lose the default action blue).
    primaryColor: BRAND_PRIMARY,
    secondaryColor: BRAND_SECONDARY,
    accentColor: BRAND_PRIMARY,
    subscriptionStatus: 'active',
    subscriptionPlan: 'professional',
    maxUsers: 50,
    maxHospitals: 5,
    featureFlags: { epidemicIntelligence: false, mchAnalytics: true, dhis2Export: false, communityHealth: false, facilityAssessments: false },
    orgType: 'private',
    contactEmail: 'support.tamam@gmail.com',
    country: 'South Sudan',
    isActive: true,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
];
