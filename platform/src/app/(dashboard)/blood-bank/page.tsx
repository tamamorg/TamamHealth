'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/Modal';
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
import { formatDate } from '@/lib/format-utils';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import { usePatients } from '@/lib/hooks/usePatients';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { patientFullName } from '@/lib/patient-utils';
import PatientAvatar from '@/components/patients/PatientAvatar';
import Select from '@/components/Select';
import { toIsoDate, todayIso } from '@/lib/date-utils';

const BLOOD_GROUPS: BloodBankDoc['bloodGroup'][] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const COMPONENTS: { value: BloodBankDoc['component']; label: string }[] = [
  { value: 'whole_blood', label: 'Whole blood' },
  { value: 'packed_rbc', label: 'Packed RBC' },
  { value: 'platelets', label: 'Platelets' },
  { value: 'ffp', label: 'Fresh frozen plasma' },
  { value: 'cryoprecipitate', label: 'Cryoprecipitate' },
];

const COMPONENT_LABEL: Record<BloodBankDoc['component'], string> =
  Object.fromEntries(COMPONENTS.map(c => [c.value, c.label])) as Record<BloodBankDoc['component'], string>;

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
      showToast('Failed to load blood units', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, scope]);

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
      showToast('Unit ID is required', 'error');
      return;
    }
    if (!form.collectionDate || !form.expiryDate) {
      showToast('Collection and expiry dates are required', 'error');
      return;
    }
    if (!facilityId) {
      showToast('No facility assigned to your account', 'error');
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
      showToast(`Blood unit ${form.unitId.trim()} stocked`, 'success');
      setOpen(false);
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast('Failed to stock blood unit', 'error');
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
      showToast('Select a patient to reserve this unit', 'error');
      return;
    }
    setReserving(true);
    try {
      const result = await reserveUnit(reserveUnitId, reservePatient._id);
      if (!result) throw new Error('reserve-failed');
      showToast(`Unit reserved for ${patientFullName(reservePatient)}`, 'success');
      closeReserve();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast('Failed to reserve unit — it may no longer be available', 'error');
    } finally {
      setReserving(false);
    }
  };

  const handleDiscard = async () => {
    if (!discardUnitId || !discardReason.trim()) {
      showToast('A reason is required to discard a unit', 'error');
      return;
    }
    setDiscarding(true);
    try {
      const result = await discardUnit(discardUnitId, discardReason.trim());
      if (!result) throw new Error('discard-failed');
      showToast('Unit discarded', 'success');
      closeDiscard();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast('Failed to discard unit', 'error');
    } finally {
      setDiscarding(false);
    }
  };

  const handleCrossmatch = async () => {
    if (!crossmatchUnitId) return;
    setCrossmatching(true);
    try {
      const result = await crossmatchUnit(crossmatchUnitId, crossmatchChoice);
      if (!result) throw new Error('crossmatch-failed');
      showToast(
        crossmatchChoice === 'compatible'
          ? 'Crossmatch recorded — compatible'
          : 'Crossmatch recorded as incompatible — unit returned to available inventory',
        'success',
      );
      closeCrossmatch();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast('Failed to record crossmatch result', 'error');
    } finally {
      setCrossmatching(false);
    }
  };

  const handleTransfuse = async () => {
    if (!transfuseUnitId) return;
    const unit = units.find(u => u._id === transfuseUnitId);
    if (!unit?.reservedForPatient) {
      showToast('No patient reservation found for this unit', 'error');
      return;
    }
    setTransfusing(true);
    try {
      const transfusedBy = currentUser?.name || currentUser?.username || currentUser?._id || 'Staff';
      const result = await recordTransfusion(transfuseUnitId, unit.reservedForPatient, transfusedBy);
      if (!result) throw new Error('transfuse-failed');
      showToast('Transfusion recorded', 'success');
      closeTransfuse();
      await loadUnits();
    } catch (err) {
      console.error(err);
      showToast('Failed to record transfusion', 'error');
    } finally {
      setTransfusing(false);
    }
  };

  // One popup for the table; the clicked row supplies its actions and position.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);

  const rowActions = (u: BloodBankDoc): RowAction[] => {
    const discardAction: RowAction = {
      key: 'discard',
      label: 'Discard',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      tone: 'danger',
      onClick: () => { setDiscardUnitId(u._id); setDiscardReason(''); },
    };
    switch (u.status) {
      case 'available':
        return [
          { key: 'reserve', label: 'Reserve', icon: <UserCheck className="w-3.5 h-3.5" />, onClick: () => setReserveUnitId(u._id) },
          discardAction,
        ];
      case 'reserved':
        return [
          {
            key: 'crossmatch',
            label: 'Record crossmatch',
            icon: <FlaskConical className="w-3.5 h-3.5" />,
            onClick: () => { setCrossmatchUnitId(u._id); setCrossmatchChoice('compatible'); },
          },
          discardAction,
        ];
      case 'crossmatched':
        return [
          { key: 'transfuse', label: 'Record transfusion', icon: <Syringe className="w-3.5 h-3.5" />, onClick: () => setTransfuseUnitId(u._id) },
          discardAction,
        ];
      default:
        return [];
    }
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Availability by blood group — one tile per group, count of AVAILABLE units.
            data-tour: guided-tour anchor for the lab journey's blood-bank step. */}
        <div className="dash-card mb-4" data-tour="bb-availability">
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <h3 className="font-semibold text-sm">Availability by blood group</h3>
          </div>
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {BLOOD_GROUPS.map((g, i) => (
                    <th
                      key={g}
                      className="text-[11px] font-bold uppercase tracking-wider px-2 py-1.5"
                      style={{ color: 'var(--accent-primary)', borderBottom: '1px solid var(--border-light)', borderInlineStart: i === 0 ? undefined : '1px solid var(--border-light)' }}
                    >
                      {g}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {BLOOD_GROUPS.map((g, i) => {
                    const count = availableByGroup[g] || 0;
                    const color = count === 0 ? 'var(--color-danger)' : count <= 2 ? 'var(--color-warning)' : 'var(--color-success)';
                    return (
                      <td
                        key={g}
                        className="text-base font-bold px-2 py-2"
                        style={{ color, fontVariantNumeric: 'tabular-nums', borderInlineStart: i === 0 ? undefined : '1px solid var(--border-light)' }}
                      >
                        {count}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Units table */}
        <div className="dash-card flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title="Blood units"
            stats={[
              { label: 'Units', value: unitStats.total, color: LIST_STAT_COLORS.muted },
              { label: 'Available', value: unitStats.available, color: LIST_STAT_COLORS.blue },
              { label: 'Reserved', value: unitStats.reserved, color: LIST_STAT_COLORS.amber },
              { label: 'Expiring ≤7d', value: unitStats.expiringSoon, color: LIST_STAT_COLORS.green },
            ]}
            search={{ value: unitSearch, onChange: setUnitSearch, placeholder: 'Filter table', ariaLabel: 'Search units by ID, group, status' }}
            actions={
              <button onClick={openModal} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <Plus className="w-4 h-4" /> Add unit
              </button>
            }
          />
          <div className="ehr-list-scroll">
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : units.length === 0 ? (
            <EmptyState
              icon={Droplets}
              title="No blood units stocked yet"
              message="Use “Add unit” to register one."
            />
          ) : visibleUnits.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No units match “{unitSearch}”.
            </div>
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
                  <th>Unit ID</th>
                  <th>Blood group</th>
                  <th>Component</th>
                  <th>Volume (ml)</th>
                  <th>Collected</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleUnits.map(u => {
                  const days = daysUntil(u.expiryDate);
                  const expired = u.status === 'expired' || days < 0;
                  const expiringSoon = !expired && days < 7;
                  const expiryColor = expired ? 'var(--color-danger)' : expiringSoon ? 'var(--color-warning)' : 'var(--text-muted)';
                  return (
                    <tr key={u._id} style={{ cursor: 'pointer' }} tabIndex={0}
                        onClick={e => setRowMenu(rowActionsAt(e, rowActions(u)))}
                        onKeyDown={e => { if (isRowActivationKey(e.key)) { e.preventDefault(); setRowMenu(rowActionsFromElement(e.currentTarget, rowActions(u))); } }}>
                      <td className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{u.unitId}</td>
                      <td>
                        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                          {u.bloodGroup}
                        </span>
                      </td>
                      <td className="text-sm">{COMPONENT_LABEL[u.component] || u.component}</td>
                      <td className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{u.volume}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(u.collectionDate)}</td>
                      <td className="text-xs font-semibold" style={{ color: expiryColor }}>
                        {formatDate(u.expiryDate)}
                        {expired ? ' · expired' : expiringSoon ? ` · ${days}d left` : ''}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />
          </div>
        </div>

        {/* Add unit modal */}
        {open && (
          <Modal onClose={() => setOpen(false)}>
            <div className="modal-panel modal-panel--md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="icon-box-sm">
                    <Droplets className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <h3 className="text-base font-semibold">Add blood unit</h3>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Unit ID</label>
                  <input
                    type="text"
                    value={form.unitId}
                    onChange={e => setForm({ ...form, unitId: e.target.value })}
                    placeholder="BU-2026-XXXXX"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Blood group</label>
                    <Select value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value as BloodBankDoc['bloodGroup'] })}>
                      {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Component</label>
                    <Select value={form.component} onChange={e => setForm({ ...form, component: e.target.value as BloodBankDoc['component'] })}>
                      {COMPONENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Volume (ml)</label>
                    <input
                      type="number"
                      min={1}
                      value={form.volume || ''}
                      onChange={e => setForm({ ...form, volume: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Donor name</label>
                    <input
                      type="text"
                      value={form.donorName}
                      onChange={e => setForm({ ...form, donorName: e.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Collection date</label>
                    <input type="date" value={form.collectionDate} onChange={e => setForm({ ...form, collectionDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Expiry date</label>
                    <input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setOpen(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button onClick={handleAdd} className="btn btn-primary flex-1">Stock unit</button>
              </div>
            </div>
          </Modal>
        )}

        {/* Reserve unit modal */}
        {reserveUnitId && (() => {
          const unit = units.find(u => u._id === reserveUnitId);
          if (!unit) return null;
          const isCompatible = reserveCompatibleGroups ? reserveCompatibleGroups.includes(unit.bloodGroup) : null;
          return (
            <Modal onClose={closeReserve}>
              <div className="modal-panel modal-panel--md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="icon-box-sm">
                      <UserCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <h3 className="text-base font-semibold">Reserve unit {unit.unitId}</h3>
                  </div>
                  <button onClick={closeReserve} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
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
                        <X className="w-3.5 h-3.5" /> Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <input
                        autoFocus
                        value={reserveQuery}
                        onChange={e => setReserveQuery(e.target.value)}
                        placeholder="Search by name, patient ID, or phone…"
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
                        ? `Unit ${unit.bloodGroup} is compatible with ${reservePatient.bloodType || 'the patient'}'s blood type.`
                        : `Note: unit ${unit.bloodGroup} is not typically compatible with ${reservePatient.bloodType || "this patient's"} blood type (compatible groups: ${reserveCompatibleGroups.join(', ') || '—'}).`}
                    </p>
                  )}
                </div>
                <hr className="section-divider" />
                <div className="flex gap-2 mt-2">
                  <button onClick={closeReserve} className="btn btn-secondary flex-1">Cancel</button>
                  <button onClick={handleReserve} disabled={!reservePatient || reserving} className="btn btn-primary flex-1">
                    {reserving ? 'Reserving…' : 'Reserve unit'}
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}

        {/* Discard unit modal */}
        {discardUnitId && (() => {
          const unit = units.find(u => u._id === discardUnitId);
          if (!unit) return null;
          return (
            <Modal onClose={closeDiscard}>
              <div className="modal-panel modal-panel--sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="icon-box-sm">
                      <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                    </div>
                    <h3 className="text-base font-semibold">Discard unit {unit.unitId}</h3>
                  </div>
                  <button onClick={closeDiscard} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Reason</label>
                    <textarea
                      autoFocus
                      rows={3}
                      value={discardReason}
                      onChange={e => setDiscardReason(e.target.value)}
                      placeholder="e.g. Failed screening, temperature excursion…"
                    />
                  </div>
                </div>
                <hr className="section-divider" />
                <div className="flex gap-2 mt-2">
                  <button onClick={closeDiscard} className="btn btn-secondary flex-1">Cancel</button>
                  <button onClick={handleDiscard} disabled={!discardReason.trim() || discarding} className="btn btn-danger flex-1">
                    {discarding ? 'Discarding…' : 'Discard unit'}
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
            <Modal onClose={closeCrossmatch}>
              <div className="modal-panel modal-panel--sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="icon-box-sm">
                      <FlaskConical className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <h3 className="text-base font-semibold">Record crossmatch — {unit.unitId}</h3>
                  </div>
                  <button onClick={closeCrossmatch} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
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
                      <CheckCircle2 className="w-4 h-4" /> Compatible
                    </button>
                    <button
                      type="button"
                      onClick={() => setCrossmatchChoice('incompatible')}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5"
                      style={crossmatchChoice === 'incompatible'
                        ? { background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)', border: '1px solid var(--color-danger)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                    >
                      <XCircle className="w-4 h-4" /> Incompatible
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {crossmatchChoice === 'compatible'
                      ? 'The unit will move to “crossmatched” and be ready for transfusion.'
                      : 'The unit will return to “available” inventory for a different patient.'}
                  </p>
                </div>
                <hr className="section-divider" />
                <div className="flex gap-2 mt-2">
                  <button onClick={closeCrossmatch} className="btn btn-secondary flex-1">Cancel</button>
                  <button onClick={handleCrossmatch} disabled={crossmatching} className="btn btn-primary flex-1">
                    {crossmatching ? 'Saving…' : 'Save result'}
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}

        {/* Transfuse unit modal */}
        {transfuseUnitId && (() => {
          const unit = units.find(u => u._id === transfuseUnitId);
          if (!unit) return null;
          const patient = patients.find(p => p._id === unit.reservedForPatient);
          return (
            <Modal onClose={closeTransfuse}>
              <div className="modal-panel modal-panel--sm" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="icon-box-sm">
                      <Syringe className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <h3 className="text-base font-semibold">Record transfusion — {unit.unitId}</h3>
                  </div>
                  <button onClick={closeTransfuse} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
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
                      Reserved patient: {unit.reservedForPatient || 'unknown'} (details unavailable)
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Recorded by {currentUser?.name || currentUser?.username || 'you'}.
                  </p>
                </div>
                <hr className="section-divider" />
                <div className="flex gap-2 mt-2">
                  <button onClick={closeTransfuse} className="btn btn-secondary flex-1">Cancel</button>
                  <button onClick={handleTransfuse} disabled={transfusing || !unit.reservedForPatient} className="btn btn-primary flex-1">
                    {transfusing ? 'Recording…' : 'Confirm transfusion'}
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}
      </main>
    </>
  );
}
