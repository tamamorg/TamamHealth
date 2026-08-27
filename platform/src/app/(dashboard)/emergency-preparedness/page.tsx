'use client';

import { useState, useEffect, useCallback } from 'react';
import Modal from '@/components/Modal';
import { AlertTriangle, ShieldAlert, Phone, Users, BedDouble, Activity, Plus, X } from '@/components/icons/lucide';
import EhrListHeader from '@/components/ehr/EhrListHeader';
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
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { states } from '@/lib/data/south-sudan-reference';

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
      showToast('Failed to load emergency plans', 'error');
    } finally {
      setLoading(false);
    }
  }, [scope, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openForm = () => {
    setForm({ ...EMPTY_FORM, state: facilityState });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.planName.trim()) {
      showToast('Plan name is required', 'error');
      return;
    }
    if (!form.incidentCommander.trim()) {
      showToast('Incident commander is required', 'error');
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
      showToast('Emergency plan created', 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      console.error(err);
      showToast('Failed to create emergency plan', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (plan: EmergencyPlanDoc) => {
    const actor = currentUser?.name || currentUser?.username || 'unknown';
    try {
      if (plan.phase === 'response') {
        await deactivatePlan(plan._id, actor, scope);
        showToast(`${plan.planName} moved to recovery`, 'success');
      } else {
        await activatePlan(plan._id, actor, undefined, scope);
        showToast(`${plan.planName} activated`, 'success');
      }
      await load();
    } catch (err) {
      console.error(err);
      showToast('Failed to update plan status', 'error');
    }
  };

  return (
    <>
      <main className="page-container page-enter">
        <div className="dash-card overflow-hidden mb-4">
          <EhrListHeader
            title="Emergency Preparedness"
            actions={
              <button onClick={openForm} className="btn btn-primary" data-tour="emergency-new-plan" style={{ marginInlineStart: 'auto', height: 38, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <Plus className="w-4 h-4" /> New plan
              </button>
            }
          />
        </div>
        {loading ? (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : plans.length === 0 ? (
          <div className="dash-card">
            <EmptyState
              icon={AlertTriangle}
              title="No emergency plans yet"
              message="Create a surge plan for a cholera outbreak, mass casualty event, or other emergency."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {plans.map(plan => {
              const isActive = plan.phase === 'response';
              return (
                <div key={plan._id} className="dash-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{plan.planName}</h3>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        {plan.facilityName}{plan.county ? ` · ${plan.county}` : ''}{plan.state ? ` · ${plan.state}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Badge tone={severityTone(plan.severity)} uppercase>
                        {plan.severity.replace('_', ' ')}
                      </Badge>
                      <Badge tone={phaseTone(plan.phase)} uppercase>
                        {PHASE_LABEL[plan.phase] ?? plan.phase}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <Badge tone="neutral">
                      {TYPE_LABEL[plan.emergencyType] ?? plan.emergencyType}
                    </Badge>
                  </div>

                  {plan.description && (
                    <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{plan.description}</p>
                  )}

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        <BedDouble className="w-3 h-3" /> Surge beds
                      </span>
                      <span className="text-sm font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {plan.resources.availableSurgeBeds}/{plan.resources.surgeBeds}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        <Activity className="w-3 h-3" /> Capacity
                      </span>
                      <span className="text-sm font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {plan.currentLoad}/{plan.estimatedCapacity}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        <Users className="w-3 h-3" /> Cases
                      </span>
                      <span className="text-sm font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {plan.totalCasesManaged}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Incident commander</p>
                      <p className="text-xs font-semibold truncate">{plan.incidentCommander}</p>
                      {plan.incidentCommanderPhone && (
                        <p className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          <Phone className="w-3 h-3" /> {plan.incidentCommanderPhone}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleActivate(plan)}
                      className={`btn btn-sm flex-shrink-0 ${isActive ? 'btn-secondary' : 'btn-primary'}`}
                    >
                      {isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showForm && (
          <Modal onClose={() => !submitting && setShowForm(false)}>
            <div className="modal-content card-elevated p-6 max-w-2xl w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h3 className="text-base font-semibold">New emergency plan</h3>
                </div>
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Plan name</label>
                  <input type="text" value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} placeholder="e.g. Cholera outbreak surge plan" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Emergency type</label>
                    <Select value={form.emergencyType} onChange={e => setForm({ ...form, emergencyType: e.target.value as EmergencyType })}>
                      {EMERGENCY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Severity</label>
                    <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as EmergencySeverity })}>
                      {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Phase</label>
                    <Select value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value as EmergencyPhase })}>
                      {PHASES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Description</label>
                  <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Scope, triggers, and key actions for this plan" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Surge beds</label>
                    <input type="number" min={0} value={form.surgeBeds} onChange={e => setForm({ ...form, surgeBeds: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Est. capacity / day</label>
                    <input type="number" min={0} value={form.estimatedCapacity} onChange={e => setForm({ ...form, estimatedCapacity: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>State</label>
                    <Select value={form.state} searchThreshold={0}
                      onChange={e => setForm({ ...form, state: e.target.value })}>
                      <option value="">State / region</option>
                      {states.map(state => <option key={state} value={state}>{state}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Incident commander</label>
                    <input type="text" value={form.incidentCommander} onChange={e => setForm({ ...form, incidentCommander: e.target.value })} placeholder="Full name" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Commander phone</label>
                    <input type="tel" value={form.incidentCommanderPhone} onChange={e => setForm({ ...form, incidentCommanderPhone: e.target.value })} placeholder="Phone number" />
                  </div>
                </div>
              </div>

              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary flex-1" disabled={submitting}>Cancel</button>
                <button type="button" onClick={handleSubmit} className="btn btn-primary flex-1" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Create plan'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </>
  );
}
