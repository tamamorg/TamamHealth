'use client';

/**
 * Chart notice for the duplicate link (markPatientDuplicate).
 *
 * On the duplicate's chart it is a strong warning pointing at the record to
 * use. On the surviving record it is a quiet notice that a duplicate exists.
 * Both repeat the one thing the link does not do: allergies and medicines are
 * not moved, so a person has to check them.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { PatientDoc } from '@/lib/db-types';

function displayName(p: PatientDoc): string {
  return [p.firstName, p.surname].filter(Boolean).join(' ').trim() || p.hospitalNumber || p._id;
}

export default function DuplicateRecordBanner({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [kept, setKept] = useState<PatientDoc | null>(null);
  const [duplicates, setDuplicates] = useState<PatientDoc[]>([]);
  const duplicateOf = patient.duplicateOf;

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('@/lib/services/patient-service');
        if (duplicateOf) {
          const doc = await svc.getPatientById(duplicateOf, scope);
          if (!cancelled) { setKept(doc); setDuplicates([]); }
        } else {
          const rows = await svc.getDuplicatesOf(patient._id, scope);
          if (!cancelled) { setDuplicates(rows); setKept(null); }
        }
      } catch {
        // A notice that cannot load must not take the chart down with it.
        if (!cancelled) { setKept(null); setDuplicates([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [scope, duplicateOf, patient._id, patient._rev]);

  if (duplicateOf) {
    const name = kept ? displayName(kept) : t('dup.keptUnknown');
    return (
      <InlineBanner tone="danger" title={t('dup.bannerTitle', { name })}>
        <p style={{ margin: 0 }}>{t('dup.bannerCheck')}</p>
        <Link href={`/patients/${duplicateOf}`} className="font-semibold" style={{ textDecoration: 'underline' }}>
          {t('dup.openKept', { name })}
        </Link>
      </InlineBanner>
    );
  }

  if (duplicates.length === 0) return null;
  return (
    <InlineBanner tone="info" compact>
      <p style={{ margin: 0 }}>
        {t('dup.survivorNotice', { name: duplicates.map(displayName).join(', ') })} {t('dup.survivorCheck')}
      </p>
      {duplicates.map(d => (
        <Link key={d._id} href={`/patients/${d._id}`} className="font-semibold" style={{ textDecoration: 'underline', marginRight: 12 }}>
          {t('dup.openDuplicate', { name: displayName(d) })}
        </Link>
      ))}
    </InlineBanner>
  );
}
