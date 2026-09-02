'use client';

/**
 * Network defaults — the settings that are the same at every facility.
 *
 * The facility editor used to carry all eleven sections for each hospital, so
 * an administrator running twenty facilities scrolled the same billing rules,
 * HMIS deadlines, IT thresholds, and consultation templates twenty times over
 * and had to keep them in step by hand. Those blocks are policy for the whole
 * network, not a property of one hospital, so they live here: set once, saved
 * to every facility the account governs.
 *
 * Storage stays exactly where it was — one `facility_settings` doc per
 * hospital. A save fans the shared values out across those docs (see
 * `saveFacilitySettingsToMany`), which keeps every existing reader — the
 * ledger, the queue, the escalation jobs — reading the one place it always
 * read, and leaves the per-facility editors that write the same keys working.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  Stethoscope, Database, Server, Wallet, ShieldCheck, Clock, AlertTriangle, Lock,
} from '@/components/icons/lucide';
import {
  getFacilitySettingsMany,
  saveFacilitySettingsToMany,
} from '@/lib/settings/settings-service';
import {
  DEFAULT_FACILITY_SETTINGS,
  type FacilitySettings,
  type PaymentMethodKey,
  type PayorKey,
  PAYMENT_METHOD_LABELS,
  PAYOR_LABELS,
  ALL_PAYMENT_METHODS,
  ALL_PAYORS,
} from '@/lib/settings/facility-settings';
import {
  SectionCard, Field, SaveBar, CheckRow, toggleKey,
} from '@/components/settings/settings-controls';

export type NetworkModuleKey =
  | 'standards' | 'consultation' | 'reporting' | 'it' | 'billing' | 'security';

export const NETWORK_MODULES: Array<{
  key: NetworkModuleKey;
  label: string;
  title: string;
  icon: typeof Stethoscope;
  blurb: string;
}> = [
  { key: 'standards',    label: 'Clinical standards', title: 'Clinical standards',      icon: Stethoscope, blurb: 'Result-review SLAs and queue acuity, identical at every facility.' },
  { key: 'consultation', label: 'Consultation forms', title: 'Consultation templates',  icon: Stethoscope, blurb: 'What a consultation asks for, per patient profile.' },
  { key: 'reporting',    label: 'HMIS rules',         title: 'Reporting / HMIS rules',  icon: Database,    blurb: 'Deadlines, sources, and disease buckets. Each facility keeps its own DHIS2 org unit.' },
  { key: 'it',           label: 'IT operations',      title: 'IT operations',           icon: Server,      blurb: 'Backup, sync alerting, device policy, and integrations.' },
  { key: 'billing',      label: 'Billing & payors',   title: 'Billing & payors',        icon: Wallet,      blurb: 'Currency, accepted payment methods, funding sources, and collections.' },
  { key: 'security',     label: 'Security',           title: 'Security',                icon: ShieldCheck, blurb: 'Idle auto-lock for every shared device on the network.' },
];

/** Checkbox sets carry no meaning in their order — two facilities that ticked
 *  the same boxes in a different sequence are not "divergent". Ordered lists
 *  (the consultation prompts) are deliberately left alone. */
const asSet = (list: readonly string[]) => [...list].sort();

/** The settings keys each shared module owns — also what divergence compares. */
function moduleValue(s: FacilitySettings, key: NetworkModuleKey): unknown {
  switch (key) {
    case 'standards':    return { resultReviewSLA: s.resultReviewSLA };
    case 'consultation': return null;
    // dhis2OrgUnitId is the one per-facility field inside a shared block, so
    // it is deliberately excluded from both the comparison and the save.
    case 'reporting':    return null;
    case 'it':           return { syncFailureAlertMinutes: s.itOperations.syncFailureAlertMinutes };
    case 'billing':      return {
      currency: s.currency,
      paymentMethods: asSet(s.paymentMethods),
      payors: asSet(s.payors),
      collectionStageDays: s.collectionStageDays,
      taxRatePercent: s.taxRatePercent,
    };
    case 'security':     return { lockTimeoutMinutes: s.lockTimeoutMinutes };
  }
}

function modulePatch(draft: FacilitySettings, key: NetworkModuleKey, current: FacilitySettings): Partial<FacilitySettings> {
  switch (key) {
    case 'standards':    return { resultReviewSLA: draft.resultReviewSLA };
    case 'consultation': return {};
    case 'reporting':    return {};
    case 'it':           return { itOperations: { ...current.itOperations, syncFailureAlertMinutes: draft.itOperations.syncFailureAlertMinutes } };
    case 'billing':      return {
      currency: draft.currency,
      paymentMethods: draft.paymentMethods,
      payors: draft.payors,
      collectionStageDays: draft.collectionStageDays,
      taxRatePercent: draft.taxRatePercent,
    };
    case 'security':     return { lockTimeoutMinutes: draft.lockTimeoutMinutes };
  }
}

export default function NetworkDefaultsView({ module, targets, sessionHospitalId }: {
  module: NetworkModuleKey;
  /** Every facility this account governs — the fan-out target of a save. */
  targets: Array<{ _id: string; orgId?: string }>;
  sessionHospitalId?: string;
}) {
  const { showToast } = useToast();
  const [perFacility, setPerFacility] = useState<Record<string, FacilitySettings>>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<FacilitySettings>(DEFAULT_FACILITY_SETTINGS);
  const [saving, setSaving] = useState(false);

  const ids = useMemo(() => targets.map(t => t._id), [targets]);
  const idsKey = ids.join(',');

  const load = useCallback(async () => {
    setLoading(true);
    const map = await getFacilitySettingsMany(idsKey ? idsKey.split(',') : []);
    setPerFacility(map);
    // Seed the form from the account's own facility when it has one, else the
    // first governed facility — the values an admin expects to see, not blank
    // platform defaults.
    const seedId = (sessionHospitalId && map[sessionHospitalId]) ? sessionHospitalId : Object.keys(map)[0];
    setDraft(map[seedId] ?? DEFAULT_FACILITY_SETTINGS);
    setLoading(false);
  }, [idsKey, sessionHospitalId]);

  useEffect(() => { load(); }, [load]);

  // How many facilities currently hold something different for this module —
  // the honest version of "applies to all", since a save aligns them.
  const divergent = useMemo(() => {
    const entries = Object.values(perFacility);
    if (entries.length < 2) return 0;
    const seed = JSON.stringify(moduleValue(draft, module));
    return entries.filter(s => JSON.stringify(moduleValue(s, module)) !== seed).length;
  }, [perFacility, draft, module]);

  const orgIdByHospital = useCallback(
    (hospitalId: string) => targets.find(t => t._id === hospitalId)?.orgId,
    [targets],
  );

  const save = async () => {
    setSaving(true);
    try {
      const { saved, failed } = await saveFacilitySettingsToMany(
        ids,
        (current, _hospitalId) => modulePatch(draft, module, current) ?? {},
        orgIdByHospital,
        sessionHospitalId,
      );
      if (failed > 0) {
        showToast(`Saved to ${saved} of ${saved + failed} facilities — ${failed} failed`, 'error');
      } else {
        showToast(saved === 1 ? 'Settings saved' : `Saved to all ${saved} facilities`, 'success');
      }
      await load();
    } catch {
      showToast('Could not save network defaults', 'error');
    } finally {
      setSaving(false);
    }
  };

  const meta = NETWORK_MODULES.find(m => m.key === module) ?? NETWORK_MODULES[0];
  const scopeNote = ids.length === 1
    ? 'Applies to your facility'
    : `Applies to all ${ids.length} facilities`;
  const saveable = module !== 'consultation' && module !== 'reporting';

  const unavailable = (text: string) => (
    <div className="ehr-set-locked" style={{ justifyContent: 'flex-start', padding: '12px 0' }}>
      <Lock /> {text} — not available until the workflow enforces it
    </div>
  );

  if (loading) {
    return (
      <SectionCard icon={meta.icon} title={meta.title} note={scopeNote}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading current values…</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={meta.icon} title={meta.title} note={scopeNote}>
      <p className="fs-hint">{meta.blurb}</p>

      {divergent > 0 && (
        <div className="fs-net-warn">
          <AlertTriangle className="w-4 h-4 flex-none" />
          <span>
            {divergent} {divergent === 1 ? 'facility currently holds' : 'facilities currently hold'} different
            values for this module. Saving will align {divergent === 1 ? 'it' : 'them'} with what is shown here.
          </span>
        </div>
      )}

      {module === 'standards' && (
        <>
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

          <p className="fs-grouplabel" style={{ marginTop: 16 }}>Queue acuity</p>
          {unavailable('Automatic wait-time acuity escalation')}
        </>
      )}

      {module === 'consultation' && unavailable('Configurable consultation templates')}

      {module === 'reporting' && unavailable('Editable HMIS deadlines, sources, and disease buckets')}

      {module === 'it' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Sync failure alert (minutes)">
              <input type="number" min={1} className="fs-input" value={draft.itOperations.syncFailureAlertMinutes} onChange={e => setDraft({ ...draft, itOperations: { ...draft.itOperations, syncFailureAlertMinutes: Number(e.target.value) } })} />
            </Field>
          </div>
          {unavailable('Backup scheduling, device registration, offline-mode enforcement, and integration switches')}
        </>
      )}

      {module === 'billing' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Currency">
              <input
                className="fs-input"
                value={draft.currency}
                onChange={e => setDraft({ ...draft, currency: e.target.value })}
                placeholder="e.g. SSP"
              />
            </Field>
            <Field label="Service tax / VAT (%)">
              <input
                type="number" min={0} step={0.5} className="fs-input"
                value={draft.taxRatePercent}
                onChange={e => setDraft({ ...draft, taxRatePercent: Number(e.target.value) })}
              />
            </Field>
          </div>

          <p className="fs-grouplabel" style={{ marginTop: 16 }}>Accepted payment methods</p>
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
        </>
      )}

      {module === 'security' && (
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
      )}

      {saveable && <SaveBar
        saving={saving}
        onSave={save}
        label={ids.length === 1 ? 'Save changes' : `Save to ${ids.length} facilities`}
        hint={ids.length === 1 ? undefined : 'One save, every facility.'}
      />}
    </SectionCard>
  );
}
