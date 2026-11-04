'use client';

import { useState, useEffect, useCallback } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { Plus } from '@/components/icons/lucide';
import { SadbCard, SadbGridList, SadbGridRow } from '@/components/admin/sadb-ui';
import FacilityKpiBand, { weekOverWeek } from '@/components/dashboards/FacilityKpiBand';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import {
  getAllPlans,
  createPlan,
  activatePlan,
  deactivatePlan,
} from '@/lib/services/emergency-preparedness-service';
import type {
  EmergencyPlanDoc,
  EmergencyType,
  EmergencyPhase,
  EmergencySeverity,
} from '@/lib/db-types';
import Badge, { type BadgeTone } from '@/components/Badge';
import Select from '@/components/Select';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { locationLabel, states } from '@/lib/data/south-sudan-reference';
import { useTranslation } from '@/lib/i18n/useTranslation';
import NumberInput from '@/components/forms/NumberInput';

const EMERGENCY_TYPES: { value: EmergencyType; label: string }[] = [
  { value: 'disease_outbreak', label: 'Disease outbreak' },
  { value: 'cholera_outbreak', label: 'Cholera outbreak' },
  { value: 'measles_outbreak', label: 'Measles outbreak' },
  { value: 'ebola', label: 'Ebola' },
  { value: 'flood', label: 'Flood' },
  { value: 'conflict', label: 'Conflict / displacement' },
  { value: 'famine', label: 'Famine' },
  { value: 'mass_casualty', label: 'Mass casualty' },
  { value: 'infrastructure_failure', label: 'Infrastructure failure' },
];

const PHASES: { value: EmergencyPhase; label: string }[] = [
  { value: 'preparedness', label: 'Preparedness' },
  { value: 'alert', label: 'Alert' },
  { value: 'response', label: 'Response' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'closed', label: 'Closed' },
];

const SEVERITIES: { value: EmergencySeverity; label: string }[] = [
  { value: 'level_1', label: 'Level 1 — Watch' },
  { value: 'level_2', label: 'Level 2 — Mobilize' },
  { value: 'level_3', label: 'Level 3 — Full activation' },
];

const SEVERITY_LABEL: Record<EmergencySeverity, string> = Object.fromEntries(
  SEVERITIES.map(v => [v.value, v.label.split(' — ')[0]]),
) as Record<EmergencySeverity, string>;

const TYPE_LABEL: Record<EmergencyType, string> = Object.fromEntries(
  EMERGENCY_TYPES.map(t => [t.value, t.label]),
) as Record<EmergencyType, string>;
const PHASE_LABEL: Record<EmergencyPhase, string> = Object.fromEntries(
  PHASES.map(p => [p.value, p.label]),
) as Record<EmergencyPhase, string>;

// Severity → Badge tone (level_3 full activation → danger, level_2 → warning,
// level_1 watch → info).
const severityTone = (s: EmergencySeverity): BadgeTone =>
  s === 'level_3' ? 'danger' : s === 'level_2' ? 'warning' : 'info';

// Phase → Badge tone (active response → danger, alert → warning,
// recovery → info, preparedness → success, closed → neutral).
const phaseTone = (p: EmergencyPhase): BadgeTone =>
  p === 'response' ? 'danger' : p === 'alert' ? 'warning' : p === 'recovery' ? 'info' : p === 'preparedness' ? 'success' : 'neutral';

const EMPTY_FORM = {
  planName: '',
  emergencyType: 'cholera_outbreak' as EmergencyType,
  severity: 'level_2' as EmergencySeverity,
  phase: 'preparedness' as EmergencyPhase,
  description: '',
  // 0, not an invented 10/50: capacity figures default to "not stated" so a
  // plan saved without editing them never claims surge beds it doesn't have.
  surgeBeds: 0,
  incidentCommander: '',
  incidentCommanderPhone: '',
  estimatedCapacity: 0,
  state: '',
};

export default function EmergencyPreparednessPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const scope = useDataScope();

  const [plans, setPlans] = useState<EmergencyPlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const facilityId = currentUser?.hospitalId || currentUser?.hospital?._id || '';
  const facilityName = currentUser?.hospital?.name || currentUser?.hospitalName || 'Facility';
  const facilityState = currentUser?.hospital?.state || '';

  const load = useCallback(async () => {
    if (!scope) {
      setPlans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getAllPlans(scope);
      setPlans(result);
    } catch (err) {
      console.error(err);
      showToast(t('msg.emergencyPlansNotLoadedReload'), 'error');
    } finally {
      setLoading(false);
    }
  }, [scope, showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openForm = () => {
    setForm({ ...EMPTY_FORM, state: facilityState });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.planName.trim()) {
      showToast(t('msg.enterThePlanName'), 'error');
      return;
    }
    if (!form.incidentCommander.trim()) {
      showToast(t('msg.enterTheIncidentCommander'), 'error');
      return;
    }
    try {
      setSubmitting(true);
      await createPlan({
        planName: form.planName.trim(),
        emergencyType: form.emergencyType,
        phase: form.phase,
        severity: form.severity,
        description: form.description.trim(),
        facilityId,
        facilityName,
        resources: {
          surgeBeds: form.surgeBeds,
          availableSurgeBeds: form.surgeBeds,
          emergencyKits: 0,
          oralRehydrationSachets: 0,
          choleraCots: 0,
          ppe: 0,
          emergencyMedications: [],
        },
        incidentCommander: form.incidentCommander.trim(),
        incidentCommanderPhone: form.incidentCommanderPhone.trim(),
        contactChain: [],
        estimatedCapacity: form.estimatedCapacity,
        currentLoad: 0,
        state: form.state.trim() || facilityState,
        totalCasesManaged: 0,
        totalDeaths: 0,
        totalReferralsOut: 0,
        orgId: currentUser?.orgId,
      });
      showToast(t('msg.emergencyPlanCreated'), 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      console.error(err);
      showToast(t('msg.emergencyPlanNotCreatedTry'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (plan: EmergencyPlanDoc) => {
    const actor = currentUser?.name || currentUser?.username || 'unknown';
    try {
      if (plan.phase === 'response') {
        await deactivatePlan(plan._id, actor, scope);
        showToast(t('msg.movedToRecovery', { planName: plan.planName }), 'success');
      } else {
        await activatePlan(plan._id, actor, undefined, scope);
        showToast(t('msg.activated', { planName: plan.planName }), 'success');
      }
      await load();
    } catch (err) {
      console.error(err);
      showToast(t('msg.planStatusNotChangedTry'), 'error');
    }
  };

  const activePlans = plans.filter(p => p.phase === 'response');
  const surgeTotal = plans.reduce((n, p) => n + p.resources.surgeBeds, 0);
  const surgeFree = plans.reduce((n, p) => n + p.resources.availableSurgeBeds, 0);
  const capacityTotal = plans.reduce((n, p) => n + p.estimatedCapacity, 0);
  const loadTotal = plans.reduce((n, p) => n + p.currentLoad, 0);
  const casesTotal = plans.reduce((n, p) => n + p.totalCasesManaged, 0);
  const GRID = 'minmax(200px, 1.6fr) minmax(130px, 1fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) 90px 90px minmax(150px, 1fr) 110px';

  return (
    <>
      <main className="page-container page-enter sadb-scope">
        <div className="sadb-page">
          <FacilityKpiBand tiles={[
            { key: 'active', label: 'Active responses', value: activePlans.length, detail: activePlans.length ? activePlans.map(p => p.planName).slice(0, 2).join(', ') : `Of ${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}, none activated`, warn: activePlans.length > 0, trend: weekOverWeek(plans, p => p.createdAt, 'created') },
            { key: 'beds', label: 'Surge beds free', value: `${surgeFree} of ${surgeTotal}`, detail: surgeTotal ? 'Free against the beds planned for surge' : 'No surge beds planned yet' },
            { key: 'load', label: 'Capacity in use', value: capacityTotal ? `${Math.round((loadTotal / capacityTotal) * 100)}%` : '0%', detail: `${loadTotal} patients against ${capacityTotal} planned places` },
            { key: 'cases', label: 'Cases managed', value: casesTotal, detail: 'Across every plan, from first activation' },
          ]} />

          <SadbCard
            title="Emergency plans"
            meta={`${plans.length}`}
            action={
              <button type="button" onClick={openForm} className="btn btn-primary" data-tour="emergency-new-plan">
                <Plus className="w-4 h-4" /> New plan
              </button>
            }
          >
            <div className="sadb-card-scroll">
              <SadbGridList
                template={GRID}
                minWidth={1040}
                head={['Plan', 'Type', 'Severity', 'Phase', 'Surge beds', 'Capacity', 'Incident commander', 'Action']}
                empty={loading ? 'Loading…' : 'No emergency plans yet. Create a surge plan for a cholera outbreak, mass casualty event, or other emergency.'}
              >
                {plans.map(plan => {
                  const isActive = plan.phase === 'response';
                  return (
                    <SadbGridRow key={plan._id} template={GRID}>
                      <span className="min-w-0">
                        <span className="sadb-tenant-name truncate">{plan.planName}</span>
                        <span className="block text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                          {plan.facilityName}{plan.county ? ` · ${plan.county}` : ''}{plan.state ? ` · ${plan.state}` : ''}
                        </span>
                      </span>
                      <span className="truncate">{TYPE_LABEL[plan.emergencyType] ?? plan.emergencyType}</span>
                      <span><Badge tone={severityTone(plan.severity)}>{SEVERITY_LABEL[plan.severity] ?? plan.severity}</Badge></span>
                      <span><Badge tone={phaseTone(plan.phase)}>{PHASE_LABEL[plan.phase] ?? plan.phase}</Badge></span>
                      <span className="sadb-tenant-num">{plan.resources.availableSurgeBeds}/{plan.resources.surgeBeds}</span>
                      <span className="sadb-tenant-num">{plan.currentLoad}/{plan.estimatedCapacity}</span>
                      <span className="min-w-0">
                        <span className="block truncate">{plan.incidentCommander}</span>
                        {plan.incidentCommanderPhone && (
                          <span className="block text-xs truncate" style={{ color: 'var(--text-muted)' }}>{plan.incidentCommanderPhone}</span>
                        )}
                      </span>
                      <span>
                        <button
                          type="button"
                          onClick={() => handleActivate(plan)}
                          className={`btn btn-sm ${isActive ? 'btn-secondary' : 'btn-primary'}`}
                        >
                          {isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </span>
                    </SadbGridRow>
                  );
                })}
              </SadbGridList>
            </div>
          </SadbCard>
        </div>

        {showForm && (
          <FormSlider
            title="New emergency plan"
            onClose={() => !submitting && setShowForm(false)}
            busy={submitting}
            footer={<>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary" disabled={submitting}>Cancel</button>
                <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Create plan'}
                </button>
            </>}
          >
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Plan name</label>
                  <input type="text" value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} placeholder="e.g. Cholera outbreak surge plan" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Emergency type</label>
                    <Select value={form.emergencyType} onChange={e => setForm({ ...form, emergencyType: e.target.value as EmergencyType })}>
                      {EMERGENCY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Severity</label>
                    <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as EmergencySeverity })}>
                      {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Phase</label>
                    <Select value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value as EmergencyPhase })}>
                      {PHASES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Description</label>
                  <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Scope, triggers, and key actions for this plan" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Surge beds</label>
                    <NumberInput step="1" min={0} value={form.surgeBeds} onChange={e => setForm({ ...form, surgeBeds: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Est. capacity / day</label>
                    <NumberInput step="1" min={0} value={form.estimatedCapacity} onChange={e => setForm({ ...form, estimatedCapacity: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>State</label>
                    <Select value={form.state} searchThreshold={0}
                      onChange={e => setForm({ ...form, state: e.target.value })}>
                      <option value="">State / region</option>
                      {states.map(state => <option key={state} value={state}>{locationLabel(state)}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Incident commander</label>
                    <input type="text" value={form.incidentCommander} onChange={e => setForm({ ...form, incidentCommander: e.target.value })} placeholder="Full name" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Commander phone</label>
                    <input type="tel" value={form.incidentCommanderPhone} onChange={e => setForm({ ...form, incidentCommanderPhone: e.target.value })} placeholder="Phone number" />
                  </div>
                </div>
              </div>
            </div>
          </FormSlider>
        )}
      </main>
    </>
  );
}
