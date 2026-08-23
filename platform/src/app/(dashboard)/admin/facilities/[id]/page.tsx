'use client';

/**
 * One facility, as a full page — what a row on the Facilities tab opens.
 *
 * The tab used to render this profile INLINE, replacing its own list: clicking
 * a facility swapped the registry for a panel with a close button, so the list
 * you were reading disappeared to show you one of its rows. The organizations
 * registry stopped doing that when its rows started opening
 * `/admin/organizations/[id]`; this is the same move for facilities, and the
 * seven management sections (staff, wards, equipment, inventory, schedules,
 * performance, settings) come with it rather than being stranded.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useApp } from '@/lib/context';
import { ArrowLeft } from '@/components/icons/lucide';
import { SadbPage } from '@/components/admin/sadb-ui';
import { FacilityProfile } from '@/components/facilities/FacilityNetworkView';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { FACILITY_MANAGE_TABS } from '@/components/facilities/FacilityManageTabs';
import type { HospitalDoc, UserRole } from '@/lib/db-types';

/** Same grant the Facilities tab uses to decide who may manage a facility. */
const MANAGE_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];
const CREATE_ROLES: UserRole[] = ['super_admin', 'org_admin'];

type ProfileTabId = 'overview' | (typeof FACILITY_MANAGE_TABS)[number]['id'];

export default function AdminFacilityDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facilityId = params?.id ?? '';
  const { currentUser } = useApp();

  const [hospital, setHospital] = useState<HospitalDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const canManage = !!currentUser && MANAGE_ROLES.includes(currentUser.role);
  const canCreate = !!currentUser && CREATE_ROLES.includes(currentUser.role);

  const load = useCallback(async () => {
    try {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      setHospital((await getHospitalById(facilityId)) ?? null);
    } catch {
      setHospital(null);
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => { load(); }, [load]);

  const backToRegistry = () => router.push('/admin/organizations?view=facilities');

  // `?tab=` opens a section directly, the same deep link the tab honoured.
  const initialTab = (() => {
    if (typeof window === 'undefined') return undefined;
    const value = new URLSearchParams(window.location.search).get('tab');
    return value && (value === 'overview' || FACILITY_MANAGE_TABS.some(x => x.id === value))
      ? (value as ProfileTabId)
      : undefined;
  })();

  return (
    <SadbPage>
      <div className="patient-registration-toolbar">
        <button type="button" onClick={backToRegistry} className="patient-registration-back">
          <ArrowLeft className="w-4 h-4" /> {t('orgAdmin.backToFacilities')}
        </button>
      </div>

      {loading ? (
        <p className="sadb-empty">{t('hospitals.loadingFacilities')}</p>
      ) : !hospital ? (
        <p className="sadb-empty">{t('orgAdmin.facilityNotFound')}</p>
      ) : (
        <div className="card-elevated" style={{ overflow: 'hidden' }}>
          <FacilityProfile
            hospital={hospital}
            // The page IS the surface now, so "close" means going back to the
            // registry rather than dismissing a panel over it.
            onClose={backToRegistry}
            canManage={canManage}
            canCreate={canCreate}
            onEdit={() => setEditing(true)}
            onRetire={backToRegistry}
            initialTab={initialTab}
            onHospitalSaved={saved => setHospital(saved)}
          />
        </div>
      )}

      {editing && hospital && (
        <FacilityFormModal
          facility={hospital}
          onClose={() => setEditing(false)}
          onSaved={saved => { setEditing(false); setHospital(saved); }}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}
    </SadbPage>
  );
}
