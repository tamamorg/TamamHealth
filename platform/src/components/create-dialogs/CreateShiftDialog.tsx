'use client';

/**
 * Schedule a shift. Shared by /hr/schedule and the "Add" menu, which opens it
 * in place wherever the user is and routes to /hr/schedule only once the shift
 * exists — see AddInquiryDialog for the reasoning.
 */

import { useMemo, useState } from 'react';
import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SHIFT_TYPES } from '@/app/(dashboard)/hr/hr-shared';
import type { StaffScheduleDoc } from '@/lib/db-types';
import { todayIso } from '@/lib/date-utils';

export interface CreateShiftDialogProps {
  onClose: () => void;
  /** Day the shift defaults to. Defaults to today. */
  defaultDate?: string;
  /** Runs with the shift's date once it is written, so a caller viewing one
   *  day can jump to the day the shift actually landed on. */
  onCreated: (shiftDate: string) => void;
}

export default function CreateShiftDialog({ onClose, defaultDate, onCreated }: CreateShiftDialogProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: '',
    shiftType: 'morning' as StaffScheduleDoc['shiftType'],
    shiftDate: defaultDate || todayIso(),
    startTime: '08:00',
    endTime: '16:00',
    department: '',
    isOnCall: false,
    notes: '',
  });

  const facilityId = currentUser?.hospitalId;
  const facilityUsers = useMemo(
    () => facilityId ? users.filter(u => u.hospitalId === facilityId) : users,
    [users, facilityId],
  );

  const submit = async () => {
    const user = users.find(u => u._id === form.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    setSaving(true);
    try {
      const { createSchedule } = await import('@/lib/services/staff-scheduling-service');
      await createSchedule({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || currentUser?.hospitalName || t('hr.defaultFacility'),
        shiftType: form.shiftType,
        shiftDate: form.shiftDate,
        startTime: form.startTime,
        endTime: form.endTime,
        department: form.department || undefined,
        isOnCall: form.isOnCall,
        notes: form.notes || undefined,
        status: 'scheduled',
        orgId: user.orgId,
      });
      showToast(t('hr.shiftScheduledFor', { name: user.name, shift: form.shiftType }), 'success');
      onCreated(form.shiftDate);
    } catch (err) {
      console.error(err);
      showToast(t('hr.scheduleCreateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={448}>
      <div className="modal-content card-elevated p-6 w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{t('hr.scheduleShift')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} title="Close" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
            <Select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              <option value="">{t('hr.selectStaffOption')}</option>
              {facilityUsers.map(u => (
                <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelShift')}</label>
              <Select value={form.shiftType} onChange={e => setForm({ ...form, shiftType: e.target.value as StaffScheduleDoc['shiftType'] })}>
                {SHIFT_TYPES.map(s => <option key={s} value={s} className="capitalize">{t(`hr.shiftType_${s}`)}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.date')}</label>
              <input type="date" value={form.shiftDate} onChange={e => setForm({ ...form, shiftDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
              <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
              <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelDepartment')}</label>
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder={t('hr.departmentPlaceholder')} />
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={form.isOnCall} onChange={e => setForm({ ...form, isOnCall: e.target.checked })} />
            {t('hr.onCallShift')}
          </label>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <hr className="section-divider" />
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="btn btn-secondary flex-1" disabled={saving}>{t('hr.cancel')}</button>
          <button onClick={submit} className="btn btn-primary flex-1" disabled={saving}>{t('hr.saveShift')}</button>
        </div>
      </div>
    </Modal>
  );
}
