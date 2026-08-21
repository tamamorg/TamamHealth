'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useToast } from '@/components/Toast';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  Settings, Building2, Stethoscope, FlaskConical, Wallet, ShieldCheck,
  Trash2, Plus, Save, X, Clock, ClipboardCheck, Database, Server,
  CalendarClock,
} from '@/components/icons/lucide';
import { useSettings, useSettingsContext } from '@/lib/settings/SettingsProvider';
import { getFacilitySettings, saveFacilitySettings } from '@/lib/settings/settings-service';
import {
  type FacilitySettings,
  type EncounterStationKey,
  type LabTestDef,
  type PaymentMethodKey,
  type PatientProfileKey,
  type PayorKey,
  PAYMENT_METHOD_LABELS,
  PAYOR_LABELS,
  ALL_PAYMENT_METHODS,
  ALL_PAYORS,
} from '@/lib/settings/facility-settings';
import Select from '@/components/Select';
import VisitTypesSection from '@/components/settings/VisitTypesSection';

const STATION_LABELS: Record<EncounterStationKey, string> = {
  registration: 'Registration',
  triage: 'Triage',
  rooming: 'Rooming',
  consultation: 'Consultation',
  lab: 'Laboratory',
  radiology: 'Radiology',
  pharmacy: 'Pharmacy',
  cashier: 'Cashier',
  clinic_checkout: 'Clinic checkout',
  facility_checkout: 'Facility checkout',
};

const PATIENT_PROFILE_LABELS: Record<PatientProfileKey, string> = {
  child: 'Child',
  adult: 'Adult',
  pregnant: 'Pregnant',
  postnatal: 'Postnatal',
  emergency: 'Emergency',
};

const CHECKOUT_GATE_LABELS: Record<string, string> = {
  all_clinic_visits_closed: 'All clinic visits closed',
  prescriptions_dispensed: 'Prescriptions dispensed or deferred',
  critical_labs_reviewed: 'Critical labs reviewed',
  in_clinic_procedures_complete: 'Procedures complete',
  required_documentation_generated: 'Required documentation generated',
  payment_status_determined: 'Payment status determined',
  pending_items_flagged: 'Pending items flagged',
};

const ALL_STATIONS = Object.keys(STATION_LABELS) as EncounterStationKey[];
const ALL_PATIENT_PROFILES = Object.keys(PATIENT_PROFILE_LABELS) as PatientProfileKey[];
const ALL_CHECKOUT_GATES = Object.keys(CHECKOUT_GATE_LABELS);
const ALL_REPORTING_SOURCES = ['encounters', 'diagnoses', 'lab_results', 'pharmacy_dispenses', 'vital_events', 'payments'] as const;
const REPORTING_SOURCE_LABELS: Record<(typeof ALL_REPORTING_SOURCES)[number], string> = {
  encounters: 'Encounters',
  diagnoses: 'Diagnoses',
  lab_results: 'Lab results',
  pharmacy_dispenses: 'Pharmacy dispenses',
  vital_events: 'Vital events',
  payments: 'Payments',
};
const ALL_INTEGRATIONS = ['dhis2', 'sms', 'email', 'payments', 'lab_devices', 'barcode_printers'] as const;
const INTEGRATION_LABELS: Record<(typeof ALL_INTEGRATIONS)[number], string> = {
  dhis2: 'DHIS2',
  sms: 'SMS',
  email: 'Email',
  payments: 'Payment provider',
  lab_devices: 'Lab devices',
  barcode_printers: 'Barcode / label printers',
};

// `embedded` renders just the settings body (no TopBar / page-container) so the
// main Settings page can host it as its "Facility" tab. The standalone route
// (default, embedded=false) still renders the full page.
export function FacilitySettingsView({ embedded = false }: { embedded?: boolean } = {}) {
  const { showToast } = useToast();
  const { hospitalId, orgId } = useSettingsContext();
  const settings = useSettings();
  // Facility picker for multi-facility admins (already role/org-scoped).
  const { hospitals: pickerHospitals } = useHospitals();
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedSettings, setSelectedSettings] = useState<FacilitySettings | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const effectiveHospitalId = hospitalId || selectedHospitalId;
  const effectiveSettings = hospitalId ? settings : (selectedSettings || settings);
  const selectedHospital = pickerHospitals.find(h => h._id === effectiveHospitalId);

  useEffect(() => {
    if (hospitalId || !selectedHospitalId) {
      setSelectedSettings(null);
      return;
    }
    let cancelled = false;
    setLoadingSelected(true);
    getFacilitySettings(selectedHospitalId)
      .then(next => { if (!cancelled) setSelectedSettings(next); })
      .catch(() => { if (!cancelled) setSelectedSettings(settings); })
      .finally(() => { if (!cancelled) setLoadingSelected(false); });
    return () => { cancelled = true; };
  }, [hospitalId, selectedHospitalId, settings]);

  // Local editable copy, re-synced whenever the persisted settings change.
  const [draft, setDraft] = useState<FacilitySettings>(effectiveSettings);
  useEffect(() => { setDraft(effectiveSettings); }, [effectiveSettings]);

  // Per-section saving flags so each card's button has its own pending state.
  const [saving, setSaving] = useState<string | null>(null);

  const saveSection = async (patch: Partial<FacilitySettings>, section: string) => {
    if (!effectiveHospitalId) return;
    setSaving(section);
    try {
      // 4th arg: only let the save touch the global store when this IS the
      // session's own facility — see saveFacilitySettings.
      const saved = await saveFacilitySettings(effectiveHospitalId, patch, orgId, hospitalId);
      if (!hospitalId) setSelectedSettings(saved);
      setDraft(saved);
      showToast('Facility settings saved', 'success');
    } catch {
      showToast('Could not save settings', 'error');
    } finally {
      setSaving(null);
    }
  };

  // ── No-facility picker (super-admin / org-admin / government) ──────────────
  // These accounts aren't tied to one facility, so instead of a dead end,
  // list the facilities they govern and open each one's Settings tab.
  if (!effectiveHospitalId) {
    const guard = (
      <div className="ehr-set-section fs-section" style={{ marginTop: embedded ? 0 : 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <Building2 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Choose a facility to configure
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Your account governs multiple facilities — workflow settings are per facility.
          </p>
        </div>
        {pickerHospitals.length === 0 ? (
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            No facilities registered yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ maxWidth: 720, margin: '0 auto' }}>
            {pickerHospitals.map(h => (
              embedded ? (
                <button
                  key={h._id}
                  type="button"
                  className="fs-facility-tile"
                  onClick={() => setSelectedHospitalId(h._id)}
                >
                  <strong>{h.name}</strong>
                  <span>{[h.town || h.state, h.facilityType?.replace(/_/g, ' ')].filter(Boolean).join(' · ') || 'Facility'}</span>
                </button>
              ) : (
                <Link key={h._id} href={`/hospitals/${h._id}/manage?tab=settings`} className="fs-facility-tile">
                  <strong>{h.name}</strong>
                  <span>{[h.town || h.state, h.facilityType?.replace(/_/g, ' ')].filter(Boolean).join(' · ') || 'Facility'}</span>
                </Link>
              )
            ))}
          </div>
        )}
        {embedded && pickerHospitals.length > 0 && (
          <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
            Facility-specific workflow settings stay inside Settings. Choose a facility to load and edit its operational details.
          </p>
        )}
      </div>
    );
    return embedded ? guard : (
      <main className="page-container page-enter">
        <div className="dash-card overflow-hidden mb-4">
          <EhrListHeader title="Facility Settings" />
        </div>
        {guard}
      </main>
    );
  }

  const content = (
    <>
      <div className="fs-settings-stack">
          {!hospitalId && (
            <section className="ehr-set-section fs-section">
              <div className="ehr-set-section-head">
                <span><Building2 /></span>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <h3>{selectedHospital?.name || 'Selected facility'}</h3>
                  <small>{selectedHospital ? [selectedHospital.town || selectedHospital.state, selectedHospital.facilityType?.replace(/_/g, ' ')].filter(Boolean).join(' · ') : 'Facility settings'}</small>
                </div>
                <button type="button" className="ehr-set-btn" onClick={() => setSelectedHospitalId('')}>
                  Change facility
                </button>
              </div>
              {loadingSelected && (
                <div className="fs-section-body">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading facility settings…</p>
                </div>
              )}
            </section>
          )}

          {!loadingSelected && (
          <>
          {/* ── General ──────────────────────────────────────────────── */}
          <SectionCard icon={Settings} title="General">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Currency">
                <input
                  className="fs-input"
                  value={draft.currency}
                  onChange={e => setDraft({ ...draft, currency: e.target.value })}
                  placeholder="e.g. SSP"
                />
              </Field>
              <Field label="Hospital number prefix">
                <input
                  className="fs-input"
                  value={draft.hospitalNumberPrefix}
                  onChange={e => setDraft({ ...draft, hospitalNumberPrefix: e.target.value })}
                  placeholder="e.g. TAB"
                />
              </Field>
            </div>
            {/* Display language is set per-user (Settings → Preferences) and per-org
                (org-admin); a separate facility-level language was redundant and is
                intentionally not shown here. */}
            <SaveBar
              saving={saving === 'general'}
              onSave={() => saveSection({
                currency: draft.currency,
                hospitalNumberPrefix: draft.hospitalNumberPrefix,
              }, 'general')}
            />
          </SectionCard>

          {/* ── Visit types ──────────────────────────────────────────────
              Sits high on the page on purpose: it is the one setting the
              booking screen reads on every appointment, and the durations here
              decide what times that screen can even offer. */}
          <SectionCard icon={CalendarClock} title="Visit types &amp; booking">
            <VisitTypesSection facilityId={effectiveHospitalId} />
          </SectionCard>

          {/* ── Clinical ─────────────────────────────────────────────── */}
          <SectionCard icon={Stethoscope} title="Clinical">
            <p className="fs-grouplabel">Result-review SLA</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Critical results — review within (hours)">
                <input
                  type="number" min={0} className="fs-input"
                  value={draft.resultReviewSLA.criticalHours}
                  onChange={e => setDraft({ ...draft, resultReviewSLA: { ...draft.resultReviewSLA, criticalHours: Number(e.target.value) } })}
                />
              </Field>
              <Field label="Routine results — review within (hours)">
                <input
                  type="number" min={0} className="fs-input"
                  value={draft.resultReviewSLA.routineHours}
                  onChange={e => setDraft({ ...draft, resultReviewSLA: { ...draft.resultReviewSLA, routineHours: Number(e.target.value) } })}
                />
              </Field>
            </div>
            <SaveBar
              saving={saving === 'clinical'}
              onSave={() => saveSection({
                resultReviewSLA: draft.resultReviewSLA,
              }, 'clinical')}
            />
          </SectionCard>

          {/* ── Lab Catalog ──────────────────────────────────────────── */}
          <SectionCard icon={FlaskConical} title="Lab Catalog">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 520 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                    {['Test name', 'Tier', 'Specimen', ''].map(h => (
                      <th key={h} className="px-3 py-2 text-start text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.labCatalog.map((test, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-3 py-2">
                        <input
                          className="fs-input"
                          value={test.name}
                          onChange={e => updateLabRow(draft, setDraft, i, { name: e.target.value })}
                          placeholder="e.g. Full Blood Count"
                        />
                      </td>
                      <td className="px-3 py-2" style={{ width: 150 }}>
                        <Select
                          className="fs-input"
                          value={test.tier}
                          onChange={e => updateLabRow(draft, setDraft, i, { tier: e.target.value as LabTestDef['tier'] })}
                        >
                          <option value="basic">Basic</option>
                          <option value="special">Special</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2" style={{ width: 180 }}>
                        <input
                          className="fs-input"
                          value={test.specimen}
                          onChange={e => updateLabRow(draft, setDraft, i, { specimen: e.target.value })}
                          placeholder="e.g. Blood"
                        />
                      </td>
                      <td className="px-3 py-2 text-end" style={{ width: 48 }}>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, labCatalog: draft.labCatalog.filter((_, idx) => idx !== i) })}
                          className="p-1.5 rounded-lg"
                          style={{ color: 'var(--color-danger-text)' }}
                          aria-label="Remove test"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {draft.labCatalog.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No tests yet. Add the first investigation.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, labCatalog: [...draft.labCatalog, { name: '', tier: 'basic', specimen: '' }] })}
              className="btn btn-secondary inline-flex items-center gap-2 mt-3"
            >
              <Plus className="w-4 h-4" /> Add test
            </button>
            <SaveBar
              saving={saving === 'lab'}
              onSave={() => saveSection({
                labCatalog: draft.labCatalog.filter(t => t.name.trim()),
              }, 'lab')}
            />
          </SectionCard>

          {/* ── Operations ───────────────────────────────────────────── */}
          <SectionCard icon={Building2} title="Operations">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TagListEditor
                label="Departments / clinics"
                placeholder="e.g. General Medicine"
                values={draft.departments}
                onChange={departments => setDraft({ ...draft, departments })}
              />
              <TagListEditor
                label="Rooms / bays"
                placeholder="e.g. Room 1"
                values={draft.rooms}
                onChange={rooms => setDraft({ ...draft, rooms })}
              />
            </div>
            <SaveBar
              saving={saving === 'operations'}
              onSave={() => saveSection({
                departments: draft.departments.filter(Boolean),
                rooms: draft.rooms.filter(Boolean),
              }, 'operations')}
            />
          </SectionCard>

          {/* ── Workflow ────────────────────────────────────────────── */}
          <SectionCard icon={ClipboardCheck} title="Workflow">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="fs-grouplabel">Default station sequence</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ALL_STATIONS.map(key => (
                    <CheckRow
                      key={key}
                      label={STATION_LABELS[key]}
                      checked={draft.stationSequence.includes(key)}
                      onToggle={() => toggleKey<EncounterStationKey>(draft.stationSequence, key, v => setDraft({ ...draft, stationSequence: orderByReference(v, ALL_STATIONS) }))}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="fs-grouplabel">Facility checkout gates</p>
                <div className="grid grid-cols-1 gap-2">
                  {ALL_CHECKOUT_GATES.map(key => (
                    <CheckRow
                      key={key}
                      label={CHECKOUT_GATE_LABELS[key]}
                      checked={draft.checkoutGateKeys.includes(key)}
                      onToggle={() => toggleKey<string>(draft.checkoutGateKeys, key, v => setDraft({ ...draft, checkoutGateKeys: v }))}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Triage required for</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {ALL_PATIENT_PROFILES.map(key => (
                <CheckRow
                  key={key}
                  label={PATIENT_PROFILE_LABELS[key]}
                  checked={draft.triageRequiredFor.includes(key)}
                  onToggle={() => toggleKey<PatientProfileKey>(draft.triageRequiredFor, key, v => setDraft({ ...draft, triageRequiredFor: v }))}
                />
              ))}
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Default routing</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(['appointment', 'walkIn', 'referral', 'emergency', 'maternity', 'child'] as const).map(key => (
                <Field key={key} label={key.replace(/([A-Z])/g, ' $1')}>
                  <input
                    className="fs-input"
                    value={draft.routingDefaults[key]}
                    onChange={e => setDraft({ ...draft, routingDefaults: { ...draft.routingDefaults, [key]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Direct service access</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <CheckRow label="Direct lab orders" checked={draft.directServiceAccess.lab} onToggle={() => setDraft({ ...draft, directServiceAccess: { ...draft.directServiceAccess, lab: !draft.directServiceAccess.lab } })} />
              <CheckRow label="Direct radiology orders" checked={draft.directServiceAccess.radiology} onToggle={() => setDraft({ ...draft, directServiceAccess: { ...draft.directServiceAccess, radiology: !draft.directServiceAccess.radiology } })} />
              <CheckRow label="Pharmacy refill without consult" checked={draft.directServiceAccess.pharmacyRefill} onToggle={() => setDraft({ ...draft, directServiceAccess: { ...draft.directServiceAccess, pharmacyRefill: !draft.directServiceAccess.pharmacyRefill } })} />
            </div>
            <SaveBar
              saving={saving === 'workflow'}
              onSave={() => saveSection({
                stationSequence: draft.stationSequence,
                checkoutGateKeys: draft.checkoutGateKeys,
                triageRequiredFor: draft.triageRequiredFor,
                routingDefaults: draft.routingDefaults,
                directServiceAccess: draft.directServiceAccess,
              }, 'workflow')}
            />
          </SectionCard>

          {/* ── Consultation Profiles ───────────────────────────────── */}
          <SectionCard icon={Stethoscope} title="Consultation Profiles">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {ALL_PATIENT_PROFILES.map(profile => {
                const p = draft.consultationProfiles[profile];
                return (
                  <div key={profile} className="p-3 rounded-xl" style={{ border: '1px solid var(--border-light)', background: 'var(--overlay-subtle)' }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{PATIENT_PROFILE_LABELS[profile]}</p>
                      <CheckRow
                        label="Chief complaint"
                        checked={p.chiefComplaintRequired}
                        onToggle={() => setDraft({
                          ...draft,
                          consultationProfiles: {
                            ...draft.consultationProfiles,
                            [profile]: { ...p, chiefComplaintRequired: !p.chiefComplaintRequired },
                          },
                        })}
                      />
                    </div>
                    <TextareaListEditor
                      label="Required vitals"
                      values={p.vitalsRequired}
                      onChange={v => setDraft({ ...draft, consultationProfiles: { ...draft.consultationProfiles, [profile]: { ...p, vitalsRequired: v } } })}
                    />
                    <TextareaListEditor
                      label="History prompts"
                      values={p.historyPrompts}
                      onChange={v => setDraft({ ...draft, consultationProfiles: { ...draft.consultationProfiles, [profile]: { ...p, historyPrompts: v } } })}
                    />
                    <TextareaListEditor
                      label="Red flags"
                      values={p.redFlagPrompts}
                      onChange={v => setDraft({ ...draft, consultationProfiles: { ...draft.consultationProfiles, [profile]: { ...p, redFlagPrompts: v } } })}
                    />
                  </div>
                );
              })}
            </div>
            <SaveBar
              saving={saving === 'consultation-profiles'}
              onSave={() => saveSection({ consultationProfiles: draft.consultationProfiles }, 'consultation-profiles')}
            />
          </SectionCard>

          {/* ── Reporting / HMIS ───────────────────────────────────── */}
          <SectionCard icon={Database} title="Reporting / HMIS">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="DHIS2 organisation unit ID">
                <input
                  className="fs-input"
                  value={draft.reporting.dhis2OrgUnitId}
                  onChange={e => setDraft({ ...draft, reporting: { ...draft.reporting, dhis2OrgUnitId: e.target.value } })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Monthly reporting deadline day">
                <input
                  type="number" min={1} max={31} className="fs-input"
                  value={draft.reporting.monthlyDeadlineDay}
                  onChange={e => setDraft({ ...draft, reporting: { ...draft.reporting, monthlyDeadlineDay: Number(e.target.value) } })}
                />
              </Field>
              <CheckRow
                label="Require completeness signoff"
                checked={draft.reporting.requireCompletenessSignoff}
                onToggle={() => setDraft({ ...draft, reporting: { ...draft.reporting, requireCompletenessSignoff: !draft.reporting.requireCompletenessSignoff } })}
              />
            </div>
            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Aggregate sources</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_REPORTING_SOURCES.map(key => (
                <CheckRow
                  key={key}
                  label={REPORTING_SOURCE_LABELS[key]}
                  checked={draft.reporting.aggregateSources.includes(key)}
                  onToggle={() => toggleKey<(typeof ALL_REPORTING_SOURCES)[number]>(draft.reporting.aggregateSources, key, v => setDraft({ ...draft, reporting: { ...draft.reporting, aggregateSources: v } }))}
                />
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <TextareaListEditor
                label="Disease reporting buckets"
                values={draft.reporting.diseaseBuckets}
                onChange={v => setDraft({ ...draft, reporting: { ...draft.reporting, diseaseBuckets: v } })}
              />
            </div>
            <SaveBar
              saving={saving === 'reporting'}
              onSave={() => saveSection({ reporting: draft.reporting }, 'reporting')}
            />
          </SectionCard>

          {/* ── IT Operations ───────────────────────────────────────── */}
          <SectionCard icon={Server} title="IT Operations">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Field label="Backup frequency (hours)">
                <input type="number" min={1} className="fs-input" value={draft.itOperations.backupFrequencyHours} onChange={e => setDraft({ ...draft, itOperations: { ...draft.itOperations, backupFrequencyHours: Number(e.target.value) } })} />
              </Field>
              <Field label="Sync failure alert (minutes)">
                <input type="number" min={1} className="fs-input" value={draft.itOperations.syncFailureAlertMinutes} onChange={e => setDraft({ ...draft, itOperations: { ...draft.itOperations, syncFailureAlertMinutes: Number(e.target.value) } })} />
              </Field>
              <Field label="Device review (days)">
                <input type="number" min={1} className="fs-input" value={draft.itOperations.deviceReviewDays} onChange={e => setDraft({ ...draft, itOperations: { ...draft.itOperations, deviceReviewDays: Number(e.target.value) } })} />
              </Field>
              <Field label="Audit retention (days)">
                <input type="number" min={30} className="fs-input" value={draft.itOperations.auditRetentionDays} onChange={e => setDraft({ ...draft, itOperations: { ...draft.itOperations, auditRetentionDays: Number(e.target.value) } })} />
              </Field>
            </div>
            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Controls</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <CheckRow label="Require device registration" checked={draft.itOperations.requireDeviceRegistration} onToggle={() => setDraft({ ...draft, itOperations: { ...draft.itOperations, requireDeviceRegistration: !draft.itOperations.requireDeviceRegistration } })} />
              <CheckRow label="Allow offline mode" checked={draft.itOperations.allowOfflineMode} onToggle={() => setDraft({ ...draft, itOperations: { ...draft.itOperations, allowOfflineMode: !draft.itOperations.allowOfflineMode } })} />
            </div>
            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Integrations</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {ALL_INTEGRATIONS.map(key => (
                <CheckRow
                  key={key}
                  label={INTEGRATION_LABELS[key]}
                  checked={draft.itOperations.integrations.includes(key)}
                  onToggle={() => toggleKey<(typeof ALL_INTEGRATIONS)[number]>(draft.itOperations.integrations, key, v => setDraft({ ...draft, itOperations: { ...draft.itOperations, integrations: v } }))}
                />
              ))}
            </div>
            <SaveBar
              saving={saving === 'it'}
              onSave={() => saveSection({ itOperations: draft.itOperations }, 'it')}
            />
          </SectionCard>

          {/* ── Billing ──────────────────────────────────────────────── */}
          <SectionCard icon={Wallet} title="Billing">
            <p className="fs-grouplabel">Accepted payment methods</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_PAYMENT_METHODS.map(key => (
                <CheckRow
                  key={key}
                  label={PAYMENT_METHOD_LABELS[key]}
                  checked={draft.paymentMethods.includes(key)}
                  onToggle={() => toggleKey<PaymentMethodKey>(draft.paymentMethods, key, v => setDraft({ ...draft, paymentMethods: v }))}
                />
              ))}
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Payors / funding sources</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {ALL_PAYORS.map(key => (
                <CheckRow
                  key={key}
                  label={PAYOR_LABELS[key]}
                  checked={draft.payors.includes(key)}
                  onToggle={() => toggleKey<PayorKey>(draft.payors, key, v => setDraft({ ...draft, payors: v }))}
                />
              ))}
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Collection timeline (days into an unpaid balance)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Follow-up reminder">
                <input
                  type="number" min={0} className="fs-input"
                  value={draft.collectionStageDays.followUp}
                  onChange={e => setDraft({ ...draft, collectionStageDays: { ...draft.collectionStageDays, followUp: Number(e.target.value) } })}
                />
              </Field>
              <Field label="Warning notice">
                <input
                  type="number" min={0} className="fs-input"
                  value={draft.collectionStageDays.warning}
                  onChange={e => setDraft({ ...draft, collectionStageDays: { ...draft.collectionStageDays, warning: Number(e.target.value) } })}
                />
              </Field>
              <Field label="Pre-write-off">
                <input
                  type="number" min={0} className="fs-input"
                  value={draft.collectionStageDays.preWriteOff}
                  onChange={e => setDraft({ ...draft, collectionStageDays: { ...draft.collectionStageDays, preWriteOff: Number(e.target.value) } })}
                />
              </Field>
            </div>

            <p className="fs-grouplabel" style={{ marginTop: 16 }}>Tax</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Service tax / VAT (%)">
                <input
                  type="number" min={0} step={0.5} className="fs-input"
                  value={draft.taxRatePercent}
                  onChange={e => setDraft({ ...draft, taxRatePercent: Number(e.target.value) })}
                />
              </Field>
            </div>
            <SaveBar
              saving={saving === 'billing'}
              onSave={() => saveSection({
                paymentMethods: draft.paymentMethods,
                payors: draft.payors,
                collectionStageDays: draft.collectionStageDays,
                taxRatePercent: draft.taxRatePercent,
              }, 'billing')}
            />
          </SectionCard>

          {/* ── Security ─────────────────────────────────────────────── */}
          <SectionCard icon={ShieldCheck} title="Security">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Auto-lock after idle (minutes)">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="number" min={0} className="fs-input"
                    value={draft.lockTimeoutMinutes}
                    onChange={e => setDraft({ ...draft, lockTimeoutMinutes: Number(e.target.value) })}
                  />
                </div>
              </Field>
            </div>
            <SaveBar
              saving={saving === 'security'}
              onSave={() => saveSection({ lockTimeoutMinutes: draft.lockTimeoutMinutes }, 'security')}
            />
          </SectionCard>
          </>
          )}
        </div>

      <style>{`
        .fs-input {
          width: 100%; padding: 9px 12px; border-radius: 8px;
          border: 1px solid var(--border-medium); background: var(--bg-secondary);
          color: var(--text-primary); font-size: 14px;
        }
        .fs-grouplabel {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 10px;
        }
        /* Explains a setting whose consequence isn't obvious from its label —
           used where getting it wrong has a real effect on patients. */
        .fs-hint {
          font-size: 12px; line-height: 1.55; color: var(--text-secondary);
          margin: -4px 0 12px; max-width: 62ch;
        }
        textarea.fs-input { resize: vertical; line-height: 1.5; font-family: inherit; }
      `}</style>
    </>
  );

  if (embedded) return content;
  return (
    <main className="page-container page-enter">
      <div className="dash-card overflow-hidden mb-4">
        <EhrListHeader title="Facility Settings" />
      </div>
      {content}
    </main>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateLabRow(
  draft: FacilitySettings,
  setDraft: (s: FacilitySettings) => void,
  index: number,
  patch: Partial<LabTestDef>,
) {
  setDraft({
    ...draft,
    labCatalog: draft.labCatalog.map((t, i) => (i === index ? { ...t, ...patch } : t)),
  });
}

function toggleKey<K extends string>(list: K[], key: K, set: (v: K[]) => void) {
  set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
}

function orderByReference<K extends string>(list: K[], reference: readonly K[]): K[] {
  return reference.filter(key => list.includes(key));
}

// ── Presentational pieces ────────────────────────────────────────────────────

function SectionCard({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; title: string; children: React.ReactNode }) {
  return (
    <section className="ehr-set-section fs-section">
      <div className="ehr-set-section-head">
        <span><Icon /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{title}</h3>
          <small>Facility-level configuration</small>
        </div>
      </div>
      <div className="fs-section-body">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end mt-4 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
      <button onClick={onSave} disabled={saving} className="btn btn-primary inline-flex items-center gap-2">
        <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2.5 text-sm py-1.5" style={{ color: 'var(--text-secondary)' }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
    </label>
  );
}

function TextareaListEditor({ label, values, onChange }: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Field label={label}>
      <textarea
        className="fs-input"
        rows={3}
        value={values.join('\n')}
        onChange={e => onChange(e.target.value.split('\n').map(v => v.trim()).filter(Boolean))}
      />
    </Field>
  );
}

function TagListEditor({ label, placeholder, values, onChange }: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [entry, setEntry] = useState('');
  const add = () => {
    const v = entry.trim();
    if (!v || values.includes(v)) { setEntry(''); return; }
    onChange([...values, v]);
    setEntry('');
  };
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="flex items-center gap-2 mb-3">
        <input
          className="fs-input"
          value={entry}
          placeholder={placeholder}
          onChange={e => setEntry(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} className="btn btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              aria-label={`Remove ${v}`}
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>None added yet.</span>
        )}
      </div>
    </div>
  );
}
