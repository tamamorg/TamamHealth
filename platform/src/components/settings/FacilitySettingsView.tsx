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
 * org-admin, government) choose which hospital they are editing from a
 * dropdown in the context bar — it used to be a full-height list that took
 * the whole panel, so clicking any module showed the same roster of
 * facilities rather than the module that was clicked. The shared modules need
 * no facility and are reachable straight away.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  Building2, FlaskConical, Trash2, Plus, ClipboardCheck, CalendarClock,
  Layers, MapPin, Lock,
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

/** Roles allowed on a facility's page — mirrors `FACILITY_MANAGE_ROLES`, so
 *  the picker never offers a link that lands on a redirect. */
const FACILITY_PROFILE_ROLES = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];

type FacilityModuleKey = 'identity' | 'visits' | 'places' | 'lab' | 'workflow';

export const FACILITY_MODULES: Array<{ key: FacilityModuleKey; label: string; title: string; icon: typeof Building2 }> = [
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

/**
 * The facility a multi-facility account was last editing. Remembered so that
 * coming back to Settings lands on that hospital's modules instead of asking
 * for the choice again; a stale id (facility removed, or the roster now scoped
 * to a different org) falls back to the first facility in the list.
 */
const FACILITY_CHOICE_KEY = 'tamam.facility-settings.facility';

const readRememberedFacility = (): string => {
  try { return localStorage.getItem(FACILITY_CHOICE_KEY) || ''; } catch { return ''; }
};

// `embedded` renders just the settings body (no TopBar / page-container) so the
// main Settings page can host it as its "Facility" tab. The standalone route
// (default, embedded=false) still renders the full page.
export function FacilitySettingsView({
  embedded = false,
  activeModule: controlledModule,
  onModuleChange,
  hideNav = false,
}: {
  embedded?: boolean;
  /**
   * Which module to show, when something outside drives the choice.
   *
   * The Settings page now expands its own rail to list these modules, so this
   * view stopped owning a second nav column of its own — two rails side by
   * side made the reader pick a section twice to reach one screen. Left
   * undefined, the view keeps its internal state and its own rail, which is
   * what the standalone /facility-settings route still uses.
   */
  activeModule?: string;
  onModuleChange?: (module: string) => void;
  /** Hide the built-in rail when the host is already listing these modules. */
  hideNav?: boolean;
} = {}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { hospitalId, orgId } = useSettingsContext();
  const settings = useSettings();
  // Facility picker for multi-facility admins (already role/org-scoped).
  const { hospitals: pickerHospitals, loading: hospitalsLoading } = useHospitals();
  const [selectedHospitalId, setSelectedHospitalId] = useState<string>('');
  const [selectedSettings, setSelectedSettings] = useState<FacilitySettings | null>(null);
  const [loadingSelected, setLoadingSelected] = useState(false);
  // One module on screen at a time: 'facility:<key>' or 'network:<key>'.
  // Controlled when the host rail owns the choice, uncontrolled otherwise.
  const [ownModule, setOwnModule] = useState<string>('facility:identity');
  const activeModule = controlledModule ?? ownModule;
  const setActiveModule = (next: string) => {
    if (controlledModule === undefined) setOwnModule(next);
    onModuleChange?.(next);
  };
  const effectiveSettings = hospitalId ? settings : (selectedSettings || settings);
  const canOpenProfile = !!currentUser && FACILITY_PROFILE_ROLES.includes(currentUser.role);
  // An account bound to its own facility never chooses one; everyone else does.
  const canPickFacility = !hospitalId;

  // ── Facility chooser ──────────────────────────────────────────────────────
  // Grouped by facility type, each group alphabetical, so the dropdown reads
  // in the same order as the facilities list elsewhere in the console.
  const facilityGroups = useMemo(() => TYPE_GROUPS
    .map(g => ({
      ...g,
      rows: pickerHospitals
        .filter(h => (TYPE_GROUPS.some(t => t.key === h.facilityType) ? h.facilityType : 'other') === g.key)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter(g => g.rows.length > 0), [pickerHospitals]);
  const orderedFacilities = useMemo(() => facilityGroups.flatMap(g => g.rows), [facilityGroups]);
  // Two facilities can carry the same name in different towns (a "Mercy
  // General" per org); the town only joins the label where it disambiguates.
  const facilityOptionLabel = (id: string) => {
    const h = orderedFacilities.find(f => f._id === id);
    if (!h) return '';
    const twin = orderedFacilities.some(f => f._id !== h._id && f.name === h.name);
    return twin && h.town ? `${h.name} · ${h.town}` : h.name;
  };

  const chooseFacility = (id: string) => {
    setSelectedHospitalId(id);
    try { localStorage.setItem(FACILITY_CHOICE_KEY, id); } catch { /* private mode — the choice just won't outlive the visit */ }
  };

  // Land on a facility rather than on a chooser: the one last edited, else the
  // first in the roster. Derived rather than stored, so no render happens with
  // nothing chosen — every module used to sit empty until a hospital was
  // picked, which is what the full-panel list was there to force.
  //
  // Reading localStorage during render is safe here *because* the roster is
  // empty until after mount (it comes from the local database, which the
  // server does not have): the server and the hydrating client both see no
  // facilities and render the same nothing.
  const defaultFacilityId = useMemo(() => {
    if (orderedFacilities.length === 0) return '';
    const remembered = readRememberedFacility();
    return orderedFacilities.some(h => h._id === remembered) ? remembered : orderedFacilities[0]._id;
  }, [orderedFacilities]);
  const effectiveHospitalId = hospitalId || selectedHospitalId || defaultFacilityId;
  const selectedHospital = pickerHospitals.find(h => h._id === effectiveHospitalId);

  useEffect(() => {
    if (hospitalId || !effectiveHospitalId) {
      setSelectedSettings(null);
      return;
    }
    let cancelled = false;
    setLoadingSelected(true);
    getFacilitySettings(effectiveHospitalId)
      .then(next => { if (!cancelled) setSelectedSettings(next); })
      .catch(() => { if (!cancelled) setSelectedSettings(settings); })
      .finally(() => { if (!cancelled) setLoadingSelected(false); });
    return () => { cancelled = true; };
  }, [hospitalId, effectiveHospitalId, settings]);

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

  // ── Per-facility module bodies ────────────────────────────────────────────
  const facilityBody = () => {
    const meta = FACILITY_MODULES.find(m => m.key === facilityModule) ?? FACILITY_MODULES[0];
    // The module keeps its own card even with nothing to edit yet, so the
    // clicked module is always what the panel shows.
    if (!effectiveHospitalId) {
      return (
        <SectionCard icon={meta.icon} title={meta.title}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {hospitalsLoading
              ? t('facilitySettings.loadingFacilities')
              : t('facilitySettings.noFacilityAvailable')}
          </p>
        </SectionCard>
      );
    }
    if (loadingSelected) {
      return (
        <SectionCard icon={meta.icon} title={meta.title}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('facilitySettings.loadingSettings')}</p>
        </SectionCard>
      );
    }
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
            <div className="ehr-set-locked" style={{ justifyContent: 'flex-start', padding: '12px 0' }}>
              <Lock /> Not available until lab, radiology, and refill entry points enforce this policy
            </div>
            <SaveBar
              saving={saving === 'workflow'}
              onSave={() => saveSection({
                stationSequence: draft.stationSequence,
                checkoutGateKeys: draft.checkoutGateKeys,
                triageRequiredFor: draft.triageRequiredFor,
                routingDefaults: draft.routingDefaults,
              }, 'workflow')}
            />
          </SectionCard>
        );
    }
  };

  const content = (
    <div className={`fs-shell${hideNav ? ' fs-shell--nonav' : ''}`}>
      {!hideNav && (
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
      )}

      <div className="fs-shell-body">
        {/* Context bar: which facility the per-facility modules are editing,
            and the two ways out of it — switch facility, or open its profile. */}
        {!isNetworkModule && (
          <div className="fs-ctx">
            <span className="fs-ctx-plate" aria-hidden>{initials(selectedHospital?.name || 'Facility')}</span>
            {canPickFacility && orderedFacilities.length > 0 ? (
              <div className="fs-ctx-pick">
                <span className="fs-ctx-cap">{t('facilitySettings.editing')}</span>
                <Select
                  className="ehr-set-select fs-ctx-select"
                  value={effectiveHospitalId}
                  onChange={e => chooseFacility(e.target.value)}
                  aria-label={t('facilitySettings.facilityBeingEdited')}
                  searchPlaceholder={t('facilitySettings.searchFacilities')}
                >
                  {facilityGroups.map(group => (
                    <optgroup key={group.key} label={group.label}>
                      {group.rows.map(h => (
                        <option key={h._id} value={h._id}>{facilityOptionLabel(h._id)}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <span className="fs-ctx-where">
                  {selectedHospital
                    ? [selectedHospital.town || selectedHospital.state, typeLabel(selectedHospital.facilityType)].filter(Boolean).join(' · ')
                    : ''}
                </span>
              </div>
            ) : (
              <div className="fs-ctx-name">
                <strong>{selectedHospital?.name || (hospitalsLoading ? t('facilitySettings.loadingFacilities') : t('facilitySettings.noFacility'))}</strong>
                <span>
                  {selectedHospital
                    ? [selectedHospital.town || selectedHospital.state, typeLabel(selectedHospital.facilityType)].filter(Boolean).join(' · ')
                    : t('facilitySettings.title')}
                </span>
              </div>
            )}
            {canOpenProfile && effectiveHospitalId && (
              <Link href={`/admin/facilities/${effectiveHospitalId}`} className="ehr-set-btn">{t('facilitySettings.profile')}</Link>
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
