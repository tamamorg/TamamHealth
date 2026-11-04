'use client';

import { useMemo, useState } from 'react';
import { Loader2, Search } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientFullName, patientInitials, patientGenderAge, avatarTint } from '@/lib/patient-utils';
import { useMobileShellState } from '@/lib/mobile-shell/use-mobile-shell-state';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function MobilePatientsView() {
  const { t } = useTranslation();
  const { patients, loading } = usePatients();
  const shell = useMobileShellState();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const fullName = patientFullName(p).toLowerCase();
      return (
        fullName.includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q) ||
        (p.phone || '').includes(query.trim())
      );
    });
  }, [patients, query]);

  return (
    <div className="mobile-patients">
      <div className="mobile-patients-search">
        <Search className="w-4 h-4" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ui.nameIdOrPhone')}
        />
      </div>
      <div className="mobile-patients-list">
        {loading ? (
          <div className="mobile-shell-loading">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title={t('boma.noPatientsFound')} message="Try a different name, ID, or phone number." />
        ) : (
          filtered.map((p) => (
            <button key={p._id} type="button" className="mobile-patient-row" onClick={() => shell.openChart(p._id)}>
              <span className="mobile-patient-avatar" style={avatarTint(patientFullName(p))}>
                {patientInitials(p)}
              </span>
              <span className="mobile-patient-meta">
                <strong>{patientFullName(p)}</strong>
                <small>{p.hospitalNumber} · {patientGenderAge(p)}</small>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
