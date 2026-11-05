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

const EMERGENCY_TYPES: EmergencyType[] = [
  'disease_outbreak', 'cholera_outbreak', 'measles_outbreak', 'ebola', 'flood',
  'conflict', 'famine', 'mass_casualty', 'infrastructure_failure',
];
const PHASES: EmergencyPhase[] = ['preparedness', 'alert', 'response', 'recovery', 'closed'];
const SEVERITIES: EmergencySeverity[] = ['level_1', 'level_2', 'level_3'];

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
            { key: 'active', label: t('emergencyPrep.kpiActive'), value: activePlans.length, detail: activePlans.length ? activePlans.map(p => p.planName).slice(0, 2).join(', ') : t(plans.length === 1 ? 'emergencyPrep.kpiNoneActivatedOne' : 'emergencyPrep.kpiNoneActivated', { count: plans.length }), warn: activePlans.length > 0, trend: weekOverWeek(plans, p => p.createdAt, t('emergencyPrep.trendCreated'), 'up', t) },
            { key: 'beds', label: t('emergencyPrep.kpiSurgeFree'), value: t('emergencyPrep.kpiSurgeValue', { free: surgeFree, total: surgeTotal }), detail: surgeTotal ? t('emergencyPrep.kpiSurgeDetail') : t('emergencyPrep.kpiSurgeNone') },
            { key: 'load', label: t('emergencyPrep.kpiCapacity'), value: capacityTotal ? `${Math.round((loadTotal / capacityTotal) * 100)}%` : '0%', detail: t('emergencyPrep.kpiCapacityDetail', { load: loadTotal, capacity: capacityTotal }) },
            { key: 'cases', label: t('emergencyPrep.kpiCases'), value: casesTotal, detail: t('emergencyPrep.kpiCasesDetail') },
          ]} />

          <SadbCard
            title={t('emergencyPrep.plansTitle')}
            meta={`${plans.length}`}
            action={
              <button type="button" onClick={openForm} className="btn btn-primary" data-tour="emergency-new-plan">
                <Plus className="w-4 h-4" /> {t('ui.newPlan')}
              </button>
            }
          >
            <div className="sadb-card-scroll">
              <SadbGridList
                template={GRID}
                minWidth={1040}
                head={[t('emergencyPrep.colPlan'), t('emergencyPrep.colType'), t('epidemic.colSeverity'), t('ui.phase'), t('ui.surgeBeds'), t('orgHospitals.groupCapacity'), t('ui.incidentCommander'), t('emergencyPrep.colAction')]}
                empty={loading ? t('admin.loading') : t('emergencyPrep.emptyPlans')}
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
                      <span className="truncate">{t(`emergencyPrep.type_${plan.emergencyType}`)}</span>
                      <span><Badge tone={severityTone(plan.severity)}>{t(`emergencyPrep.severityShort_${plan.severity}`)}</Badge></span>
                      <span><Badge tone={phaseTone(plan.phase)}>{t(`emergencyPrep.phase_${plan.phase}`)}</Badge></span>
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
                          {isActive ? t('emergencyPrep.deactivate') : t('emergencyPrep.activate')}
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
            title={t('ui.newEmergencyPlan')}
            onClose={() => !submitting && setShowForm(false)}
            busy={submitting}
            footer={<>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary" disabled={submitting}>{t('action.cancel')}</button>
                <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={submitting}>
                  {submitting ? t('emergencyPrep.saving') : t('emergencyPrep.createPlan')}
                </button>
            </>}
          >
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.planName')}</label>
                  <input type="text" value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} placeholder={t('ui.eGCholeraOutbreakSurge')} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.emergencyType')}</label>
                    <Select value={form.emergencyType} onChange={e => setForm({ ...form, emergencyType: e.target.value as EmergencyType })}>
                      {EMERGENCY_TYPES.map(v => <option key={v} value={v}>{t(`emergencyPrep.type_${v}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('epidemic.colSeverity')}</label>
                    <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as EmergencySeverity })}>
                      {SEVERITIES.map(v => <option key={v} value={v}>{t(`emergencyPrep.severity_${v}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.phase')}</label>
                    <Select value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value as EmergencyPhase })}>
                      {PHASES.map(v => <option key={v} value={v}>{t(`emergencyPrep.phase_${v}`)}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.description')}</label>
                  <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('ui.scopeTriggersAndKeyActions')} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.surgeBeds')}</label>
                    <NumberInput step="1" min={0} value={form.surgeBeds} onChange={e => setForm({ ...form, surgeBeds: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.estCapacityDay')}</label>
                    <NumberInput step="1" min={0} value={form.estimatedCapacity} onChange={e => setForm({ ...form, estimatedCapacity: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('births.colState')}</label>
                    <Select value={form.state} searchThreshold={0}
                      onChange={e => setForm({ ...form, state: e.target.value })}>
                      <option value="">{t('ui.stateRegion')}</option>
                      {states.map(state => <option key={state} value={state}>{locationLabel(state)}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.incidentCommander')}</label>
                    <input type="text" value={form.incidentCommander} onChange={e => setForm({ ...form, incidentCommander: e.target.value })} placeholder={t('adminUsers.fieldFullName')} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.commanderPhone')}</label>
                    <input type="tel" value={form.incidentCommanderPhone} onChange={e => setForm({ ...form, incidentCommanderPhone: e.target.value })} placeholder={t('billing.phoneNumber')} />
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
