/**
 * API: /api/fee-schedule — the organization's service price catalog.
 *
 * POST { action: 'create' | 'update' | 'delete', id?, fee? }
 *
 * `tamamhealth_fee_schedule` replicates server -> device only
 * (`direction: 'pull'`, server-writes-only), so a catalog edit written to the
 * browser's own PouchDB never reaches anyone else: the admin sees it, nobody
 * else's charges use it. The edit therefore happens HERE, on the server, and
 * the result reaches devices through pull replication.
 *
 * Tenant: orgId is stamped from the session, never taken from the body, and an
 * existing fee (or the facility it prices) must belong to the caller's
 * organization unless the caller is super_admin.
 */
import { defaultCurrency } from '@/lib/country/country-pack';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { UserRole } from '@/lib/db-types';
import { ADMIN } from '@/lib/sync/write-permissions';
import type { BillingUnit, ChargeCategory, FeeScheduleDoc } from '@/lib/db-types-billing';

export const runtime = 'nodejs';

const FEE_ROLES: UserRole[] = [...ADMIN];

const CATEGORIES: readonly ChargeCategory[] = [
  'consultation', 'laboratory', 'pharmacy', 'radiology', 'procedure', 'bed_charge',
  'admission_deposit', 'surgery', 'ambulance', 'dental', 'dialysis', 'optical',
  'cardiac_diagnostics', 'mental_health', 'theatre', 'rehabilitation', 'other',
];
const UNITS: readonly BillingUnit[] = ['each', 'session', 'night', 'procedure', 'item'];

interface FeeBody {
  facilityId?: unknown;
  category?: unknown;
  serviceCode?: unknown;
  serviceName?: unknown;
  unitPrice?: unknown;
  billingUnit?: unknown;
  currency?: unknown;
  isActive?: unknown;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Validates the editable fields present in `fee`; returns an error string or the clean patch. */
function cleanFee(fee: FeeBody, requireAll: boolean): { error: string } | { patch: Partial<FeeScheduleDoc> } {
  const patch: Partial<FeeScheduleDoc> = {};
  if (fee.serviceName !== undefined || requireAll) {
    if (typeof fee.serviceName !== 'string' || !fee.serviceName.trim() || fee.serviceName.length > 200) {
      return { error: 'serviceName is required (max 200 characters)' };
    }
    patch.serviceName = fee.serviceName.trim();
  }
  if (fee.serviceCode !== undefined) {
    if (typeof fee.serviceCode !== 'string' || fee.serviceCode.length > 60) return { error: 'serviceCode is invalid' };
    patch.serviceCode = fee.serviceCode.trim();
  } else if (requireAll) {
    patch.serviceCode = '';
  }
  if (fee.category !== undefined || requireAll) {
    if (typeof fee.category !== 'string' || !CATEGORIES.includes(fee.category as ChargeCategory)) {
      return { error: 'category is invalid' };
    }
    patch.category = fee.category as ChargeCategory;
  }
  if (fee.unitPrice !== undefined || requireAll) {
    if (typeof fee.unitPrice !== 'number' || !Number.isFinite(fee.unitPrice) || fee.unitPrice < 0 || fee.unitPrice > 1e9) {
      return { error: 'unitPrice must be a non-negative number' };
    }
    patch.unitPrice = Math.round(fee.unitPrice * 100) / 100;
  }
  if (fee.billingUnit !== undefined) {
    if (typeof fee.billingUnit !== 'string' || !UNITS.includes(fee.billingUnit as BillingUnit)) {
      return { error: 'billingUnit is invalid' };
    }
    patch.billingUnit = fee.billingUnit as BillingUnit;
  }
  if (fee.currency !== undefined) {
    if (typeof fee.currency !== 'string' || !/^[A-Za-z]{3}$/.test(fee.currency.trim())) {
      return { error: 'currency must be a 3-letter code' };
    }
    patch.currency = fee.currency.trim().toUpperCase();
  }
  if (fee.isActive !== undefined) {
    if (typeof fee.isActive !== 'boolean') return { error: 'isActive must be true or false' };
    patch.isActive = fee.isActive;
  }
  return { patch };
}

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, FEE_ROLES)) return forbidden();
    const isSuper = auth.role === 'super_admin';
    // Every non-platform caller needs an organization: without one, tenant
    // comparisons against org-less documents (undefined === undefined) pass.
    if (!isSuper && !auth.orgId) return forbidden();
    const audit = (verb: string, details: string) =>
      logAuditSafe(`FEE_SCHEDULE_${verb}`, auth.sub, auth.username, details);

    let body: { action?: string; id?: string; fee?: FeeBody };
    try {
      body = await request.json();
    } catch {
      return bad('Invalid JSON body');
    }

    const { feeScheduleDB, hospitalsDB } = await import('@/lib/db');
    const db = feeScheduleDB();

    // A facility the caller's organization owns (org is never read from the body).
    const facilityFor = async (facilityId: unknown) => {
      if (typeof facilityId !== 'string' || !facilityId) return null;
      try {
        const h = await hospitalsDB().get(facilityId) as { name?: string; orgId?: string };
        if (!isSuper && (!h.orgId || h.orgId !== auth.orgId)) return null;
        return { id: facilityId, name: h.name || '', orgId: h.orgId };
      } catch {
        return null;
      }
    };

    if (body.action === 'create') {
      if (!body.fee || typeof body.fee !== 'object') return bad('fee is required');
      const cleaned = cleanFee(body.fee, true);
      if ('error' in cleaned) return bad(cleaned.error);
      // No facility = an organization-wide price; one that is named must be ours.
      const facility = body.fee.facilityId
        ? await facilityFor(body.fee.facilityId)
        : { id: '', name: '', orgId: undefined as string | undefined };
      if (!facility) return bad('Choose a facility in your organization');
      let orgId = auth.orgId;
      if (isSuper) {
        // A platform operator has no organization of their own: the price
        // belongs to the org of the facility it names, or to an explicit org
        // that exists.
        const explicit = (body.fee as { orgId?: unknown }).orgId;
        if (facility.id) {
          if (!facility.orgId) return bad('That facility has no organization');
          if (typeof explicit === 'string' && explicit && explicit !== facility.orgId) {
            return bad('The facility does not belong to that organization');
          }
          orgId = facility.orgId;
        } else {
          if (typeof explicit !== 'string' || !explicit) return bad('Choose a facility (or an organization) to price services for');
          const { organizationsDB } = await import('@/lib/db');
          try { await organizationsDB().get(explicit); } catch { return bad('Organization not found'); }
          orgId = explicit;
        }
      }
      if (!orgId) return bad('Your account has no organization to price services for');
      const now = new Date().toISOString();
      const { v4: uuidv4 } = await import('uuid');
      const doc: FeeScheduleDoc = {
        _id: `fee_${uuidv4()}`,
        type: 'fee_schedule',
        facilityId: facility.id,
        facilityName: facility.name,
        category: cleaned.patch.category!,
        serviceCode: cleaned.patch.serviceCode ?? '',
        serviceName: cleaned.patch.serviceName!,
        unitPrice: cleaned.patch.unitPrice!,
        billingUnit: cleaned.patch.billingUnit,
        currency: cleaned.patch.currency || defaultCurrency(),
        isActive: cleaned.patch.isActive ?? true,
        effectiveFrom: now,
        orgId,
        createdAt: now,
        updatedAt: now,
      };
      const resp = await db.put(doc);
      doc._rev = resp.rev;
      await audit('CREATED', `Fee ${doc._id} "${doc.serviceName}" created at ${doc.unitPrice} ${doc.currency}${doc.facilityId ? ` for facility ${doc.facilityId}` : ' (organisation-wide)'}`);
      return NextResponse.json({ fee: doc }, { status: 201 });
    }

    if (body.action === 'update' || body.action === 'delete') {
      if (typeof body.id !== 'string' || !body.id.startsWith('fee')) return bad('id is required');
      let existing: FeeScheduleDoc;
      try {
        existing = await db.get(body.id) as FeeScheduleDoc;
      } catch {
        return bad('Fee not found', 404);
      }
      if (existing.type !== 'fee_schedule' || (!isSuper && (!existing.orgId || existing.orgId !== auth.orgId))) {
        return bad('Fee not found', 404);
      }

      if (body.action === 'delete') {
        // A real delete (CouchDB tombstone), not a soft flag: pull replication
        // carries the tombstone to every device, and a soft-flagged row would
        // keep pricing charges on devices that don't check isActive.
        await db.remove(existing._id, existing._rev!);
        await audit('DELETED', `Fee ${existing._id} "${existing.serviceName}" deleted (was ${existing.unitPrice} ${existing.currency})`);
        return NextResponse.json({ ok: true, id: existing._id });
      }

      if (!body.fee || typeof body.fee !== 'object') return bad('fee is required');
      const cleaned = cleanFee(body.fee, false);
      if ('error' in cleaned) return bad(cleaned.error);
      const next: FeeScheduleDoc = { ...existing, ...cleaned.patch, updatedAt: new Date().toISOString() };
      const requestedFacility = body.fee.facilityId;
      if (requestedFacility === null || requestedFacility === '') {
        // Explicit null/'' = back to an organisation-wide price.
        next.facilityId = '';
        next.facilityName = '';
      } else if (requestedFacility !== undefined && requestedFacility !== existing.facilityId) {
        const facility = await facilityFor(requestedFacility);
        // The facility must belong to the fee's own organization.
        if (!facility || facility.orgId !== existing.orgId) return bad('Choose a facility in your organization');
        next.facilityId = facility.id;
        next.facilityName = facility.name;
      }
      // Never re-homed by the client.
      next.orgId = existing.orgId;
      const resp = await db.put(next);
      next._rev = resp.rev;
      await audit('UPDATED', `Fee ${next._id} "${next.serviceName}" price ${existing.unitPrice} -> ${next.unitPrice} ${next.currency}${existing.facilityId !== next.facilityId ? `; facility ${existing.facilityId || 'organisation-wide'} -> ${next.facilityId || 'organisation-wide'}` : ''}`);
      return NextResponse.json({ fee: next });
    }

    return bad("action must be 'create', 'update' or 'delete'");
  } catch (err) {
    logApiError('[API /fee-schedule POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'fee_schedule.write' });
