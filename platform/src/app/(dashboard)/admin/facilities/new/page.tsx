'use client';

/**
 * Register facility, full-page.
 *
 * This is the destination of the facility popup's Expand control. It hosts
 * the same FacilityFormModal implementation in page presentation, so create
 * validation and persistence remain identical on both surfaces.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from '@/components/icons/lucide';
import { SadbPage } from '@/components/admin/sadb-ui';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { returnToFromSearch } from '@/lib/navigation/return-to';

export default function AdminFacilityCreatePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { organizations } = useOrganizations();
  const [orgId, setOrgId] = useState('');
  const [returnTo, setReturnTo] = useState('/manage?view=facilities');

  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    setOrgId(params.get('org') ?? '');
    setReturnTo(returnToFromSearch(search, '/manage?view=facilities'));
  }, []);

  const goBack = () => router.push(returnTo);

  return (
    <SadbPage>
      <div className="sadb-regpage-shell">
        <div className="patient-registration-toolbar">
          <button type="button" onClick={goBack} className="patient-registration-back">
            <ArrowLeft className="w-4 h-4" /> {t('orgAdmin.backToFacilities')}
          </button>
        </div>

        <div className="sadb-regpage">
          <aside className="sadb-regpage-rail">
            <h1 className="sadb-regpage-title">{t('orgHospitals.modalTitle')}</h1>
            <p className="sadb-regpage-note">{t('orgHospitals.modalSubtitle')}</p>
          </aside>

          <div className="sadb-card sadb-regpage-form">
            <FacilityFormModal
              presentation="page"
              orgId={orgId || undefined}
              organizations={orgId ? undefined : organizations}
              actor={{ _id: currentUser?._id, username: currentUser?.username }}
              onClose={goBack}
              onSaved={hospital => router.push(`/admin/facilities/${encodeURIComponent(hospital._id)}`)}
            />
          </div>
        </div>
      </div>
    </SadbPage>
  );
}
