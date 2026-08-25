'use client';

/**
 * Request leave. Shared by /hr/leave and the "Add" menu, which opens it in
 * place wherever the user is and routes to /hr/leave only once the request
 * exists — see AddInquiryDialog for the reasoning.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { LEAVE_TYPES } from '@/app/(dashboard)/hr/hr-shared';
import type { LeaveType } from '@/lib/db-types-hr';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { expandHref } from '@/lib/navigation/expand-to-page';

const today = () => todayIso();
const tomorrow = () => toIsoDate(new Date(Date.now() + 86400000));

export interface RequestLeaveDialogProps {
  onClose: () => void;
  /**
   * 'page' renders the fields alone, for the matching `/new` route to host
   * inside `CreateRecordPage` — this popup's Expand control routes there.
   */
  presentation?: 'modal' | 'page';
  /** Runs once the request is written. */
  onCreated: () => void;
}

export default function RequestLeaveDialog({ onClose, onCreated, presentation = 'modal' }: RequestLeaveDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: '', leaveType: 'annual' as LeaveType,
    startDate: today(), endDate: tomorrow(), reason: '',
  });

  // Same approver list as the leave page: an approver books for anyone, and
  // everyone else books only for themselves.
  const isApprover = !!currentUser?.role
    && ['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin'].includes(currentUser.role);
  const selectable = isApprover ? users : users.filter(u => u._id === currentUser?._id);

  const submit = async () => {
    if (!form.userId) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (form.endDate < form.startDate) { showToast(t('hr.endDateAfterStart'), 'error'); return; }
    const user = users.find(u => u._id === form.userId);
    if (!user) return;
    setSaving(true);
    try {
      const { requestLeave } = await import('@/lib/services/leave-service');
      await requestLeave({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || currentUser?.hospitalId || '',
        facilityName: user.hospitalName || currentUser?.hospitalName || t('hr.defaultFacility'),
        leaveType: form.leaveType,
        startDate: form.startDate, endDate: form.endDate,
        reason: form.reason.trim() || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.leaveSubmittedFor', { name: user.name }), 'success');
      onCreated();
    } catch (err) {
      console.error(err);
      showToast(t('hr.leaveSubmitFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
          <Select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
            <option value="">{t('hr.selectStaffOption')}</option>
            {selectable.map(u => (
              <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelType')}</label>
            <Select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value as LeaveType })}>
              {LEAVE_TYPES.map(lt => <option key={lt.id} value={lt.id}>{t(`hr.leaveType_${lt.id}`)}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
            <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
            <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelReason')}</label>
          <textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={t('hr.optional')} />
        </div>
      </div>
      <hr className="section-divider" />
      <div className="flex gap-2 mt-2">
        <button onClick={onClose} className="btn btn-secondary flex-1" disabled={saving}>{t('hr.cancel')}</button>
        <button onClick={submit} className="btn btn-primary flex-1" disabled={saving}>{t('hr.submit')}</button>
      </div>
    </>
  );

  if (presentation === 'page') return body;

  return (
    <Modal onClose={onClose} width={448} labelledBy="request-leave-title">
      <div className="sadb-modal">
        <PopupHeader
          titleId="request-leave-title"
          title={t('hr.requestLeave')}
          subtitle={t('createPage.leaveNote')}
          onExpand={() => { onClose(); router.push(expandHref('/hr/leave/new')); }}
          onClose={onClose}
        />
        {body}
      </div>
    </Modal>
  );
}
