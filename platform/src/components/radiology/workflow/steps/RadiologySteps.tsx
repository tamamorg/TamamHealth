'use client';

/**
 * The six reading-room steps. Each renders the same way as the lab bench's:
 * what was captured (once the study has moved past it) or the form plus its one
 * action (when the study is sitting on it). They share a file because each is
 * small and they are only ever rendered by RadiologyWorkflowPanel.
 */

import { AlertTriangle, CheckCircle2, ShieldAlert } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { formatDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import {
  CONTRAST_OPTIONS,
  isIonising,
  MODALITIES,
  needsImplantCheck,
  REPEAT_REASONS,
  studyLine,
} from '../radiology-workflow-types';
import type { RadiologyWorkflowController } from '../useRadiologyWorkflow';

export function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <span className="labord-field-label">{label}</span>
      <span className="labord-field-value">{value || '—'}</span>
    </div>
  );
}

/** Step 1 — the requisition as it arrived. Read-only by definition. */
export function OrderStep({ study }: { study: LabResultDoc }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.requisition')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('imgFlow.study')} value={study.testName} />
            <Field label={t('imgFlow.modality')} value={study.modality} />
            <Field label={t('imgFlow.bodyRegion')} value={study.bodyRegion} />
            <Field label={t('imgFlow.laterality')} value={study.laterality} />
            <Field label={t('labOrder.orderingProvider')} value={study.orderedBy} />
            <Field label={t('imgFlow.orderedAt')} value={study.orderedAt ? formatDateTime(study.orderedAt) : '—'} />
            <Field
              label={t('labOrder.priority')}
              value={study.priority === 'stat' ? t('lab.priorityStat') : study.priority === 'urgent' ? t('appointments.priorityUrgent') : t('appointments.priorityRoutine')}
            />
            <Field label={t('imgFlow.accession')} value={study.accessionNumber} />
          </div>
        </div>
      </div>

      {/* The clinical question is the whole point of a report — a study read
          without it is a description looking for a reader. */}
      {(study.indications?.length || study.clinicalNotes) && (
        <div className="labord-section">
          <div className="labord-section-head">{t('imgFlow.clinicalQuestion')}</div>
          <div className="labord-section-body">
            {study.indications?.length ? (
              <div className="labord-chip-row" style={{ marginBottom: study.clinicalNotes ? 10 : 0 }}>
                {study.indications.map(indication => (
                  <span key={indication.code} className="labord-chip"><code>{indication.code}</code> {indication.title}</span>
                ))}
              </div>
            ) : null}
            {study.clinicalNotes && <p className="labord-help" style={{ margin: 0 }}>{study.clinicalNotes}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 2 — book the modality slot. */
export function ScheduleStep({ study, ctrl }: { study: LabResultDoc; ctrl: RadiologyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 1;
  const repeated = ctrl.stage === 'rejected_needs_recollection';

  return (
    <div>
      {repeated && (
        <div className="labord-section">
          <div className="labord-section-head labord-required">{t('imgFlow.repeatHead')}</div>
          <div className="labord-section-body">
            <Field label={t('imgFlow.repeatReason')} value={study.repeatReason} />
            <p className="labord-help" style={{ margin: '8px 0 0' }}>{t('imgFlow.repeatHelp')}</p>
          </div>
        </div>
      )}

      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.scheduleHead')}</div>
        <div className="labord-section-body">
          {done && !repeated ? (
            <div className="labord-grid-2">
              <Field label={t('imgFlow.accession')} value={study.accessionNumber} />
              <Field label={t('imgFlow.modality')} value={study.modality} />
              <Field label={t('imgFlow.bodyRegion')} value={study.bodyRegion} />
              <Field label={t('imgFlow.contrast')} value={study.contrast} />
              <Field label={t('imgFlow.scheduledAt')} value={study.studyScheduledAt ? formatDateTime(study.studyScheduledAt) : '—'} />
              <Field label={t('imgFlow.scheduledBy')} value={study.studyScheduledBy} />
            </div>
          ) : (
            <div className="labord-form">
              <label className="labord-field-label" htmlFor="img-accession">{t('imgFlow.accession')}</label>
              <input
                id="img-accession"
                className="labord-x"
                value={ctrl.scheduleDraft.accessionNumber}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, accessionNumber: e.target.value })}
              />

              <label className="labord-field-label" htmlFor="img-modality">{t('imgFlow.modality')}</label>
              <Select
                id="img-modality"
                value={ctrl.scheduleDraft.modality}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, modality: e.target.value })}
              >
                <option value="">{t('imgFlow.modalityNone')}</option>
                {MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>

              <label className="labord-field-label" htmlFor="img-region">{t('imgFlow.bodyRegion')}</label>
              <input
                id="img-region"
                className="labord-x"
                value={ctrl.scheduleDraft.bodyRegion}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, bodyRegion: e.target.value })}
                placeholder={t('imgFlow.bodyRegionPlaceholder')}
              />

              <label className="labord-field-label" htmlFor="img-laterality">{t('imgFlow.laterality')}</label>
              <Select
                id="img-laterality"
                value={ctrl.scheduleDraft.laterality}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, laterality: e.target.value as typeof ctrl.scheduleDraft.laterality })}
              >
                <option value="">{t('imgFlow.lateralityNone')}</option>
                <option value="left">{t('imgFlow.lateralityLeft')}</option>
                <option value="right">{t('imgFlow.lateralityRight')}</option>
                <option value="bilateral">{t('imgFlow.lateralityBilateral')}</option>
              </Select>

              <label className="labord-field-label" htmlFor="img-contrast">{t('imgFlow.contrast')}</label>
              <Select
                id="img-contrast"
                value={ctrl.scheduleDraft.contrast}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, contrast: e.target.value as typeof ctrl.scheduleDraft.contrast })}
              >
                {CONTRAST_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>

              <label className="labord-field-label" htmlFor="img-slot">{t('imgFlow.scheduledAt')}</label>
              <input
                id="img-slot"
                className="labord-x"
                type="datetime-local"
                value={ctrl.scheduleDraft.scheduledAt.slice(0, 16)}
                onChange={e => ctrl.setScheduleDraft({ ...ctrl.scheduleDraft, scheduledAt: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Step 3 — the pre-scan screening. */
export function SafetyStep({ study, ctrl }: { study: LabResultDoc; ctrl: RadiologyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 2;
  const modality = ctrl.scheduleDraft.modality || study.modality;
  const contrast = ctrl.scheduleDraft.contrast !== 'none';

  if (done) {
    return (
      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.safetyDoneHead')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('imgFlow.pregnancy')} value={study.safetyChecks?.pregnancyStatus} />
            <Field label={t('imgFlow.contrastAllergy')} value={study.safetyChecks?.contrastAllergy ? t('action.yes') : t('action.no')} />
            <Field label={t('imgFlow.implants')} value={study.safetyChecks?.implantsOrDevices ? t('action.yes') : t('action.no')} />
            <Field label={t('imgFlow.consent')} value={study.safetyChecks?.consentGiven ? t('action.yes') : t('action.no')} />
            <Field label={t('imgFlow.checkedBy')} value={study.safetyChecks?.checkedBy} />
            <Field label={t('imgFlow.checkedAt')} value={study.safetyChecks?.checkedAt ? formatDateTime(study.safetyChecks.checkedAt) : '—'} />
          </div>
          {study.safetyChecks?.note && <p className="labord-help" style={{ margin: '10px 0 0' }}>{study.safetyChecks.note}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('imgFlow.safetyHead')}</div>
      <div className="labord-section-body">
        {/* Only the questions this modality actually raises. A knee ultrasound
            does not need a pregnancy answer, and asking for one trains the
            radiographer to click past the screen that matters. */}
        {isIonising(modality) && (
          <div className="labord-form">
            <label className="labord-field-label" htmlFor="img-pregnancy">{t('imgFlow.pregnancy')}</label>
            <Select
              id="img-pregnancy"
              value={ctrl.safetyDraft.pregnancyStatus}
              onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, pregnancyStatus: e.target.value as typeof ctrl.safetyDraft.pregnancyStatus })}
            >
              <option value="not_applicable">{t('imgFlow.pregnancyNA')}</option>
              <option value="excluded">{t('imgFlow.pregnancyExcluded')}</option>
              <option value="possible">{t('imgFlow.pregnancyPossible')}</option>
              <option value="confirmed">{t('imgFlow.pregnancyConfirmed')}</option>
            </Select>
          </div>
        )}

        <div className="labord-check-grid" style={{ marginTop: 10 }}>
          {contrast && (
            <label className={`labord-check ${ctrl.safetyDraft.contrastAllergy ? 'labord-check--on' : ''}`}>
              <input
                type="checkbox"
                checked={ctrl.safetyDraft.contrastAllergy}
                onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, contrastAllergy: e.target.checked })}
              />
              <span>{t('imgFlow.contrastAllergy')}</span>
            </label>
          )}
          {contrast && (
            <label className={`labord-check ${ctrl.safetyDraft.renalRisk ? 'labord-check--on' : ''}`}>
              <input
                type="checkbox"
                checked={ctrl.safetyDraft.renalRisk}
                onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, renalRisk: e.target.checked })}
              />
              <span>{t('imgFlow.renalRisk')}</span>
            </label>
          )}
          {needsImplantCheck(modality) && (
            <label className={`labord-check ${ctrl.safetyDraft.implantsOrDevices ? 'labord-check--on' : ''}`}>
              <input
                type="checkbox"
                checked={ctrl.safetyDraft.implantsOrDevices}
                onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, implantsOrDevices: e.target.checked })}
              />
              <span>{t('imgFlow.implants')}</span>
            </label>
          )}
          <label className={`labord-check ${ctrl.safetyDraft.consentGiven ? 'labord-check--on' : ''}`}>
            <input
              type="checkbox"
              checked={ctrl.safetyDraft.consentGiven}
              onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, consentGiven: e.target.checked })}
            />
            <span>{t('imgFlow.consent')}</span>
          </label>
        </div>

        <div className="labord-form" style={{ marginTop: 10 }}>
          <label className="labord-field-label" htmlFor="img-safety-note">{t('imgFlow.note')}</label>
          <input
            id="img-safety-note"
            className="labord-x"
            value={ctrl.safetyDraft.note}
            onChange={e => ctrl.setSafetyDraft({ ...ctrl.safetyDraft, note: e.target.value })}
          />
        </div>

        {/* A blocker is not a warning — the scan does not proceed on it. */}
        {ctrl.safetyBlockers.map(key => (
          <p key={key} className="labord-required" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldAlert className="w-4 h-4" aria-hidden /> {t(key)}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Step 4 — perform the study. */
export function AcquireStep({ study, ctrl }: { study: LabResultDoc; ctrl: RadiologyWorkflowController }) {
  const { t } = useTranslation();
  const done = ctrl.doneThrough >= 3;

  if (done) {
    return (
      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.acquiredHead')}</div>
        <div className="labord-section-body">
          <div className="labord-grid-2">
            <Field label={t('imgFlow.acquiredBy')} value={study.acquiredBy} />
            <Field label={t('imgFlow.acquiredAt')} value={study.acquiredAt ? formatDateTime(study.acquiredAt) : '—'} />
            <Field label={t('imgFlow.technique')} value={study.technique} />
            <Field label={t('imgFlow.imageCount')} value={study.imageCount} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.acquireHead')}</div>
        <div className="labord-section-body">
          <div className="labord-form">
            <label className="labord-field-label" htmlFor="img-technique">{t('imgFlow.technique')}</label>
            <input
              id="img-technique"
              className="labord-x"
              value={ctrl.acquireDraft.technique}
              onChange={e => ctrl.setAcquireDraft({ ...ctrl.acquireDraft, technique: e.target.value })}
              placeholder={t('imgFlow.techniquePlaceholder')}
            />
            <label className="labord-field-label" htmlFor="img-count">{t('imgFlow.imageCount')}</label>
            <input
              id="img-count"
              className="labord-x"
              type="number"
              min={0}
              value={ctrl.acquireDraft.imageCount}
              onChange={e => ctrl.setAcquireDraft({ ...ctrl.acquireDraft, imageCount: Number(e.target.value) })}
            />
            <p className="labord-help" style={{ margin: 0 }}>{t('imgFlow.filesHelp')}</p>
          </div>
        </div>
      </div>

      <div className="labord-section">
        <div className="labord-section-head">{t('imgFlow.repeatSectionHead')}</div>
        <div className="labord-section-body">
          <div className="labord-form">
            <label className="labord-field-label" htmlFor="img-repeat">{t('imgFlow.repeatReason')}</label>
            <Select
              id="img-repeat"
              value={ctrl.acquireDraft.repeatReason}
              onChange={e => ctrl.setAcquireDraft({ ...ctrl.acquireDraft, repeatReason: e.target.value })}
            >
              <option value="">{t('imgFlow.repeatReasonNone')}</option>
              {REPEAT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </Select>
            <p className="labord-help" style={{ margin: 0 }}>{t('imgFlow.repeatSectionHelp')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Step 5 — read the study and file the report. */
export function ReportStep({ study, ctrl }: { study: LabResultDoc; ctrl: RadiologyWorkflowController }) {
  const { t } = useTranslation();
  const filed = ctrl.doneThrough >= 4;

  return (
    <div className="labord-section">
      <div className="labord-section-head">{filed ? t('imgFlow.reportedHead') : t('imgFlow.reportHead')}</div>
      <div className="labord-section-body">
        {filed ? (
          <>
            <div className="labord-grid-2">
              <Field label={t('imgFlow.reportedBy')} value={study.reportedBy} />
              <Field label={t('imgFlow.reportedAt')} value={study.reportedAt ? formatDateTime(study.reportedAt) : '—'} />
            </div>
            <div className="labord-divider" />
            <Field label={t('imgFlow.findings')} value={study.findings} />
            <div style={{ marginTop: 10 }}>
              <Field label={t('imgFlow.impression')} value={study.impression || study.result} />
            </div>
            {study.critical && (
              <p className="labord-required" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle className="w-4 h-4" aria-hidden /> {t('imgFlow.criticalFiled')}
              </p>
            )}
          </>
        ) : (
          <div className="labord-form labord-form--full">
            <label className="labord-field-label" htmlFor="img-findings">{t('imgFlow.findings')}</label>
            <textarea
              id="img-findings"
              className="labord-x"
              rows={5}
              value={ctrl.reportDraft.findings}
              onChange={e => ctrl.setReportDraft({ ...ctrl.reportDraft, findings: e.target.value })}
              placeholder={t('imgFlow.findingsPlaceholder')}
            />
            <label className="labord-field-label" htmlFor="img-impression">{t('imgFlow.impression')}</label>
            <textarea
              id="img-impression"
              className="labord-x"
              rows={3}
              value={ctrl.reportDraft.impression}
              onChange={e => ctrl.setReportDraft({ ...ctrl.reportDraft, impression: e.target.value })}
              placeholder={t('imgFlow.impressionPlaceholder')}
            />
            <div className="labord-check-grid">
              <label className={`labord-check ${ctrl.reportDraft.abnormal ? 'labord-check--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={ctrl.reportDraft.abnormal}
                  onChange={e => ctrl.setReportDraft({ ...ctrl.reportDraft, abnormal: e.target.checked })}
                />
                <span>{t('imgFlow.abnormal')}</span>
              </label>
              <label className={`labord-check ${ctrl.reportDraft.critical ? 'labord-check--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={ctrl.reportDraft.critical}
                  onChange={e => ctrl.setReportDraft({ ...ctrl.reportDraft, critical: e.target.checked, abnormal: e.target.checked || ctrl.reportDraft.abnormal })}
                />
                <span>{t('imgFlow.critical')}</span>
              </label>
            </div>
            <p className="labord-help" style={{ margin: 0 }}>{t('imgFlow.criticalHelp')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Step 6 — the report, and the loop back to the clinician who asked. */
export function ReleaseStep({ study, ctrl }: { study: LabResultDoc; ctrl: RadiologyWorkflowController }) {
  const { t } = useTranslation();

  return (
    <div className="labord-section">
      <div className="labord-section-head">{t('imgFlow.releaseHead')}</div>
      <div className="labord-section-body">
        <div className="labord-grid-2">
          <Field label={t('imgFlow.study')} value={studyLine(study)} />
          <Field label={t('imgFlow.stage')} value={t(`labFlow.stage_${ctrl.stage}`)} />
          <Field label={t('labOrder.orderingProvider')} value={study.orderedBy} />
          <Field label={t('imgFlow.reportedBy')} value={study.reportedBy} />
        </div>
        <div className="labord-divider" />
        <Field label={t('imgFlow.impression')} value={study.impression || study.result} />
        <p className="labord-help" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {ctrl.stage === 'communicated_to_patient'
            ? <><CheckCircle2 className="w-4 h-4" aria-hidden /> {t('imgFlow.loopClosed')}</>
            : t('imgFlow.releaseHelp')}
        </p>
      </div>
    </div>
  );
}
