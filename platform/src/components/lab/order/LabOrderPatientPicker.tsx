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
import './lab-order.css';

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
  /* The matches float over the form under the field (a dropdown), so the
     card does not grow as you type. Open while the search has focus. */
  const [open, setOpen] = useState(false);
  const selected = selectedId ? patients.find(p => p._id === selectedId) : null;

  if (selected) {
    return (
      <div className="labord-row" style={{ border: '1px solid var(--labord-line)', borderRadius: 0 }}>
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

  /* Close when focus leaves the field and its list; Escape closes it first
     (and only then the slider around it). */
  const closeOnLeave = (e: React.FocusEvent<HTMLElement>) => {
    const host = e.currentTarget.closest('.labord-patient-search');
    if (!host?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };
  const closeOnEscape = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="labord-patient-search">
      {/* `search-icon-input`: the input is the box and the icon sits over it.
          Without it, globals.css treats an svg + search input pair as a
          wrapper-drawn box and strips the input's border and fill, and this
          wrapper draws none, so the field vanished on a grey form. */}
      <div style={{ position: 'relative' }}>
        <Search className="search-input-icon" style={{ color: 'var(--text-muted)' }} aria-hidden />
        <input
          type="search"
          className="search-icon-input"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={closeOnLeave}
          onKeyDown={closeOnEscape}
          placeholder={t('labOrder.searchPatientPlaceholder')}
          autoFocus={autoFocus}
          aria-label={t('labOrder.patient')}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="labord-picklist labord-picklist--results tm-elevated">
          {matches.map(patient => (
            <button
              key={patient._id}
              type="button"
              className="labord-pick"
              // Keeps focus in the field: Safari does not focus a clicked
              // button, so the field's blur would close the list first.
              onMouseDown={e => e.preventDefault()}
              onBlur={closeOnLeave}
              onKeyDown={closeOnEscape}
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
      {open && q.length > 0 && matches.length === 0 && (
        <p className="labord-help labord-picklist--results labord-picklist--empty tm-elevated">{t('labOrder.noPatientsMatch')}</p>
      )}
    </div>
  );
}
