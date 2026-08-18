/**
 * API: /api/account-requests/options
 * GET — public. The organisations someone can say they belong to.
 *
 * Routing needs an organisation id: without one every request lands with the
 * platform operator, and an organisation's own administrator never sees the
 * people asking to join it. So the request form has to offer a choice, and the
 * choice has to be readable without a session.
 *
 * What this deliberately does NOT return: facilities, contacts, user counts,
 * subscription state, or anything about an organisation beyond its name. The
 * requester names their facility as free text and the approver assigns the
 * real one — so the granular list of a tenant's sites stays behind the
 * session gate, and the facility a new account is attached to remains an
 * administrator's decision rather than a stranger's claim.
 */
import { NextResponse } from 'next/server';
import { logApiError, serverError } from '@/lib/api-auth';
import { organizationsDB } from '@/lib/db';
import type { OrganizationDoc } from '@/lib/db-types';
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
    return NextResponse.json({ organizations });
  } catch (err) {
    logApiError('GET /api/account-requests/options', err);
    return serverError();
  }
}
