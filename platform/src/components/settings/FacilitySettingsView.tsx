'use client';

/**
 * Facility settings, as a two-pane module navigator.
 *
 * It used to be one stacked column of eleven cards — every facility repeating
 * the same billing rules, HMIS deadlines, IT thresholds and consultation
 * templates, several screen-heights of scrolling to reach any of them, and
 * nothing to say which of those values actually differ between two hospitals.
 *
 * The split is now explicit:
 *   • **This facility** — what genuinely varies hospital to hospital: its
 *     number prefix and DHIS2 org unit, visit types, departments and rooms,
 *     lab catalogue, and the patient journey through its stations.
 *   • **All facilities** — the shared policy, edited once in
 *     `NetworkDefaultsView` and saved to every facility the account governs.
 *
 * A left rail switches modules, so one module is on screen at a time instead
 * of all of them stacked. Accounts with no facility of their own (super-admin,
 * org-admin, government) pick one from the list first; the shared modules need
 * no facility and are reachable straight away.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  Building2, FlaskConical, Trash2, Plus, ClipboardCheck, CalendarClock,
  ChevronRight, Search, Layers, MapPin,
} from '@/components/icons/lucide';
import { useSettings, useSettingsContext } from '@/lib/settings/SettingsProvider';
import { getFacilitySettings, saveFacilitySettings } from '@/lib/settings/settings-service';
import {
  type FacilitySettings,
  type EncounterStationKey,
  type LabTestDef,
  type PatientProfileKey,
} from '@/lib/settings/facility-settings';
import Select from '@/components/Select';
import VisitTypesSection from '@/components/settings/VisitTypesSection';
import NetworkDefaultsView, { NETWORK_MODULES, type NetworkModuleKey } from '@/components/settings/NetworkDefaultsView';
import {
  SectionCard, Field, SaveBar, CheckRow, TagListEditor, toggleKey, orderByReference,
} from '@/components/settings/settings-controls';

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

/** Roles allowed on /hospitals/[id]/manage — mirrors that page's own gate, so
 *  the picker never offers a link that lands on a redirect. */
const FACILITY_PROFILE_ROLES = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];

type FacilityModuleKey = 'identity' | 'visits' | 'places' | 'lab' | 'workflow';

const FACILITY_MODULES: Array<{ key: FacilityModuleKey; label: string; title: string; icon: typeof Building2 }> = [
  { key: 'identity', label: 'Identity & codes',   title: 'Identity & codes',        icon: Building2 },
  { key: 'visits',   label: 'Visit types',        title: 'Visit types & booking',   icon: CalendarClock },
  { key: 'places',   label: 'Departments & rooms', title: 'Departments & rooms',    icon: MapPin },
  { key: 'lab',      label: 'Lab catalogue',      title: 'Lab catalogue',           icon: FlaskConical },
  { key: 'workflow', label: 'Patient journey',    title: 'Patient journey',         icon: ClipboardCheck },
];

/** Facility-type ordering + labels for the picker's groups. */
const TYPE_GROUPS: Array<{ key: string; label: string }> = [
  { key: 'national_referral', label: 'National referral' },
  { key: 'state_hospital',    label: 'State hospitals' },
  { key: 'county_hospital',   label: 'County hospitals' },
  { key: 'phcc',              label: 'Primary health care centres' },
  { key: 'phcu',              label: 'Primary health care units' },
  { key: 'other',             label: 'Other facilities' },
];

/** Two letters for the row plate. Facility names are mostly place + generic
 *  noun ("Yei County Hospital"), so the generic half is dropped first; a name
 *  left with one word falls back to its first two letters rather than one. */
const initials = (name: string) => {
  const words = name
    .replace(/\b(county|state|teaching|referral|hospital|centre|center|clinic|unit|general)\b/gi, ' ')
    .split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
};

const typeLabel = (t?: string) => (t ? t.replace(/_/g, ' ') : 'facility');

// `embedded` renders just the settings body (no TopBar / page-container) so the
// main Settings page can host it as its "Facility" tab. The standalone route
// (default, embedded=false) still renders the full page.
export function FacilitySettingsView({ embedded = false }: { embedded?: boolean } = {}) {
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const { hospitalId, orgId } = useSettingsContext();
  const settings = useSettings();
  // Facility picker for multi-facility admins (already role/org-scoped).
  const { hospitals: pickerHospitals, loading: hospitalsLoading } = useHospitals();
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedSettings, setSelectedSettings] = useState<FacilitySettings | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [facilityQuery, setFacilityQuery] = useState('');
  // One module on screen at a time: 'facility:<key>' or 'network:<key>'.
  const [activeModule, setActiveModule] = useState<string>('facility:identity');
  const effectiveHospitalId = hospitalId || selectedHospitalId;
  const effectiveSettings = hospitalId ? settings : (selectedSettings || settings);
  const selectedHospital = pickerHospitals.find(h => h._id === effectiveHospitalId);
  const canOpenProfile = !!currentUser && FACILITY_PROFILE_ROLES.includes(currentUser.role);

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

  // ── Facility picker ───────────────────────────────────────────────────────
  const groupedFacilities = useMemo(() => {
    const q = facilityQuery.trim().toLowerCase();
    const matches = pickerHospitals.filter(h => !q || [h.name, h.town, h.county, h.state, typeLabel(h.facilityType)]
      .some(v => v?.toLowerCase().includes(q)));
    return TYPE_GROUPS
      .map(g => ({
        ...g,
        rows: matches
          .filter(h => (TYPE_GROUPS.some(t => t.key === h.facilityType) ? h.facilityType : 'other') === g.key)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(g => g.rows.length > 0);
  }, [pickerHospitals, facilityQuery]);
  const matchCount = groupedFacilities.reduce((n, g) => n + g.rows.length, 0);

  const [scope, moduleKey] = activeModule.split(':');
  const isNetworkModule = scope === 'network';
  const facilityModule = (isNetworkModule ? 'identity' : moduleKey) as FacilityModuleKey;

  // The fan-out target for shared settings. A facility-bound account whose
  // roster has not loaded yet still has its own facility to write to.
  const networkTargets = useMemo(() => (
    pickerHospitals.length
      ? pickerHospitals.map(h => ({ _id: h._id, orgId: h.orgId }))
      : (hospitalId ? [{ _id: hospitalId, orgId }] : [])
  ), [pickerHospitals, hospitalId, orgId]);

  const picker = (
    <div className="fs-fac-pick">
      <div className="fs-fac-pick-head">
        <div style={{ minWidth: 0 }}>
          <h4>Choose a facility</h4>
          <p>
            These modules configure one hospital at a time. Everything the whole network shares
            is under <b>All facilities</b> — set there once.
          </p>
        </div>
        <div className="fs-fac-search">
          <Search className="w-4 h-4" aria-hidden />
          <input
            value={facilityQuery}
            onChange={e => setFacilityQuery(e.target.value)}
            placeholder="Search by name, town, or type"
            aria-label="Search facilities"
          />
        </div>
      </div>

      <div className="fs-fac-list">
        {/* The column head is the table's frame — it stays put when the list
            is empty or still loading, so the panel never changes shape. */}
        <div className="fs-fac-colhead">
          <span>Facility</span>
          <span>Town</span>
          <span>County / State</span>
          <span className="fs-fac-count">{matchCount} of {pickerHospitals.length}</span>
        </div>

        {hospitalsLoading && pickerHospitals.length === 0 && (
          <p className="fs-fac-empty">Loading facilities…</p>
        )}
        {!hospitalsLoading && pickerHospitals.length === 0 && (
          <p className="fs-fac-empty">No facilities registered yet.</p>
        )}
        {pickerHospitals.length > 0 && matchCount === 0 && (
          <p className="fs-fac-empty">No facility matches “{facilityQuery}”.</p>
        )}

        {groupedFacilities.map(group => (
          <div className="fs-fac-group" key={group.key}>
            <p className="fs-fac-group-label">{group.label}<b>{group.rows.length}</b></p>
            {group.rows.map(h => (
              <div className="fs-fac-row" key={h._id}>
                <div className="fs-fac-ident">
                  <span className="fs-fac-plate" aria-hidden>{initials(h.name)}</span>
                  {/* Stretched hit area: the whole row opens the facility, and
                      the profile link beside it stays independently clickable. */}
                  <button type="button" className="fs-fac-open" onClick={() => setSelectedHospitalId(h._id)}>
                    {h.name}
                  </button>
                </div>
                <span className="fs-fac-loc" title={h.town || undefined}>{h.town || '—'}</span>
                {(() => {
                  // County and state repeat each other at several facilities
                  // ("Juba · Juba"), so the pair is de-duplicated before it
                  // is joined; the title carries the untruncated value.
                  const area = [h.county, h.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
                  return <span className="fs-fac-loc" title={area || undefined}>{area || '—'}</span>;
                })()}
                <span className="fs-fac-act">
                  {canOpenProfile && (
                    <Link href={`/hospitals/${h._id}/manage`} className="fs-fac-profile">Profile</Link>
                  )}
                  <ChevronRight className="w-4 h-4 fs-fac-chev" aria-hidden />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Per-facility module bodies ────────────────────────────────────────────
  const facilityBody = () => {
    if (!effectiveHospitalId) return picker;
    if (loadingSelected) {
      return (
        <SectionCard icon={Building2} title="Loading facility">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading facility settings…</p>
        </SectionCard>
      );
    }
    const meta = FACILITY_MODULES.find(m => m.key === facilityModule) ?? FACILITY_MODULES[0];
    const note = selectedHospital ? `${selectedHospital.name} only` : 'This facility only';

    switch (facilityModule) {
      case 'identity':
        return (
          <SectionCard icon={meta.icon} title={meta.title} note={note}>
            <p className="fs-hint">
              The codes that identify this facility in its records and in national reporting.
              Currency and tax are network-wide — they live under Billing &amp; payors.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Hospital number prefix">
                <input
                  className="fs-input"
                  value={draft.hospitalNumberPrefix}
                  onChange={e => setDraft({ ...draft, hospitalNumberPrefix: e.target.value })}
                  placeholder="e.g. TAB"
                />
              </Field>
              <Field label="DHIS2 organisation unit ID">
                <input
                  className="fs-input"
                  value={draft.reporting.dhis2OrgUnitId}
                  onChange={e => setDraft({ ...draft, reporting: { ...draft.reporting, dhis2OrgUnitId: e.target.value } })}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <SaveBar
              saving={saving === 'identity'}
              onSave={() => saveSection({
                hospitalNumberPrefix: draft.hospitalNumberPrefix,
                reporting: { ...draft.reporting, dhis2OrgUnitId: draft.reporting.dhis2OrgUnitId },
              }, 'identity')}
            />
          </SectionCard>
        );

      case 'visits':
        return (
          <SectionCard icon={meta.icon} title={meta.title} note={note}>
            <VisitTypesSection facilityId={effectiveHospitalId} />
          </SectionCard>
        );

      case 'places':
        return (
          <SectionCard icon={meta.icon} title={meta.title} note={note}>
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
        );

      case 'lab':
        return (
          <SectionCard icon={meta.icon} title={meta.title} note={note}>
            <p className="fs-hint">The investigations this facility can actually run — a county hospital and a health-care unit rarely offer the same list.</p>
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
        );

      case 'workflow':
        return (
          <SectionCard icon={meta.icon} title={meta.title} note={note}>
            <p className="fs-hint">The stations a patient passes through here, and what has to be closed before they leave.</p>
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
        );
    }
  };

  const content = (
    <div className="fs-shell">
      <nav className="fs-nav" aria-label="Settings modules">
        <p className="fs-nav-group">
          This facility
          {effectiveHospitalId && selectedHospital && <small title={selectedHospital.name}>{selectedHospital.name}</small>}
          {!effectiveHospitalId && <small>None chosen</small>}
        </p>
        {FACILITY_MODULES.map(m => (
          <button
            key={m.key}
            type="button"
            className={activeModule === `facility:${m.key}` ? 'is-active' : undefined}
            onClick={() => setActiveModule(`facility:${m.key}`)}
          >
            <m.icon className="w-4 h-4" aria-hidden />
            <span>{m.label}</span>
            {!effectiveHospitalId && <i className="fs-nav-lock" aria-hidden />}
          </button>
        ))}

        <p className="fs-nav-group">
          All facilities
          <small>{networkTargets.length === 1 ? 'Shared settings' : `Shared by ${networkTargets.length}`}</small>
        </p>
        {NETWORK_MODULES.map(m => (
          <button
            key={m.key}
            type="button"
            className={activeModule === `network:${m.key}` ? 'is-active' : undefined}
            onClick={() => setActiveModule(`network:${m.key}`)}
          >
            <m.icon className="w-4 h-4" aria-hidden />
            <span>{m.label}</span>
          </button>
        ))}

        {!embedded && (
          <Link href="/settings/manage" className="fs-nav-foot">
            <Layers className="w-4 h-4" aria-hidden /> All settings
          </Link>
        )}
      </nav>

      <div className="fs-shell-body">
        {/* Context bar: which facility the per-facility modules are editing,
            and the two ways out of it — switch facility, or open its profile. */}
        {!isNetworkModule && effectiveHospitalId && (
          <div className="fs-ctx">
            <span className="fs-ctx-plate" aria-hidden>{initials(selectedHospital?.name || 'Facility')}</span>
            <div className="fs-ctx-name">
              <strong>{selectedHospital?.name || 'Selected facility'}</strong>
              <span>
                {selectedHospital
                  ? [selectedHospital.town || selectedHospital.state, typeLabel(selectedHospital.facilityType)].filter(Boolean).join(' · ')
                  : 'Facility settings'}
              </span>
            </div>
            {canOpenProfile && (
              <Link href={`/hospitals/${effectiveHospitalId}/manage`} className="ehr-set-btn">Facility profile</Link>
            )}
            {!hospitalId && (
              <button type="button" className="ehr-set-btn" onClick={() => setSelectedHospitalId('')}>
                Change facility
              </button>
            )}
          </div>
        )}

        {isNetworkModule ? (
          <NetworkDefaultsView
            module={moduleKey as NetworkModuleKey}
            targets={networkTargets}
            sessionHospitalId={hospitalId}
          />
        ) : facilityBody()}
      </div>
    </div>
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
