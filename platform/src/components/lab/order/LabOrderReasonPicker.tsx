'use client';

/**
 * Reason for test — the first block of the Clinical step.
 *
 * The order is usually what produces the diagnosis, so this asks why the test
 * is wanted, not what the patient has: a symptom, a suspected condition, or
 * "screening, no complaint" each satisfy it. What is on the order sits at the
 * top; below it, the likeliest answers are one tick away — what this visit and
 * this chart already say first, then symptoms, then the no-symptom reasons —
 * with a search for anything else.
 *
 * Still required: an order with no stated reason is one the bench cannot
 * sanity-check and no payer will reimburse.
 */

import { useMemo, useState } from 'react';
import CodedSearchField from '@/components/CodedSearchField';
import { AlertTriangle, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  NO_SYMPTOM_REASONS,
  REASON_SEARCH_OPTIONS,
  SUSPECTED_REASONS,
  SYMPTOM_REASONS,
  problemListReasons,
  suggestReasonsFromText,
} from './lab-order-reasons';
import type { OrderIndication } from './lab-order-types';
import type { LabOrderController } from './useLabOrderDraft';
import { useVisitComplaint } from './useVisitComplaint';

/** Symptoms shown before "Show more reasons" — three rows of the grid. */
const DEFAULT_SYMPTOM_COUNT = 9;

export default function LabOrderReasonPicker({ controller }: { controller: LabOrderController }) {
  const { t } = useTranslation();
  const { draft, patient, addIndication, removeIndication, contextText } = controller;
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  // Opened from a note, the complaint arrives with the order; otherwise read
  // it off the patient's open visit.
  const lookedUp = useVisitComplaint(patient, !!contextText);
  const visitText = contextText || lookedUp;

  // Each reason is offered once, in the first group that has it.
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const unique = (items: OrderIndication[]) => items.filter(item => {
      if (seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    });
    return [
      { key: 'visit', label: 'labOrder.reasonFromVisit', items: unique(suggestReasonsFromText(visitText)) },
      { key: 'problems', label: 'labOrder.fromProblemList', items: unique(problemListReasons(patient?.chronicConditions)) },
      { key: 'symptoms', label: 'labOrder.reasonSymptoms', items: unique(showAll ? SYMPTOM_REASONS : SYMPTOM_REASONS.slice(0, DEFAULT_SYMPTOM_COUNT)) },
      { key: 'none', label: 'labOrder.reasonNoSymptoms', items: unique(NO_SYMPTOM_REASONS) },
      { key: 'suspected', label: 'labOrder.reasonSuspected', items: showAll ? unique(SUSPECTED_REASONS) : [] },
    ].filter(group => group.items.length > 0);
  }, [visitText, patient, showAll]);

  const selectedCodes = new Set(draft.indications.map(indication => indication.code));
  const missing = draft.indications.length === 0;

  return (
    <div className="labord-section">
      <div className="labord-section-head">
        <span>{t('labOrder.reasons')}<span className="labord-required"> *</span></span>
        {missing && (
          <span className="labord-required" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            {t('labOrder.reasonMissing')}
          </span>
        )}
      </div>
      <div className="labord-section-body">
        <p className="labord-help" style={{ marginTop: 0 }}>{t('labOrder.reasonHelp')}</p>

        <div className="labord-reason-group">
          <span className="labord-field-label">{t('labOrder.reasonSelected')}</span>
          {missing
            ? <p className="labord-help" style={{ margin: 0 }}>{t('labOrder.noReasonYet')}</p>
            : (
              <div className="labord-chip-row">
                {draft.indications.map(indication => (
                  <span key={indication.code} className="labord-chip">
                    <code>{indication.code}</code> {indication.title}
                    <button
                      type="button"
                      onClick={() => removeIndication(indication.code)}
                      aria-label={t('labOrder.removeReason', { code: indication.code })}
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
        </div>

        {groups.map(group => (
          <div key={group.key} className="labord-reason-group">
            <span className="labord-field-label">{t(group.label)}</span>
            <div className="labord-check-grid">
              {group.items.map(entry => {
                const on = selectedCodes.has(entry.code);
                return (
                  <button
                    key={entry.code}
                    type="button"
                    className={`labord-check${on ? ' labord-check--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => (on ? removeIndication(entry.code) : addIndication({ code: entry.code, title: entry.title }))}
                  >
                    <input type="checkbox" checked={on} readOnly tabIndex={-1} style={{ pointerEvents: 'none' }} />
                    <span style={{ minWidth: 0 }}>
                      <code style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--accent-primary)', marginInlineEnd: 6 }}>
                        {entry.code}
                      </code>
                      {entry.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="labord-reason-group">
          <button type="button" className="labord-btn labord-btn--ghost" style={{ padding: '2px 8px' }} onClick={() => setShowAll(v => !v)}>
            {showAll ? t('labOrder.showFewer') : t('labOrder.showMoreReasons')}
          </button>
        </div>

        <div className="labord-reason-group">
          <span className="labord-q">{t('labOrder.addReason')}</span>
          <CodedSearchField
            label=""
            placeholder={t('labOrder.icdPlaceholder')}
            options={REASON_SEARCH_OPTIONS}
            value={query}
            onChange={setQuery}
            onSelect={option => { addIndication({ code: option.code, title: option.name }); setQuery(''); }}
            excludeCodes={[...selectedCodes]}
          />
          <p className="labord-help">{t('labOrder.icdHelp')}</p>
        </div>
      </div>
    </div>
  );
}
