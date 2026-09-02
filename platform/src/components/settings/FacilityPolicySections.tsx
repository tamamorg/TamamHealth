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
        panel === 'clinical'
          ? { clinicalPolicy: draft.clinicalPolicy }
          : panel === 'integrations'
            ? { itOperations: { ...settings.itOperations, syncFailureAlertMinutes: draft.itOperations.syncFailureAlertMinutes } }
            : {},
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

  const unavailable = <span className="ehr-set-locked"><Lock /> Not available yet</span>;
  const canSave = panel !== 'reporting';

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Icon /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{meta.title}</h3>
          <small>{meta.note}</small>
        </div>
        {canSave && <button
          type="button"
          className="ehr-set-btn primary"
          style={{ minHeight: 30, padding: '0 13px', fontSize: 12 }}
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save policy'}
        </button>}
      </div>

      {panel === 'clinical' && (
        <>
          <Row label="Triage scale" hint="Acuity colours across every queue at this facility">
            {unavailable}
          </Row>
          <Row label="Diagnosis coding" hint="Required on every consultation">
            {unavailable}
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
            {unavailable}
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
        <Row label="Reporting automation" hint="Deadlines, completeness sign-off, automatic submission, and missed-deadline alerts">
          {unavailable}
        </Row>
      )}

      {panel === 'integrations' && (
        <>
          <Row label="Integration switches" hint="DHIS2, payments, SMS, lab devices, and barcode printers">
            {unavailable}
          </Row>
          <Row label="Offline mode policy" hint="Blocking offline operation requires a complete continuity and emergency-access design">
            {unavailable}
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
