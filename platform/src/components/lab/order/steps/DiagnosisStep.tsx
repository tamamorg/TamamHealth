'use client';

/**
 * Step 4 — Diagnosis. Two boxes, mirroring the Tests step: what is already on
 * the order (auto-populated from the Create Order dialog, unticking removes
 * it), and a grid of the codes most likely to apply — this patient's problem
 * list plus the facility's common indications — with a search for anything
 * else.
 *
 * A lab order without an indication is one the bench cannot prioritise and no
 * payer will reimburse, which is why this step gates Review.
 */

import { useMemo, useState } from 'react';
import CodedSearchField from '@/components/CodedSearchField';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabOrderController } from '../useLabOrderDraft';

/** Codes offered in the grid when the chart has no coded problems to draw on. */
const FALLBACK_CODE_COUNT = 12;

export default function DiagnosisStep({ controller }: { controller: LabOrderController }) {
  const { t } = useTranslation();
  const { draft, patient, addIndication, removeIndication } = controller;
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const icdOptions = useMemo(
    () => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })),
    [],
  );

  // The chart's active problems, matched back to ICD titles so a tick adds a
  // properly coded indication rather than a free-text string.
  const fromChart = useMemo(() => {
    const conditions = patient?.chronicConditions || [];
    return conditions
      .map(condition => {
        const hit = COMMON_ICD11_CODES.find(
          c => c.title.toLowerCase() === condition.toLowerCase()
            || c.title.toLowerCase().includes(condition.toLowerCase())
            || (c.keywords || []).some(k => k.toLowerCase() === condition.toLowerCase()),
        );
        return hit ? { code: hit.code, title: hit.title } : null;
      })
      .filter((entry): entry is { code: string; title: string } => entry !== null);
  }, [patient]);

  // The grid: chart problems first, then common codes to fill it out. Anything
  // already on the order stays in the grid, ticked, so unticking removes it —
  // the same affordance as the reference form.
  const gridCodes = useMemo(() => {
    const seen = new Set<string>();
    const out: { code: string; title: string }[] = [];
    const push = (entry: { code: string; title: string }) => {
      if (seen.has(entry.code)) return;
      seen.add(entry.code);
      out.push(entry);
    };
    draft.indications.forEach(push);
    fromChart.forEach(push);
    const common = COMMON_ICD11_CODES
      .filter(c => c.notifiable || c.causeOfDeath)
      .map(c => ({ code: c.code, title: c.title }));
    (showAll ? common : common.slice(0, FALLBACK_CODE_COUNT)).forEach(push);
    return out;
  }, [draft.indications, fromChart, showAll]);

  const selectedCodes = new Set(draft.indications.map(indication => indication.code));

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('labOrder.selectedDiagnoses', { count: draft.indications.length })}</div>
        <div className="labord-section-body" style={{ padding: draft.indications.length ? 0 : 12 }}>
          {draft.indications.length === 0 && (
            <p className="labord-help" style={{ margin: 0 }}>{t('labOrder.noDiagnosesYet')}</p>
          )}
          {draft.indications.map((indication, i) => (
            <div key={indication.code} className="labord-numbered-row">
              <span className="labord-num">{i + 1}.</span>
              <label className="labord-check" style={{ padding: 0 }}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => removeIndication(indication.code)}
                  aria-label={t('labOrder.removeDiagnosis', { code: indication.code })}
                />
                <span>
                  <code style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--accent-primary)', marginInlineEnd: 6 }}>
                    {indication.code}
                  </code>
                  {indication.title}
                </span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">
          <span>{t('labOrder.diagnosisGrid')}</span>
          <button type="button" className="labord-btn labord-btn--ghost" style={{ padding: '2px 8px' }} onClick={() => setShowAll(v => !v)}>
            {showAll ? t('labOrder.showFewer') : t('labOrder.showAllCodes')}
          </button>
        </div>
        <div className="labord-section-body">
          <div className="labord-check-grid">
            {gridCodes.map(entry => {
              const on = selectedCodes.has(entry.code);
              return (
                <button
                  key={entry.code}
                  type="button"
                  className={`labord-check${on ? ' labord-check--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => (on ? removeIndication(entry.code) : addIndication(entry))}
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

          <div style={{ marginTop: 14 }}>
            <span className="labord-q">{t('labOrder.addDiagnosis')}</span>
            <CodedSearchField
              label=""
              placeholder={t('labOrder.icdPlaceholder')}
              options={icdOptions}
              value={query}
              onChange={setQuery}
              onSelect={option => { addIndication({ code: option.code, title: option.name }); setQuery(''); }}
              excludeCodes={[...selectedCodes]}
            />
            <p className="labord-help">{t('labOrder.icdHelp')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
