'use client';

/**
 * Phase 1 — the compact "Create Order" dialog.
 *
 * Laid out as the paper request form it replaces: a question, then its
 * control, then the next question — no cards. Cards start in the wizard, where
 * there is genuinely grouped content to separate. Diagnoses and tests are
 * numbered lists you add to, so what is on the order reads the same here as it
 * will on the printed requisition.
 *
 * It places nothing on its own: the single submit path lives in the wizard, so
 * an order can never be half-created by backing out here.
 */

import { useMemo, useState } from 'react';
import CodedSearchField from '@/components/CodedSearchField';
import { Check, FlaskConical, Image as ImageIcon, Search, X } from '@/components/icons/lucide';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LabOrderPatientPicker from './LabOrderPatientPicker';
import { catalogFor, searchCatalog, toOrderedTest } from './lab-order-catalog';
import type { LabOrderKind, LabOrderProcessing } from './lab-order-types';
import type { LabOrderController } from './useLabOrderDraft';
import Select from '@/components/Select';

export default function LabOrderCreateDialog({
  controller,
  onCancel,
  onContinue,
  lockPatient = false,
}: {
  controller: LabOrderController;
  onCancel: () => void;
  onContinue: () => void;
  /** Opened from a chart: the patient is fixed and shown read-only. */
  lockPatient?: boolean;
}) {
  const { t } = useTranslation();
  const { labCatalog } = useSettings();
  const { draft, patch, patients, toggleTest, removeTest, addIndication, removeIndication } = controller;
  const [icdQuery, setIcdQuery] = useState('');
  const [testQuery, setTestQuery] = useState('');

  const icdOptions = useMemo(
    () => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })),
    [],
  );

  const testMatches = useMemo(() => {
    if (!testQuery.trim()) return [];
    const selected = new Set(draft.tests.map(test => test.name));
    return searchCatalog(catalogFor(labCatalog, draft.kind), testQuery)
      .filter(entry => !selected.has(entry.name))
      .slice(0, 8);
  }, [labCatalog, draft.kind, draft.tests, testQuery]);

  const canContinue = !!draft.patientId && draft.tests.length > 0;
  const imaging = draft.kind === 'imaging';

  const setKind = (kind: LabOrderKind) => {
    if (kind === draft.kind) return;
    // The catalogues are disjoint — carrying bench tests into an imaging order
    // would put an unorderable line on the requisition.
    patch({ kind, tests: [] });
    setTestQuery('');
  };

  return (
    <div className="labord labord--dialog">
      <div className="labord-header">
        <div>
          <h3 className="labord-title">{t('labOrder.createOrder')}</h3>
          <p className="labord-subtitle">{t('labOrder.createOrderSubtitle')}</p>
        </div>
        <button type="button" className="labord-close" onClick={onCancel} aria-label={t('action.cancel')}>
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="labord-scroll">
        {/* What type of order is this? */}
        <div className="labord-form labord-form--full">
          <div>
            <span className="labord-q">{t('labOrder.orderType')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="labord-toggle-group" role="group" aria-label={t('labOrder.orderType')}>
                <button
                  type="button"
                  className={`labord-toggle${!imaging ? ' labord-toggle--on' : ''}`}
                  aria-pressed={!imaging}
                  onClick={() => setKind('labs')}
                >
                  {!imaging ? <Check className="w-3.5 h-3.5" aria-hidden /> : <FlaskConical className="w-3.5 h-3.5" aria-hidden />}
                  {t('labOrder.typeLabs')}
                </button>
                <button
                  type="button"
                  className={`labord-toggle${imaging ? ' labord-toggle--on' : ''}`}
                  aria-pressed={imaging}
                  onClick={() => setKind('imaging')}
                >
                  {imaging ? <Check className="w-3.5 h-3.5" aria-hidden /> : <ImageIcon className="w-3.5 h-3.5" aria-hidden />}
                  {t('labOrder.typeImaging')}
                </button>
              </div>
              <span className="labord-help" style={{ margin: 0 }}>
                {imaging ? t('labOrder.typeImagingHelp') : t('labOrder.typeLabsHelp')}
              </span>
            </div>
          </div>
        </div>

        {!lockPatient && (
          <>
            <div className="labord-divider" />
            <div className="labord-form labord-form--full">
              <div>
                <span className="labord-q">{t('labOrder.patientQuestion')}</span>
                <LabOrderPatientPicker
                  patients={patients}
                  selectedId={draft.patientId}
                  onSelect={patientId => patch({ patientId })}
                  autoFocus
                />
              </div>
            </div>
          </>
        )}

        <div className="labord-divider" />

        {/* Who orders it, who runs it. */}
        <div className="labord-form">
          <div>
            <label className="labord-q" htmlFor="labord-dialog-provider">{t('labOrder.orderingProvider')}</label>
            <input
              id="labord-dialog-provider"
              type="text"
              value={draft.orderedByName}
              onChange={e => patch({ orderedByName: e.target.value })}
              placeholder={t('labOrder.orderingProviderPlaceholder')}
            />
          </div>
          <div>
            <label className="labord-q" htmlFor="labord-dialog-processing">{t('labOrder.processingQuestion')}</label>
            <Select
              id="labord-dialog-processing"
              value={draft.processing}
              onChange={e => patch({ processing: e.target.value as LabOrderProcessing })}
            >
              <option value="in_house">{t('labOrder.processingInHouse')}</option>
              <option value="send_out">{t('labOrder.processingSendOut')}</option>
            </Select>
          </div>
          <div>
            <label className="labord-q" htmlFor="labord-dialog-notes">{t('labOrder.notesToLab')}</label>
            <textarea
              id="labord-dialog-notes"
              rows={4}
              value={draft.notes}
              onChange={e => patch({ notes: e.target.value })}
              placeholder={t('lab.clinicalNotesPlaceholder')}
            />
          </div>
          <div>
            <span className="labord-q">{t('labOrder.statQuestion')}</span>
            <div className="labord-toggle-group" role="group" aria-label={t('labOrder.statQuestion')}>
              <button
                type="button"
                className={`labord-toggle labord-toggle--danger${draft.priority === 'stat' ? ' labord-toggle--on' : ''}`}
                aria-pressed={draft.priority === 'stat'}
                onClick={() => patch({ priority: 'stat' })}
              >
                {draft.priority === 'stat' && <Check className="w-3.5 h-3.5" aria-hidden />}
                {t('action.yes')}
              </button>
              <button
                type="button"
                className={`labord-toggle${draft.priority !== 'stat' ? ' labord-toggle--on' : ''}`}
                aria-pressed={draft.priority !== 'stat'}
                onClick={() => patch({ priority: 'routine' })}
              >
                {draft.priority !== 'stat' && <Check className="w-3.5 h-3.5" aria-hidden />}
                {t('action.no')}
              </button>
            </div>
            {draft.priority === 'stat' && <p className="labord-help">{t('labOrder.statHelp')}</p>}
          </div>
        </div>

        <div className="labord-divider" />

        {/* Diagnoses — numbered, in the order they were added. */}
        <div className="labord-form labord-form--full">
          <div>
            <span className="labord-q">{t('labOrder.diagnoses')}</span>
            {draft.indications.length > 0 && (
              <div className="labord-numbered">
                {draft.indications.map((indication, i) => (
                  <div key={indication.code} className="labord-numbered-row">
                    <span className="labord-num">{i + 1}.</span>
                    <span className="labord-numbered-body">
                      <code>{indication.code}</code>{indication.title}
                    </span>
                    <button
                      type="button"
                      className="labord-x"
                      onClick={() => removeIndication(indication.code)}
                      aria-label={t('labOrder.removeDiagnosis', { code: indication.code })}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <CodedSearchField
              label=""
              placeholder={t('labOrder.icdPlaceholder')}
              options={icdOptions}
              value={icdQuery}
              onChange={setIcdQuery}
              onSelect={option => { addIndication({ code: option.code, title: option.name }); setIcdQuery(''); }}
              excludeCodes={draft.indications.map(indication => indication.code)}
            />
            <p className="labord-help">{t('labOrder.diagnosesDialogHelp')}</p>
          </div>
        </div>

        <div className="labord-divider" />

        {/* Tests / studies — same numbered treatment. */}
        <div className="labord-form labord-form--full">
          <div>
            <span className="labord-q">{imaging ? t('labOrder.studies') : t('labOrder.tests')}</span>
            {draft.tests.length > 0 && (
              <div className="labord-numbered">
                {draft.tests.map((test, i) => (
                  <div key={test.name} className="labord-numbered-row">
                    <span className="labord-num">{i + 1}.</span>
                    <span className="labord-numbered-body">
                      {test.name}
                      <span className="labord-check-meta">{test.specimen}</span>
                    </span>
                    <button
                      type="button"
                      className="labord-x"
                      onClick={() => removeTest(test.name)}
                      aria-label={t('labOrder.removeTest', { name: test.name })}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <Search
                className="w-4 h-4"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                aria-hidden
              />
              <input
                id="labord-dialog-tests"
                type="search"
                value={testQuery}
                onChange={e => setTestQuery(e.target.value)}
                placeholder={imaging ? t('labOrder.searchStudies') : t('labOrder.searchTests')}
                style={{ paddingInlineStart: 32 }}
                aria-label={imaging ? t('labOrder.searchStudies') : t('labOrder.searchTests')}
              />
            </div>
            {testMatches.length > 0 && (
              <div className="labord-picklist" style={{ marginTop: 6, maxHeight: 220 }}>
                {testMatches.map(entry => (
                  <button
                    key={entry.name}
                    type="button"
                    className="labord-pick"
                    onClick={() => { toggleTest(toOrderedTest(entry)); setTestQuery(''); }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="labord-pick-name">{entry.name}</span>
                      <span className="labord-pick-meta" style={{ display: 'block' }}>{entry.specimen}</span>
                    </span>
                    <span className="labord-pick-meta">
                      {entry.tier === 'basic' ? t('labOrder.tierBasic') : t('labOrder.tierSpecial')}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {testQuery.trim() && testMatches.length === 0 && <p className="labord-help">{t('labOrder.noTestsMatch')}</p>}
          </div>
        </div>
      </div>

      <div className="labord-footer">
        <span className="labord-footer-note">
          {canContinue
            ? t('labOrder.continueHint')
            : lockPatient ? t('labOrder.needTests') : t('labOrder.needPatientAndTests')}
        </span>
        <span />
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="labord-btn labord-btn--ghost" onClick={onCancel}>{t('action.cancel')}</button>
          <button type="button" className="labord-btn labord-btn--primary" onClick={onContinue} disabled={!canContinue}>
            {imaging ? t('labOrder.createImagingOrder') : t('labOrder.createLabOrder')}
          </button>
        </span>
      </div>
    </div>
  );
}
