'use client';

/**
 * Facility policy panels — Clinical policy, Reporting & data, and the
 * integration switches inside Integrations & sync.
 *
 * These rows used to be part of the admin's design-11 spec, which persisted
 * every value to that browser's localStorage and was read by nothing. An
 * administrator could set "Allergy hard stop" or "Target door-to-clinician"
 * and no clinician, on any device, would ever see it — the definition of a
 * setting that does not apply.
 *
 * They are facility policy, so they now live in the `facility_settings` doc
 * (lib/settings/facility-settings.ts): one document per hospital in the
 * already-synced hospitals database, pushed into the global settings store,
 * and read by the queue, the prescribing checks, and the reporting jobs.
 * Changing one here changes it for everyone at that facility.
 *
 * The rows deliberately reuse the `ehr-set-*` classes of the surrounding
 * Settings page, so promoting them from local preference to facility policy
 * is invisible in the layout — only in whether it works.
 */
import { useEffect, useState, type ReactNode } from 'react';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useSettings, useSettingsContext } from '@/lib/settings/SettingsProvider';
import { saveFacilitySettings } from '@/lib/settings/settings-service';
import type { FacilitySettings } from '@/lib/settings/facility-settings';
import { Building2, FileText, Lock, RefreshCw, Stethoscope } from '@/components/icons/lucide';

export type FacilityPolicyPanelId = 'clinical' | 'reporting' | 'integrations';

const PANEL_META: Record<FacilityPolicyPanelId, { title: string; note: string; icon: typeof Stethoscope }> = {
  clinical: { title: 'Clinical policy', note: 'Inherited by every clinical role at this facility', icon: Stethoscope },
  reporting: { title: 'Reporting & data', note: 'DHIS2 and surveillance obligations', icon: FileText },
  integrations: { title: 'Integrations policy', note: 'Connections this facility relies on', icon: RefreshCw },
};

/** One labelled row, matching the personal-settings rows above it. */
function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="ehr-set-row">
      <div className="ehr-set-row-label">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      className={`ehr-set-toggle ${on ? 'is-on' : ''}`.trim()}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <b>{on ? 'On' : 'Off'}</b>
      <span><i /></span>
    </button>
  );
}

function Choice({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <Select className="ehr-set-select" value={value} aria-label={label} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

export default function FacilityPolicySections({ panel }: { panel: FacilityPolicyPanelId }) {
  const settings = useSettings();
  const { hospitalId, orgId } = useSettingsContext();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<FacilitySettings>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(settings); }, [settings]);

  const meta = PANEL_META[panel];
  const Icon = meta.icon;

  // No facility on the account (super-admin, org-admin, government): these are
  // per-facility policies, so there is nothing here to edit until a facility is
  // chosen. Saying so beats a form whose Save button writes nowhere.
  if (!hospitalId) {
    return (
      <section className="ehr-set-section">
        <div className="ehr-set-section-head">
          <span><Building2 /></span>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <h3>{meta.title}</h3>
            <small>Set per facility</small>
          </div>
        </div>
        <div className="ehr-set-row">
          <div className="ehr-set-row-label">
            <b>No facility on this account</b>
            <span>
              {meta.title} applies to one hospital at a time. Open Facility settings and choose
              the facility you want to configure.
            </span>
          </div>
        </div>
      </section>
    );
  }

  const patch = (next: Partial<FacilitySettings>) => setDraft(prev => ({ ...prev, ...next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = async () => {
    setSaving(true);
    try {
      await saveFacilitySettings(
        hospitalId,
        {
          clinicalPolicy: draft.clinicalPolicy,
          reporting: draft.reporting,
          reportingSchedule: draft.reportingSchedule,
          itOperations: draft.itOperations,
        },
        orgId,
        hospitalId,
      );
      showToast('Facility policy saved — it applies to everyone here', 'success');
    } catch {
      showToast('Could not save facility policy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasIntegration = (key: FacilitySettings['itOperations']['integrations'][number]) =>
    draft.itOperations.integrations.includes(key);
  const setIntegration = (key: FacilitySettings['itOperations']['integrations'][number], on: boolean) =>
    patch({
      itOperations: {
        ...draft.itOperations,
        integrations: on
          ? Array.from(new Set([...draft.itOperations.integrations, key]))
          : draft.itOperations.integrations.filter(i => i !== key),
      },
    });

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Icon /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{meta.title}</h3>
          <small>{meta.note}</small>
        </div>
        <button
          type="button"
          className="ehr-set-btn primary"
          style={{ minHeight: 30, padding: '0 13px', fontSize: 12 }}
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>

      {panel === 'clinical' && (
        <>
          <Row label="Triage scale" hint="Acuity colours across every queue at this facility">
            <Choice
              label="Triage scale"
              value={draft.clinicalPolicy.triageScale}
              options={[
                { value: '3-tier', label: '3-tier (Red/Yellow/Green)' },
                { value: '5-tier', label: '5-tier (ESI)' },
              ]}
              onChange={v => patch({ clinicalPolicy: { ...draft.clinicalPolicy, triageScale: v as '3-tier' | '5-tier' } })}
            />
          </Row>
          <Row label="Diagnosis coding" hint="Required on every consultation">
            <Choice
              label="Diagnosis coding"
              value={draft.clinicalPolicy.diagnosisCoding}
              options={[{ value: 'ICD-11', label: 'ICD-11' }, { value: 'ICD-10', label: 'ICD-10' }]}
              onChange={v => patch({ clinicalPolicy: { ...draft.clinicalPolicy, diagnosisCoding: v as 'ICD-11' | 'ICD-10' } })}
            />
          </Row>
          <Row label="Target door-to-clinician" hint="Waits past this are highlighted in every queue">
            <Choice
              label="Target door-to-clinician"
              value={String(draft.clinicalPolicy.doorToClinicianMinutes)}
              options={[
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '60', label: '60 min' },
              ]}
              onChange={v => patch({ clinicalPolicy: { ...draft.clinicalPolicy, doorToClinicianMinutes: Number(v) } })}
            />
          </Row>
          <Row label="Witness required for controlled substances" hint="A second staff member co-signs at prescribing and dispensing">
            <Toggle
              label="Witness required for controlled substances"
              on={draft.clinicalPolicy.requireControlledSubstanceWitness}
              onChange={on => patch({ clinicalPolicy: { ...draft.clinicalPolicy, requireControlledSubstanceWitness: on } })}
            />
          </Row>
          <Row label="Allergy hard stop" hint="A documented allergy blocks the order instead of warning about it">
            <Toggle
              label="Allergy hard stop"
              on={draft.clinicalPolicy.allergyHardStop}
              onChange={on => patch({ clinicalPolicy: { ...draft.clinicalPolicy, allergyHardStop: on } })}
            />
          </Row>
        </>
      )}

      {panel === 'reporting' && (
        <>
          <Row label="IDSR weekly report" hint="Submission day">
            <Choice
              label="IDSR weekly report"
              value={draft.reportingSchedule.idsrDay}
              options={[
                { value: 'Monday', label: 'Monday' },
                { value: 'Friday', label: 'Friday' },
                { value: 'Sunday', label: 'Sunday' },
              ]}
              onChange={v => patch({ reportingSchedule: { ...draft.reportingSchedule, idsrDay: v as 'Monday' | 'Friday' | 'Sunday' } })}
            />
          </Row>
          <Row label="HMIS monthly report" hint="Submission deadline">
            <Choice
              label="HMIS monthly report"
              value={String(draft.reporting.monthlyDeadlineDay)}
              options={[
                { value: '1', label: '1st of the month' },
                { value: '5', label: '5th of the month' },
                { value: '10', label: '10th of the month' },
              ]}
              onChange={v => patch({ reporting: { ...draft.reporting, monthlyDeadlineDay: Number(v) } })}
            />
          </Row>
          <Row label="Require completeness sign-off" hint="An administrator confirms the dataset before it goes out">
            <Toggle
              label="Require completeness sign-off"
              on={draft.reporting.requireCompletenessSignoff}
              onChange={on => patch({ reporting: { ...draft.reporting, requireCompletenessSignoff: on } })}
            />
          </Row>
          <Row label="Auto-submit when complete" hint="Requires 100% data quality checks">
            <Toggle
              label="Auto-submit when complete"
              on={draft.reportingSchedule.autoSubmitWhenComplete}
              onChange={on => patch({ reportingSchedule: { ...draft.reportingSchedule, autoSubmitWhenComplete: on } })}
            />
          </Row>
          <Row label="Alert on missed deadlines" hint="Notifies admins and the county">
            <Toggle
              label="Alert on missed deadlines"
              on={draft.reportingSchedule.alertOnMissedDeadline}
              onChange={on => patch({ reportingSchedule: { ...draft.reportingSchedule, alertOnMissedDeadline: on } })}
            />
          </Row>
          <Row label="Full database export" hint="Requires Ministry authorisation code">
            <span className="ehr-set-locked"><Lock /> Restricted</span>
          </Row>
        </>
      )}

      {panel === 'integrations' && (
        <>
          <Row label="DHIS2 national reporting" hint="HMIS and IDSR datasets">
            <Toggle label="DHIS2 national reporting" on={hasIntegration('dhis2')} onChange={on => setIntegration('dhis2', on)} />
          </Row>
          <Row label="m-Gurush mobile money" hint="Payment confirmations post to billing">
            <Toggle label="m-Gurush mobile money" on={hasIntegration('payments')} onChange={on => setIntegration('payments', on)} />
          </Row>
          <Row label="SMS gateway" hint="Patient reminders and critical-result alerts">
            <Toggle label="SMS gateway" on={hasIntegration('sms')} onChange={on => setIntegration('sms', on)} />
          </Row>
          <Row label="Lab device interfaces" hint="Analyser results posted straight to the worklist">
            <Toggle label="Lab device interfaces" on={hasIntegration('lab_devices')} onChange={on => setIntegration('lab_devices', on)} />
          </Row>
          <Row label="Barcode printers" hint="Sample and medication labels">
            <Toggle label="Barcode printers" on={hasIntegration('barcode_printers')} onChange={on => setIntegration('barcode_printers', on)} />
          </Row>
          <Row label="Offline mode" hint="Staff may keep working through a connectivity outage">
            <Toggle
              label="Offline mode"
              on={draft.itOperations.allowOfflineMode}
              onChange={on => patch({ itOperations: { ...draft.itOperations, allowOfflineMode: on } })}
            />
          </Row>
          <Row label="Sync failure alert" hint="Minutes without replication before IT is notified">
            <Choice
              label="Sync failure alert"
              value={String(draft.itOperations.syncFailureAlertMinutes)}
              options={[
                { value: '15', label: 'After 15 min' },
                { value: '30', label: 'After 30 min' },
                { value: '60', label: 'After 1 hour' },
              ]}
              onChange={v => patch({ itOperations: { ...draft.itOperations, syncFailureAlertMinutes: Number(v) } })}
            />
          </Row>
        </>
      )}
    </section>
  );
}
