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
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  const { t } = useTranslation();
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
            <small>{t('ui.setPerFacility')}</small>
          </div>
        </div>
        <div className="ehr-set-row">
          <div className="ehr-set-row-label">
            <b>{t('ui.noFacilityOnThisAccount')}</b>
            <span>
              {meta.title} {t('ui.appliesToOneHospitalAt')}
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
      showToast(t('msg.facilityPolicySavedItNow'), 'success');
    } catch {
      showToast(t('msg.facilityPolicyNotSavedTry'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const unavailable = <span className="ehr-set-locked"><Lock /> {t('ui.notAvailableYet')}</span>;
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
          <Row label={t('ui.triageScale')} hint={t('ui.acuityColoursAcrossEveryQueue')}>
            {unavailable}
          </Row>
          <Row label={t('ui.diagnosisCoding')} hint={t('ui.requiredOnEveryConsultation')}>
            {unavailable}
          </Row>
          <Row label={t('ui.targetDoorToClinician')} hint={t('ui.waitsPastThisAreHighlighted')}>
            <Choice
              label={t('ui.targetDoorToClinician')}
              value={String(draft.clinicalPolicy.doorToClinicianMinutes)}
              options={[
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '60', label: '60 min' },
              ]}
              onChange={v => patch({ clinicalPolicy: { ...draft.clinicalPolicy, doorToClinicianMinutes: Number(v) } })}
            />
          </Row>
          <Row label={t('ui.witnessRequiredForControlledSubstances')} hint={t('ui.aSecondStaffMemberCo')}>
            {unavailable}
          </Row>
          <Row label={t('ui.allergyHardStop')} hint={t('ui.aDocumentedAllergyBlocksThe')}>
            <Toggle
              label={t('ui.allergyHardStop')}
              on={draft.clinicalPolicy.allergyHardStop}
              onChange={on => patch({ clinicalPolicy: { ...draft.clinicalPolicy, allergyHardStop: on } })}
            />
          </Row>
          <Row label={t('ui.onSitePharmacy')} hint={t('ui.offForAFacilityWith')}>
            <Toggle
              label={t('ui.onSitePharmacy')}
              on={draft.clinicalPolicy.onSitePharmacy}
              onChange={on => patch({ clinicalPolicy: { ...draft.clinicalPolicy, onSitePharmacy: on } })}
            />
          </Row>
        </>
      )}

      {panel === 'reporting' && (
        <Row label={t('ui.reportingAutomation')} hint={t('ui.deadlinesCompletenessSignOffAutomatic')}>
          {unavailable}
        </Row>
      )}

      {panel === 'integrations' && (
        <>
          <Row label={t('ui.integrationSwitches')} hint={t('ui.dhis2PaymentsSmsLabDevices')}>
            {unavailable}
          </Row>
          <Row label={t('ui.offlineModePolicy')} hint={t('ui.blockingOfflineOperationRequiresA')}>
            {unavailable}
          </Row>
          <Row label={t('ui.syncFailureAlert')} hint={t('ui.minutesWithoutReplicationBeforeIt')}>
            <Choice
              label={t('ui.syncFailureAlert')}
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
