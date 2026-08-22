/**
 * API: /api/account-requests/options
 * GET — public. The organisations someone can say they belong to.
 *
 * Routing needs an organisation id: without one every request lands with the
 * platform operator, and an organisation's own administrator never sees the
 * people asking to join it. So the request form has to offer a choice, and the
 * choice has to be readable without a session.
 *
 * Facilities are returned as id/name/org tuples because clinical account
 * creation requires a real facility id. No contacts, counts, subscription
 * state, or operational details cross this public boundary.
 */
import { NextResponse } from 'next/server';
import { logApiError, serverError } from '@/modules/identity';
import { hospitalsDB, organizationsDB } from '@/lib/db';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';
import { findByType } from '@/lib/services/db-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const docs = await findByType<OrganizationDoc>(organizationsDB(), 'organization');
    const organizations = docs
      .filter(o => o.isActive !== false)
      .map(o => ({ id: o._id, name: o.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const organizationIds = new Set(organizations.map(o => o.id));
    const facilities = (await findByType<HospitalDoc>(hospitalsDB(), 'hospital'))
      .filter(h => h.orgId && organizationIds.has(h.orgId))
      .map(h => ({ id: h._id, name: h.name, orgId: h.orgId as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ organizations, facilities });
  } catch (err) {
    logApiError('GET /api/account-requests/options', err);
    return serverError();
  }
}
