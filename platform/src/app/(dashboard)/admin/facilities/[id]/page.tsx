'use client';

/**
 * ONE FACILITY — the third rung of the drill-down.
 *
 * Reached by clicking a row on its organization's page, and it knows that:
 * the trail above names the tenant that owns it and links back to it, and so
 * does Back. It used to offer an "X close" that pushed
 * `/admin/organizations?view=facilities` — a flat national registry — so
 * drilling into a facility from a tenant and coming out again landed you
 * somewhere you had never been, with the tenant you were working in gone.
 *
 * The page's own content is `FacilityProfile`: the facility's identity, its
 * actions, and its STAFF. That roster is why a facility row gets clicked, so
 * it is the page rather than the third fold down it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { SadbPage, SadbConfirmModal } from '@/components/admin/sadb-ui';
import { FacilityProfile } from '@/components/facilities/FacilityProfile';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { useConsoleTrail } from '@/components/navigation/ConsoleTrail';
import { FACILITY_CONSOLE_ROLES } from '@/lib/facility-access';
import { canCreateFacilities } from '@/lib/people-nav';
import { isFacilityActive } from '@/lib/services/hospital-service';
import { safeReturnTo } from '@/lib/navigation/return-to';
import type { DataScope } from '@/lib/services/data-scope';
import type { HospitalDoc } from '@/lib/db-types';

export default function AdminFacilityDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facilityId = params?.id ?? '';
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();

  const [hospital, setHospital] = useState<HospitalDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [busy, setBusy] = useState(false);

  const canCreate = canCreateFacilities(currentUser?.role ?? '');

  const scope: DataScope | undefined = useMemo(() => (currentUser ? {
    role: currentUser.role,
    orgId: currentUser.orgId,
    hospitalId: currentUser.hospitalId,
  } : undefined), [currentUser]);

  const load = useCallback(async () => {
    if (!scope) return;
    try {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      // SCOPED. Read bare, this was a cross-tenant read waiting to happen: the
      // local database holds every organization the device replicated, and an
      // id in the URL is not a permission. `filterByScope` answers null for a
      // facility outside the caller's tenant, which lands on "not found" below
      // — the same answer as a facility that does not exist, which is the only
      // thing the caller is entitled to know about someone else's.
      setHospital((await getHospitalById(facilityId, scope)) ?? null);
    } catch {
      setHospital(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId, scope]);

  useEffect(() => { void load(); }, [load]);

  /* The level above. `?returnTo=` is what the organization page hands down;
     without it (a bookmark, a deep link) the facility's own `orgId` still
     resolves the parent, and only a facility with no readable tenant falls
     back to the console root. */
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('returnTo');
    setReturnTo(value ? safeReturnTo(value, '/manage') : null);
  }, []);

  const parentOrg = organizations.find(org => org._id === hospital?.orgId) ?? null;
  const parentHref = returnTo
    ?? (hospital?.orgId ? `/admin/organizations/${encodeURIComponent(hospital.orgId)}` : '/manage');
  const backToParent = () => router.push(parentHref);

  /* Organizations › <tenant> › <facility>. The tenant crumb is dropped when
     the operator lives inside one org — `/manage` IS their tenant page, so
     naming it twice would be a rung that goes nowhere new. */
  useConsoleTrail('facility-detail', hospital ? [
    ...(parentOrg && parentHref !== '/manage'
      ? [{ label: t('management.organizations'), href: '/manage' }, { label: parentOrg.name, href: parentHref }]
      : [{ label: parentOrg?.name ?? t('management.facilities'), href: parentHref }]),
    { label: hospital.name },
  ] : null);

  /**
   * Retire or restore, for real.
   *
   * This button used to call the page's own "go back" handler: pressing
   * Retire navigated to the registry and changed nothing. `setFacilityActive`
   * is the soft flag the service has had all along — never a delete, because
   * admissions, visits, bills and staff records all carry `hospitalId`.
   */
  const runRetire = async () => {
    if (!hospital || busy) return;
    setBusy(true);
    try {
      const { setFacilityActive } = await import('@/lib/services/hospital-service');
      const next = !isFacilityActive(hospital);
      const updated = await setFacilityActive(
        hospital._id, next, currentUser?._id, currentUser?.username, scope,
      );
      if (!updated) throw new Error('Facility status change returned nothing');
      setHospital(updated);
      setConfirmRetire(false);
      showToast(
        next
          ? t('orgHospitals.restoredToast', { name: updated.name })
          : t('orgHospitals.retiredToast', { name: updated.name }),
        'success',
      );
    } catch (error) {
      console.error('Facility status change failed:', error);
      showToast(t('management.actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SadbPage roles={[...FACILITY_CONSOLE_ROLES]}>
      {loading ? (
        <p className="sadb-empty">{t('hospitals.loadingFacilities')}</p>
      ) : !hospital ? (
        <div className="sadb-card">
          <p className="sadb-empty">{t('orgAdmin.facilityNotFound')}</p>
          {/* A dead id is exactly where a way out matters: the trail above
              needs a record to name, so it renders nothing here. */}
          <button type="button" className="btn btn-secondary btn-sm" onClick={backToParent}>
            {t('orgAdmin.backToFacilities')}
          </button>
        </div>
      ) : (
        <FacilityProfile
          hospital={hospital}
          canCreate={canCreate}
          onEdit={() => setEditing(true)}
          onRetire={() => setConfirmRetire(true)}
        />
      )}

      {editing && hospital && (
        <FacilityFormModal
          facility={hospital}
          onClose={() => setEditing(false)}
          onSaved={saved => { setEditing(false); setHospital(saved); }}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}

      {confirmRetire && hospital && (
        <SadbConfirmModal
          title={isFacilityActive(hospital)
            ? t('orgHospitals.confirmRetireTitle', { name: hospital.name })
            : t('orgHospitals.confirmRestoreTitle', { name: hospital.name })}
          body={isFacilityActive(hospital)
            ? t('orgHospitals.confirmRetireBody')
            : t('orgHospitals.confirmRestoreBody')}
          confirmLabel={isFacilityActive(hospital) ? t('orgHospitals.retire') : t('orgHospitals.restore')}
          busy={busy}
          onCancel={() => { if (!busy) setConfirmRetire(false); }}
          onConfirm={() => { void runRetire(); }}
        />
      )}
    </SadbPage>
  );
}
