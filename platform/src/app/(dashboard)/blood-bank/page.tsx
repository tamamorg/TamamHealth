'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/Modal';
import FormSlider from '@/components/overlay/FormSlider';
import { Droplets, Plus, X, Search, UserCheck, FlaskConical, Syringe, Trash2, CheckCircle2, XCircle } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import {
  getAllUnits,
  addUnit,
  reserveUnit,
  crossmatchUnit,
  recordTransfusion,
  discardUnit,
  getCompatibleGroups,
} from '@/lib/services/blood-bank-service';
import type { BloodBankDoc, PatientDoc } from '@/lib/db-types';
import Badge, { type BadgeTone } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { formatDate, humanizeStatus } from '@/lib/format-utils';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import FacilityKpiBand, { weekOverWeek } from '@/components/dashboards/FacilityKpiBand';
import RowActionsMenu from '@/components/RowActionsMenu';
import type { RowAction } from '@/components/RowActionsMenu';
import { usePatients } from '@/lib/hooks/usePatients';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { patientFullName } from '@/lib/patient-utils';
import PatientAvatar from '@/components/patients/PatientAvatar';
import Select from '@/components/Select';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { stopsClickPropagation } from '@/lib/a11y';
import { useTranslation } from '@/lib/i18n/useTranslation';
import NumberInput from '@/components/forms/NumberInput';

const BLOOD_GROUPS: BloodBankDoc['bloodGroup'][] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const COMPONENTS: { value: BloodBankDoc['component']; labelKey: string }[] = [
  { value: 'whole_blood', labelKey: 'bloodBank.componentWholeBlood' },
  { value: 'packed_rbc', labelKey: 'bloodBank.componentPackedRbc' },
  { value: 'platelets', labelKey: 'bloodBank.componentPlatelets' },
  { value: 'ffp', labelKey: 'bloodBank.componentFfp' },
  { value: 'cryoprecipitate', labelKey: 'bloodBank.componentCryo' },
];

const COMPONENT_LABEL_KEY: Record<BloodBankDoc['component'], string> =
  Object.fromEntries(COMPONENTS.map(c => [c.value, c.labelKey])) as Record<BloodBankDoc['component'], string>;

// Unit status → semantic Badge tone (available→success, reserved/crossmatched→
// warning, transfused→neutral, expired/discarded→danger).
const STATUS_TONE: Record<BloodBankDoc['status'], BadgeTone> = {
  available: 'success',
  reserved: 'warning',
  crossmatched: 'warning',
  transfused: 'neutral',
  expired: 'danger',
  discarded: 'danger',
};

const todayStr = () => todayIso();
const daysUntil = (date: string) =>
  Math.ceil((new Date(date).getTime() - new Date(todayStr()).getTime()) / 86400000);

export default function BloodBankPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { patients } = usePatients();
  const scope = useDataScope();

  const [units, setUnits] = useState<BloodBankDoc[]>([]);
  const [unitSearch, setUnitSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const facilityId = currentUser?.hospitalId || '';
  const facilityName = currentUser?.hospitalName || 'Facility';

  const suggestUnitId = useCallback(
    () => `BU-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    [],
  );

  const emptyForm = useCallback(() => ({
    unitId: suggestUnitId(),
    bloodGroup: 'O+' as BloodBankDoc['bloodGroup'],
    component: 'whole_blood' as BloodBankDoc['component'],
    volume: 450,
    collectionDate: todayStr(),
    expiryDate: toIsoDate(new Date(Date.now() + 42 * 86400000)),
    donorName: '',
    notes: '',
  }), [suggestUnitId]);

  const [form, setForm] = useState(emptyForm);

  const loadUnits = useCallback(async () => {
    if (!scope) return; // pre-hydration — re-runs once the user is known
    setLoading(true);
    try {
      // Scoped: the local DB holds every tenant's units in demo/offline mode,
      // so an unscoped read leaked other orgs' stock to org admins.
      const all = await getAllUnits(scope);
      setUnits(all);
    } catch (err) {
      console.error(err);
      showToast(t('msg.bloodUnitsNotLoadedReload'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, scope, t]);

  useEffect(() => { loadUnits(); }, [loadUnits]);

  // Top-bar search — filters the units table by ID, group, component,
  // status, or donor name.
  const visibleUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    if (!q) return units;
    return units.filter(u =>
      [u.unitId, u.bloodGroup, u.component, u.status, u.donorName]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [units, unitSearch]);

  // Available-unit counts per blood group (client-side from getAllUnits so the
  // summary tiles always match the table, regardless of the summary helper shape).
  const availableByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of BLOOD_GROUPS) counts[g] = 0;
    const now = new Date();
    for (const u of units) {
      if (u.status === 'available' && new Date(u.expiryDate) > now) {
        counts[u.bloodGroup] = (counts[u.bloodGroup] || 0) + 1;
      }
    }
    return counts;
  }, [units]);

  const outOfStock = BLOOD_GROUPS.filter(g => !availableByGroup[g]);
  const mostStocked = useMemo(() => {
    const top = Object.entries(availableByGroup).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? top : null;
  }, [availableByGroup]);

  // Header stat chips — computed from the units already loaded on this page.
  const unitStats = useMemo(() => {
    const now = new Date();
    let available = 0, reserved = 0, expiringSoon = 0;
    for (const u of units) {
      if (u.status === 'available') available += 1;
      if (u.status === 'reserved' || u.status === 'crossmatched') reserved += 1;
      const days = daysUntil(u.expiryDate);
      if (u.status !== 'expired' && u.status !== 'discarded' && u.status !== 'transfused' && new Date(u.expiryDate) >= now && days <= 7) {
        expiringSoon += 1;
      }
    }
    return { total: units.length, available, reserved, expiringSoon };
  }, [units]);

  const openModal = () => {
    setForm(emptyForm());
    setOpen(true);
  };

  const handleAdd = async () => {
    if (!form.unitId.trim()) {
      showToast(t('msg.enterTheUnitId'), 'error');
      return;
    }
    if (!form.collectionDate || !form.expiryDate) {
      showToast(t('msg.enterTheCollectionDateAnd'), 'error');
      return;
    }
    if (!facilityId) {
      showToast(t('equipment.toastNoFacility'), 'error');
      return;
    }
    try {
      await addUnit({
        unitId: form.unitId.trim(),
        bloodGroup: form.bloodGroup,
        component: form.component,
        volume: form.volume,
        collectionDate: form.collectionDate,
        expiryDate: form.expiryDate,
        donorName: form.donorName.trim() || undefined,
        status: 'available',
        facilityId,
        facilityName,
        notes: form.notes.trim() || undefined,
      });
      showToast(t('msg.bloodUnitAddedToInventory', { value: form.unitId.trim() }), 'success');
      setOpen(false);
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast(t('msg.bloodUnitNotAddedCheck'), 'error');
    }
  };

  // ── Unit lifecycle: reserve → crossmatch → transfuse, plus discard ──

  const [reserveUnitId, setReserveUnitId] = useState<string | null>(null);
  const [reserveQuery, setReserveQuery] = useState('');
  const [reservePatient, setReservePatient] = useState<PatientDoc | null>(null);
  const [reserveCompatibleGroups, setReserveCompatibleGroups] = useState<string[] | null>(null);
  const [reserving, setReserving] = useState(false);

  const [discardUnitId, setDiscardUnitId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [discarding, setDiscarding] = useState(false);

  const [crossmatchUnitId, setCrossmatchUnitId] = useState<string | null>(null);
  const [crossmatchChoice, setCrossmatchChoice] = useState<'compatible' | 'incompatible'>('compatible');
  const [crossmatching, setCrossmatching] = useState(false);

  const [transfuseUnitId, setTransfuseUnitId] = useState<string | null>(null);
  const [transfusing, setTransfusing] = useState(false);

  const closeReserve = useCallback(() => {
    setReserveUnitId(null);
    setReserveQuery('');
    setReservePatient(null);
    setReserveCompatibleGroups(null);
  }, []);
  const closeDiscard = useCallback(() => { setDiscardUnitId(null); setDiscardReason(''); }, []);
  const closeCrossmatch = useCallback(() => { setCrossmatchUnitId(null); setCrossmatchChoice('compatible'); }, []);
  const closeTransfuse = useCallback(() => { setTransfuseUnitId(null); }, []);

  const reserveMatches = useMemo(() => {
    const q = reserveQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    return patients.filter(p =>
      patientFullName(p).toLowerCase().includes(q) ||
      (p.hospitalNumber || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q),
    ).slice(0, 8);
  }, [reserveQuery, patients]);

  // Surface compatible donor groups for context once a patient is picked —
  // informational only, does not block reservation.
  useEffect(() => {
    if (!reservePatient) { setReserveCompatibleGroups(null); return; }
    let cancelled = false;
    getCompatibleGroups(reservePatient.bloodType || '').then(groups => {
      if (!cancelled) setReserveCompatibleGroups(groups);
    });
    return () => { cancelled = true; };
  }, [reservePatient]);

  const handleReserve = async () => {
    if (!reserveUnitId || !reservePatient) {
      showToast(t('msg.selectThePatientThisUnit'), 'error');
      return;
    }
    if (!scope) return;
    setReserving(true);
    try {
      const result = await reserveUnit(reserveUnitId, reservePatient._id, scope);
      if (!result) throw new Error('reserve-failed');
      showToast(t('msg.bloodUnitReservedFor', { value: patientFullName(reservePatient) }), 'success');
      closeReserve();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast(t('msg.bloodUnitNotReservedIt'), 'error');
    } finally {
      setReserving(false);
    }
  };

  const handleDiscard = async () => {
    if (!discardUnitId || !discardReason.trim()) {
      showToast(t('msg.enterTheReasonForDiscarding'), 'error');
      return;
    }
    if (!scope) return;
    setDiscarding(true);
    try {
      const result = await discardUnit(discardUnitId, discardReason.trim(), scope);
      if (!result) throw new Error('discard-failed');
      showToast(t('msg.bloodUnitDiscarded'), 'success');
      closeDiscard();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast(t('msg.bloodUnitNotDiscardedTry'), 'error');
    } finally {
      setDiscarding(false);
    }
  };

  const handleCrossmatch = async () => {
    if (!crossmatchUnitId || !scope) return;
    setCrossmatching(true);
    try {
      const result = await crossmatchUnit(crossmatchUnitId, crossmatchChoice, scope);
      if (!result) throw new Error('crossmatch-failed');
      showToast(
        crossmatchChoice === 'compatible'
          ? t('msg.crossmatchRecordedAsCompatible')
          : t('msg.crossmatchRecordedAsIncompatibleThe'),
        'success',
      );
      closeCrossmatch();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast(t('msg.crossmatchResultNotRecordedTry'), 'error');
    } finally {
      setCrossmatching(false);
    }
  };

  const handleTransfuse = async () => {
    if (!transfuseUnitId) return;
    const unit = units.find(u => u._id === transfuseUnitId);
    if (!unit?.reservedForPatient) {
      showToast(t('msg.thisUnitIsNotReserved'), 'error');
      return;
    }
    if (!scope) return;
    setTransfusing(true);
    try {
      const transfusedBy = currentUser?.name || currentUser?.username || currentUser?._id || 'Staff';
      const result = await recordTransfusion(transfuseUnitId, unit.reservedForPatient, transfusedBy, scope);
      if (!result) throw new Error('transfuse-failed');
      showToast(t('msg.transfusionRecorded'), 'success');
      closeTransfuse();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast(t('msg.transfusionNotRecordedTryAgain'), 'error');
    } finally {
      setTransfusing(false);
    }
  };

  // One popup for the table; the clicked row supplies its actions and position.

  const rowActions = (u: BloodBankDoc): RowAction[] => {
    const discardAction: RowAction = {
      key: 'discard',
      label: t('bloodBank.actDiscard'),
      icon: <Trash2 className="w-3.5 h-3.5" />,
      tone: 'danger',
      onClick: () => { setDiscardUnitId(u._id); setDiscardReason(''); },
    };
    switch (u.status) {
      case 'available':
        return [
          { key: 'reserve', label: t('bloodBank.actReserve'), icon: <UserCheck className="w-3.5 h-3.5" />, onClick: () => setReserveUnitId(u._id) },
          discardAction,
        ];
      case 'reserved':
        return [
          {
            key: 'crossmatch',
            label: t('bloodBank.actCrossmatch'),
            icon: <FlaskConical className="w-3.5 h-3.5" />,
            onClick: () => { setCrossmatchUnitId(u._id); setCrossmatchChoice('compatible'); },
          },
          discardAction,
        ];
      case 'crossmatched':
        return [
          { key: 'transfuse', label: t('bloodBank.actTransfuse'), icon: <Syringe className="w-3.5 h-3.5" />, onClick: () => setTransfuseUnitId(u._id) },
          discardAction,
        ];
      default:
        return [];
    }
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Headline stock figures as the management KPI band. The per-group
            counts that used to be a strip of eight tiles ride the detail
            lines (most stocked, and which groups have run out).
            data-tour: guided-tour anchor for the lab journey's blood-bank step. */}
        <div className="mb-3" data-tour="bb-availability">
          <FacilityKpiBand tiles={[
            {
              key: 'available', label: t('bloodBank.kpiAvailable'), value: unitStats.available,
              detail: mostStocked ? t('bloodBank.kpiMostStocked', { group: mostStocked[0], count: mostStocked[1] }) : t('bloodBank.kpiNoUsable'),
              trend: weekOverWeek(units, u => u.collectionDate, t('bloodBank.trendCollected'), 'up', t),
            },
            { key: 'reserved', label: t('bloodBank.kpiReserved'), value: unitStats.reserved, detail: t('bloodBank.kpiReservedDetail') },
            { key: 'expiring', label: t('bloodBank.kpiExpiring'), value: unitStats.expiringSoon, detail: t('bloodBank.kpiExpiringDetail'), warn: unitStats.expiringSoon > 0 },
            {
              key: 'outofstock', label: t('bloodBank.kpiOutOfStock'), value: outOfStock.length,
              detail: outOfStock.length ? outOfStock.join(', ') : t('bloodBank.kpiAllInStock', { count: BLOOD_GROUPS.length }),
              warn: outOfStock.length > 0,
            },
          ]} />
        </div>

        {/* Units table */}
        <div className="dash-card flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('ui.bloodUnits')}
            count={unitStats.total}
            search={{ value: unitSearch, onChange: setUnitSearch, placeholder: t('bloodBank.filterTable'), ariaLabel: t('bloodBank.searchAria') }}
            actions={
              <button type="button" onClick={openModal} className="btn btn-primary">
                <Plus className="w-4 h-4" /> {t('ui.addUnit')}
              </button>
            }
          />
          <div className="ehr-list-scroll">
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('admin.loading')}</div>
          ) : (
            <table className="data-table" style={{ minWidth: 960, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('ui.unitId')}</th>
                  <th>{t('ui.bloodGroup')}</th>
                  <th>{t('ui.component')}</th>
                  <th>{t('ui.volumeMl')}</th>
                  <th>{t('billing.kpiCollected')}</th>
                  <th>{t('billing.expires')}</th>
                  <th>{t('billing.activityColumn.status')}</th>
                  <th>{t('chart.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {units.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <EmptyState
                        icon={Droplets}
                        title={t('ui.noBloodUnitsStockedYet')}
                        message={t('bloodBank.emptyHint')}
                      />
                    </td>
                  </tr>
                ) : visibleUnits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('ui.noUnitsMatch')}{unitSearch}”.
                    </td>
                  </tr>
                ) : visibleUnits.map(u => {
                  const days = daysUntil(u.expiryDate);
                  const expired = u.status === 'expired' || days < 0;
                  const expiringSoon = !expired && days < 7;
                  const expiryColor = expired ? 'var(--color-danger)' : expiringSoon ? 'var(--color-warning)' : 'var(--text-muted)';
                  return (
                    <tr key={u._id}>
                      <td className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{u.unitId}</td>
                      <td>
                        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                          {u.bloodGroup}
                        </span>
                      </td>
                      <td className="text-sm">{COMPONENT_LABEL_KEY[u.component] ? t(COMPONENT_LABEL_KEY[u.component]) : u.component}</td>
                      <td className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{u.volume}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(u.collectionDate)}</td>
                      <td className="text-xs font-semibold" style={{ color: expiryColor }}>
                        {formatDate(u.expiryDate)}
                        {expired ? ` · ${t('bloodBank.expired')}` : expiringSoon ? ` · ${t('bloodBank.daysLeft', { days })}` : ''}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[u.status]}>{humanizeStatus(u.status)}</Badge>
                      </td>
                      <td><RowActionsMenu ariaLabel={t('bloodBank.actionsFor', { id: u.unitId })} actions={rowActions(u)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </div>

        {/* Add unit modal */}
        {open && (
          <FormSlider
            title={t('ui.addBloodUnit')}
            onClose={() => setOpen(false)}
            footer={<>
                <button onClick={() => setOpen(false)} className="btn btn-secondary">{t('action.cancel')}</button>
                <button onClick={handleAdd} className="btn btn-primary">{t('ui.stockUnit')}</button>
            </>}
          >
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.unitId')}</label>
                  <input
                    type="text"
                    value={form.unitId}
                    onChange={e => setForm({ ...form, unitId: e.target.value })}
                    placeholder={t('ui.bu2026Xxxxx')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.bloodGroup')}</label>
                    <Select value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value as BloodBankDoc['bloodGroup'] })}>
                      {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.component')}</label>
                    <Select value={form.component} onChange={e => setForm({ ...form, component: e.target.value as BloodBankDoc['component'] })}>
                      {COMPONENTS.map(c => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.volumeMl')}</label>
                    <NumberInput step="any"
                      min={1}
                      value={form.volume || ''}
                      onChange={e => setForm({ ...form, volume: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.donorName')}</label>
                    <input
                      type="text"
                      value={form.donorName}
                      onChange={e => setForm({ ...form, donorName: e.target.value })}
                      placeholder={t('hr.optional')}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.collectionDate')}</label>
                    <input type="date" value={form.collectionDate} onChange={e => setForm({ ...form, collectionDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.expiryDate')}</label>
                    <input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('postConsult.link.notes')}</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('hr.optional')} />
                </div>
              </div>
            </div>
          </FormSlider>
        )}

        {/* Reserve unit modal */}
        {reserveUnitId && (() => {
          const unit = units.find(u => u._id === reserveUnitId);
          if (!unit) return null;
          const isCompatible = reserveCompatibleGroups ? reserveCompatibleGroups.includes(unit.bloodGroup) : null;
          return (
            <FormSlider
              title={<>{t('ui.reserveUnit')} {unit.unitId}</>}
              onClose={closeReserve}
              footer={<>
                  <button onClick={closeReserve} className="btn btn-secondary">{t('action.cancel')}</button>
                  <button onClick={handleReserve} disabled={!reservePatient || reserving} className="btn btn-primary">
                    {reserving ? t('bloodBank.reserving') : t('bloodBank.reserveUnit')}
                  </button>
              </>}
            >
              <div className="space-y-4">
                <div className="space-y-3">
                  {reservePatient ? (
                    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                      <PatientAvatar patient={reservePatient} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{patientFullName(reservePatient)}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {reservePatient.hospitalNumber || '-'}{reservePatient.bloodType ? ` · ${reservePatient.bloodType}` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => { setReservePatient(null); setReserveQuery(''); }} className="btn btn-sm btn-secondary">
                        <X className="w-3.5 h-3.5" /> {t('consultation.change')}
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <input
                        autoFocus
                        value={reserveQuery}
                        onChange={e => setReserveQuery(e.target.value)}
                        placeholder={t('ui.searchByNamePatientId')}
                        style={{ paddingInlineStart: 40 }}
                      />
                      {reserveMatches.length > 0 && (
                        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
                          {reserveMatches.map(p => (
                            <button
                              key={p._id}
                              type="button"
                              onClick={() => setReservePatient(p)}
                              className="w-full text-start px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--table-row-hover)]"
                              style={{ borderBottom: '1px solid var(--border-light)' }}
                            >
                              <PatientAvatar patient={p} size={26} />
                              <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{patientFullName(p)}</span>
                              <span className="text-[11px] font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {reservePatient && reserveCompatibleGroups && (
                    <p className="text-xs" style={{ color: isCompatible ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
                      {isCompatible
                        ? t('bloodBank.compatibleMsg', { group: unit.bloodGroup, type: reservePatient.bloodType || t('bloodBank.thePatient') })
                        : t('bloodBank.incompatibleMsg', { group: unit.bloodGroup, type: reservePatient.bloodType || t('bloodBank.thisPatient'), groups: reserveCompatibleGroups.join(', ') || '—' })}
                    </p>
                  )}
                </div>
              </div>
            </FormSlider>
          );
        })()}

        {/* Discard unit modal */}
        {discardUnitId && (() => {
          const unit = units.find(u => u._id === discardUnitId);
          if (!unit) return null;
          return (
            <Modal variant="slider" onClose={closeDiscard}>
              <div className="modal-panel modal-panel--sm" {...stopsClickPropagation}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="icon-box-sm">
                      <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                    </div>
                    <h3 className="text-base font-semibold">{t('ui.discardUnit')} {unit.unitId}</h3>
                  </div>
                  <button onClick={closeDiscard} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('appointments.labelReason')}</label>
                    <textarea
                      autoFocus
                      rows={3}
                      value={discardReason}
                      onChange={e => setDiscardReason(e.target.value)}
                      placeholder={t('ui.eGFailedScreeningTemperature')}
                    />
                  </div>
                </div>
                <hr className="section-divider" />
                <div className="flex gap-2 mt-2">
                  <button onClick={closeDiscard} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                  <button onClick={handleDiscard} disabled={!discardReason.trim() || discarding} className="btn btn-danger flex-1">
                    {discarding ? t('bloodBank.discarding') : t('bloodBank.discardUnit')}
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}

        {/* Crossmatch modal */}
        {crossmatchUnitId && (() => {
          const unit = units.find(u => u._id === crossmatchUnitId);
          if (!unit) return null;
          return (
            <FormSlider
              title={<>{t('ui.recordCrossmatch')} {unit.unitId}</>}
              onClose={closeCrossmatch}
              footer={<>
                  <button onClick={closeCrossmatch} className="btn btn-secondary">{t('action.cancel')}</button>
                  <button onClick={handleCrossmatch} disabled={crossmatching} className="btn btn-primary">
                    {crossmatching ? t('bloodBank.saving') : t('bloodBank.saveResult')}
                  </button>
              </>}
            >
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCrossmatchChoice('compatible')}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5"
                      style={crossmatchChoice === 'compatible'
                        ? { background: 'var(--color-success-bg, rgba(10, 110, 74,0.12))', color: 'var(--color-success-text)', border: '1px solid var(--color-success)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                    >
                      <CheckCircle2 className="w-4 h-4" /> {t('ui.compatible')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrossmatchChoice('incompatible')}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5"
                      style={crossmatchChoice === 'incompatible'
                        ? { background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', border: '1px solid var(--color-danger)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                    >
                      <XCircle className="w-4 h-4" /> {t('ui.incompatible')}
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {crossmatchChoice === 'compatible'
                      ? t('bloodBank.crossmatchCompatibleNote')
                      : t('bloodBank.crossmatchIncompatibleNote')}
                  </p>
                </div>
              </div>
            </FormSlider>
          );
        })()}

        {/* Transfuse unit modal */}
        {transfuseUnitId && (() => {
          const unit = units.find(u => u._id === transfuseUnitId);
          if (!unit) return null;
          const patient = patients.find(p => p._id === unit.reservedForPatient);
          return (
            <FormSlider
              title={<>{t('ui.recordTransfusion')} {unit.unitId}</>}
              onClose={closeTransfuse}
              footer={<>
                  <button onClick={closeTransfuse} className="btn btn-secondary">{t('action.cancel')}</button>
                  <button onClick={handleTransfuse} disabled={transfusing || !unit.reservedForPatient} className="btn btn-primary">
                    {transfusing ? t('bloodBank.recording') : t('bloodBank.confirmTransfusion')}
                  </button>
              </>}
            >
              <div className="space-y-4">
                <div className="space-y-3">
                  {patient ? (
                    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                      <PatientAvatar patient={patient} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{patientFullName(patient)}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{patient.hospitalNumber || '-'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('ui.reservedPatient')} {unit.reservedForPatient || 'unknown'} {t('ui.detailsUnavailable')}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t('meds.reported.colRecorded')} {currentUser?.name || currentUser?.username || 'you'}.
                  </p>
                </div>
              </div>
            </FormSlider>
          );
        })()}
      </main>
    </>
  );
}
