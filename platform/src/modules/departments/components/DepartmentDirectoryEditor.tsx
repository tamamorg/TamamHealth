'use client';

import { useState } from 'react';
import { Calendar, Plus, Trash2 } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import type { ClinicDay, DepartmentDoc } from '../core/types';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export default function DepartmentDirectoryEditor({ facilityId, orgId }: { facilityId?: string; orgId?: string }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const { departments, loading, reload } = useDepartments(facilityId, orgId);
  const [editingId, setEditingId] = useState('');
  const [weekday, setWeekday] = useState<ClinicDay['weekday']>(1);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [savingId, setSavingId] = useState('');

  const persist = async (department: DepartmentDoc, patch: { queueEnabled?: boolean; clinicDays?: ClinicDay[] }) => {
    if (!scope) return;
    setSavingId(department._id);
    try {
      const { updateDepartmentConfiguration } = await import('../services/department-service');
      await updateDepartmentConfiguration({ id: department._id, scope, ...patch, actorId: currentUser?._id, actorName: currentUser?.name });
      await reload();
      showToast(t('facilitySettings.departmentSaved'), 'success');
    } catch {
      showToast(t('facilitySettings.departmentSaveFailed'), 'error');
    } finally {
      setSavingId('');
    }
  };

  const addHours = async (department: DepartmentDoc) => {
    if (!startTime || !endTime || startTime >= endTime || slotMinutes < 5) {
      showToast(t('facilitySettings.departmentTimeInvalid'), 'error');
      return;
    }
    const slot: ClinicDay = { weekday, startTime, endTime, slotMinutes };
    if (department.clinicDays.some(item => item.weekday === weekday && item.startTime === startTime && item.endTime === endTime)) return;
    await persist(department, { clinicDays: [...department.clinicDays, slot] });
    setEditingId('');
  };

  return (
    <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border-light)' }}>
      <div className="flex items-start gap-3 mb-4">
        <Calendar className="w-5 h-5 mt-0.5" style={{ color: 'var(--accent-primary)' }} />
        <div><h4 className="font-semibold">{t('facilitySettings.departmentDirectory')}</h4><p className="fs-hint">{t('facilitySettings.departmentDirectoryHint')}</p></div>
      </div>
      {loading ? <p className="fs-hint">{t('facilitySettings.departmentLoading')}</p> : departments.length === 0 ? (
        <p className="fs-hint">{t('facilitySettings.departmentProvisionFirst')}</p>
      ) : <div className="space-y-3">{departments.map(department => (
        <div key={department._id} className="p-3 rounded-lg" style={{ border: '1px solid var(--border-light)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><strong className="text-sm">{department.name}</strong><div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t(department.queueEnabled === false ? 'facilitySettings.departmentQueueOff' : 'facilitySettings.departmentQueueOn')}</div></div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={department.queueEnabled !== false} disabled={savingId === department._id} onChange={event => void persist(department, { queueEnabled: event.target.checked })} />{t('facilitySettings.departmentQueue')}</label>
              <button type="button" className="btn btn-secondary inline-flex items-center gap-1.5" onClick={() => setEditingId(editingId === department._id ? '' : department._id)}><Plus className="w-3.5 h-3.5" />{t('facilitySettings.departmentAddHours')}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {department.clinicDays.map((slot, index) => (
              <span key={`${department._id}-${index}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                {t(`facilitySettings.weekday.${DAYS[slot.weekday]}`)} · {slot.startTime}–{slot.endTime} · {slot.slotMinutes}m
                <button type="button" aria-label={t('facilitySettings.departmentRemoveHours')} disabled={savingId === department._id} onClick={() => void persist(department, { clinicDays: department.clinicDays.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {department.clinicDays.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('facilitySettings.departmentNoHours')}</span>}
          </div>
          {editingId === department._id && <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-3">
            <Select value={String(weekday)} onChange={event => setWeekday(Number(event.target.value) as ClinicDay['weekday'])} aria-label={t('facilitySettings.departmentWeekday')}>{DAYS.map((day, index) => <option key={day} value={index}>{t(`facilitySettings.weekday.${day}`)}</option>)}</Select>
            <input className="fs-input" type="time" value={startTime} aria-label={t('facilitySettings.departmentStartTime')} onChange={event => setStartTime(event.target.value)} />
            <input className="fs-input" type="time" value={endTime} aria-label={t('facilitySettings.departmentEndTime')} onChange={event => setEndTime(event.target.value)} />
            <input className="fs-input" type="number" min={5} step={5} value={slotMinutes} aria-label={t('facilitySettings.departmentSlotMinutes')} onChange={event => setSlotMinutes(Number(event.target.value))} />
            <button type="button" className="btn btn-primary sm:col-start-4" disabled={savingId === department._id} onClick={() => void addHours(department)}>{savingId === department._id ? t('facilitySettings.departmentSaving') : t('facilitySettings.departmentSaveHours')}</button>
          </div>}
        </div>
      ))}</div>}
    </div>
  );
}
