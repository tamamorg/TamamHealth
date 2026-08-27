'use client';

/**
 * Log a patient inquiry.
 *
 * Lives here, not inside the inquiries page, because the "Add" menu opens it
 * wherever the user is: they fill it in on the dashboard they were already
 * looking at, and only land on /inquiries once the record exists. Both callers
 * share this one form so the fields and validation cannot drift apart.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useUsers } from '@/lib/hooks/useUsers';
import { createEnquiry } from '@/lib/services/enquiry-service';
import type { MessageDoc } from '@/lib/db-types';
import { expandHref } from '@/lib/navigation/expand-to-page';

const EMPTY = { patientName: '', patientPhone: '', subject: '', body: '', assigneeId: '' };

export interface AddInquiryDialogProps {
  onClose: () => void;
  /** Runs with the created record once the write succeeds. */
  onCreated: (inquiry: MessageDoc) => void;
  /**
   * 'page' renders the fields alone, for `/inquiries/new` to host inside
   * `CreateRecordPage` — the popup's Expand control routes there.
   */
  presentation?: 'modal' | 'page';
}

export default function AddInquiryDialog({ onClose, onCreated, presentation = 'modal' }: AddInquiryDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilityUsers = useMemo(
    () => currentUser?.hospitalId ? users.filter(u => u.hospitalId === currentUser.hospitalId) : users,
    [users, currentUser?.hospitalId],
  );

  const submit = async () => {
    if (!form.patientName.trim() || !form.subject.trim() || !form.body.trim()) {
      setError('Patient name, subject, and message are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const assignee = form.assigneeId ? facilityUsers.find(u => u._id === form.assigneeId) : undefined;
      const created = await createEnquiry({
        patientName: form.patientName.trim(),
        patientPhone: form.patientPhone.trim() || undefined,
        subject: form.subject.trim(),
        body: form.body.trim(),
        facilityId: currentUser?.hospitalId,
        facilityName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        assignedTo: assignee ? { id: assignee._id, name: assignee.name } : undefined,
      });
      onCreated(created);
    } catch (err) {
      console.error('[inquiries] create failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to log the inquiry.');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      <div className="space-y-3">
        <div>
          <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Patient name</label>
          <input value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} placeholder="Full name" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Phone</label>
          <input value={form.patientPhone} onChange={e => setForm(f => ({ ...f, patientPhone: e.target.value }))} placeholder="Optional" />
        </div>
        <div>
          <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Subject</label>
          <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Prescription refill" />
        </div>
        <div>
          <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Message</label>
          <textarea rows={3} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="What the patient asked, in their own words" />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Assign to</label>
          <Select value={form.assigneeId} onChange={e => setForm(f => ({ ...f, assigneeId: e.target.value }))}>
            <option value="">Unassigned</option>
            {facilityUsers.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
      </div>
      <hr className="section-divider" />
      <div className="flex gap-2 mt-2">
        <button onClick={onClose} className="btn btn-secondary flex-1" disabled={saving}>Cancel</button>
        <button onClick={submit} className="btn btn-primary flex-1" disabled={saving}>
          {saving ? 'Saving\u2026' : 'Log inquiry'}
        </button>
      </div>
    </>
  );

  if (presentation === 'page') return body;

  return (
    <Modal onClose={onClose} width={448} labelledBy="add-inquiry-title">
      <div className="sadb-modal">
        <PopupHeader
          titleId="add-inquiry-title"
          title={t('createPage.inquiryTitle')}
          subtitle={t('createPage.inquiryNote')}
          onExpand={() => { onClose(); router.push(expandHref('/inquiries/new')); }}
          onClose={onClose}
        />
        {body}
      </div>
    </Modal>
  );
}
