'use client';

/**
 * Patient lookup for the order flow — type a name, hospital number or phone,
 * pick a match. Used by both the compact dialog and the wizard's Patient step
 * so "who is this for" behaves identically in both places.
 */

import { useState } from 'react';
import { Search, X } from '@/components/icons/lucide';
import { patientAgeLabel, patientFullName } from '@/lib/patient-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PatientDoc } from '@/lib/db-types';

export default function LabOrderPatientPicker({
  patients,
  selectedId,
  onSelect,
  autoFocus = false,
}: {
  patients: PatientDoc[];
  selectedId: string;
  onSelect: (patientId: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const selected = selectedId ? patients.find(p => p._id === selectedId) : null;

  if (selected) {
    return (
      <div className="labord-row" style={{ border: '1px solid var(--labord-line)', borderRadius: 4 }}>
        <span>
          <span className="labord-pick-name">{patientFullName(selected)}</span>
          <span className="labord-pick-meta" style={{ marginInlineStart: 8 }}>
            {selected.hospitalNumber} · {patientAgeLabel(selected)} · {selected.gender || '—'}
          </span>
        </span>
        <button type="button" className="labord-btn labord-btn--ghost" onClick={() => { onSelect(''); setQuery(''); }}>
          <X className="w-3.5 h-3.5" aria-hidden /> {t('labOrder.changePatient')}
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? patients.filter(p =>
        patientFullName(p).toLowerCase().includes(q) ||
        (p.hospitalNumber || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q)
      ).slice(0, 8)
    : [];

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <Search
          className="w-4 h-4"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('labOrder.searchPatientPlaceholder')}
          style={{ paddingInlineStart: 32 }}
          autoFocus={autoFocus}
          aria-label={t('labOrder.patient')}
        />
      </div>
      {matches.length > 0 && (
        <div className="labord-picklist" style={{ marginTop: 6, maxHeight: 220 }}>
          {matches.map(patient => (
            <button
              key={patient._id}
              type="button"
              className="labord-pick"
              onClick={() => { onSelect(patient._id); setQuery(''); }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="labord-pick-name">{patientFullName(patient)}</span>
                <span className="labord-pick-meta" style={{ display: 'block' }}>
                  {patientAgeLabel(patient)} · {patient.gender || '—'}
                </span>
              </span>
              <span className="labord-pick-meta" style={{ fontFamily: 'var(--font-mono, monospace)' }}>{patient.hospitalNumber}</span>
            </button>
          ))}
        </div>
      )}
      {q.length > 0 && matches.length === 0 && (
        <p className="labord-help">{t('labOrder.noPatientsMatch')}</p>
      )}
    </div>
  );
}
