'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePhoneNotes } from '@/lib/hooks/usePhoneNotes';
import type { PatientDoc } from '@/lib/db-types';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { formatDateTime } from '@/lib/format-utils';
import { patientFullName } from '@/lib/patient-utils';
import { isClinicalAuthorRole } from '@/lib/clinical-roles';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import '@/components/clinical-notes/note-viewer.css';
import RowActionsMenu from '@/components/RowActionsMenu';
import { FormError } from '@/components/overlay/FormNotices';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  open: { cls: 'tamam-panel-badge tamam-panel-badge--pending', label: 'Open' },
  responded: { cls: 'tamam-panel-badge tamam-panel-badge--done', label: 'Responded' },
  closed: { cls: 'tamam-panel-badge tamam-panel-badge--muted', label: 'Closed' },
};

/**
 * Phone notes on the patient chart (P1.4). Log a patient call and route it to a
 * provider; the provider responds and the exchange stays on the chart. Mirrors
 * the Centricity phone note workflow.
 */
export default function PhoneNotes({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { notes } = usePhoneNotes(patient._id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The call open in the slider, where it is read and answered.
  const [openId, setOpenId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [form, setForm] = useState({ callerName: '', callerPhone: '', subject: '', message: '', routedToId: '' });

  const providers = useMemo(
    () => users.filter((u) => isClinicalAuthorRole(u.role)),
    [users],
  );
  const isProvider = isClinicalAuthorRole(currentUser?.role);
  const openNote = notes.find(n => n._id === openId);
  const canRespond = openNote?.status === 'open' && isProvider;
  const closeForm = () => { setAdding(false); setOpenId(null); setResponseText(''); setError(null); };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAdding(false);
      setOpenId(null);
      setResponseText('');
      setForm({ callerName: '', callerPhone: '', subject: '', message: '', routedToId: '' });
    } catch (e) {
      setError(describeError(e, t('msg.changeNotSavedTryAgain')));
    } finally {
      setBusy(false);
    }
  }

  async function doCreate() {
    const svc = await import('@/lib/services/phone-note-service');
    const routedTo = providers.find((p) => p._id === form.routedToId);
    await svc.createPhoneNote({
      patientId: patient._id,
      patientName: patientFullName(patient),
      callerName: form.callerName || patientFullName(patient),
      callerPhone: form.callerPhone || patient.phone,
      subject: form.subject,
      message: form.message,
      routedToId: routedTo?._id,
      routedToName: routedTo?.name,
      recordedById: currentUser?._id,
      recordedByName: currentUser?.name || currentUser?.username,
      hospitalId: patient.registrationHospital,
      orgId: patient.orgId,
    });
  }
  async function doRespond(id: string) {
    const svc = await import('@/lib/services/phone-note-service');
    await svc.respondToPhoneNote(id, responseText, { userId: currentUser?._id, userName: currentUser?.name || currentUser?.username || 'Provider', userRole: currentUser?.role });
  }
  async function doClose(id: string) {
    const svc = await import('@/lib/services/phone-note-service');
    await svc.closePhoneNote(id);
  }

  return (
    <ChartSection title="Phone notes" addLabel="Log call" onAdd={() => setAdding(true)}>
      <p className="tamam-nl-helper">{t('notesList.phoneHelper')}</p>
      <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Message</th>
              <th>Caller</th>
              <th>Received</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {notes.length === 0 && (
              <tr>
                <td colSpan={6} style={{ cursor: 'default', background: 'transparent' }}>
                  <OmrsEmptyState itemLabel="phone notes" actionLabel="Log call" onAction={() => setAdding(true)} />
                </td>
              </tr>
            )}
            {notes.map((n) => {
              const badge = STATUS_BADGE[n.status] || STATUS_BADGE.open;
              return (
                <tr key={n._id}>
                  <td className="tamam-cell-strong">{n.subject}</td>
                  <td className="tamam-cell-note"><div className="tamam-cell-clamp" title={n.message}>{n.message}</div></td>
                  <td>
                    {n.callerName || 'Caller'}
                    {(n.recordedByName || n.routedToName) && (
                      <div className="tamam-cell-sub">
                        {[n.recordedByName && `logged by ${n.recordedByName}`, n.routedToName && `routed to ${n.routedToName}`].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>{formatDateTime(n.createdAt)}</td>
                  <td><span className={badge.cls}>{badge.label}</span></td>
                  <td>
                    <RowActionsMenu
                      ariaLabel={`Actions for ${n.subject}`}
                      actions={[
                        { key: 'view', label: t('phoneNotes.view'), onClick: () => setOpenId(n._id) },
                        ...(n.status === 'open' && isProvider ? [{ key: 'respond', label: t('phoneNotes.respond'), onClick: () => setOpenId(n._id) }] : []),
                        ...(n.status === 'open' ? [{ key: 'close', label: t('phoneNotes.closeCall'), disabled: busy, onClick: () => run(() => doClose(n._id)) }] : []),
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

      {error && !adding && !openNote && <FormError message={error} />}

      {adding && (
        <FormSlider
          title={t('phoneNotes.logTitle')}
          subtitle={patientFullName(patient)}
          className="tamam-dialog"
          onClose={closeForm}
          busy={busy}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t('action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={busy || !form.subject.trim() || !form.message.trim()} onClick={() => run(doCreate)}>{t('phoneNotes.save')}</button>
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('phoneNotes.caller')} optional hint={t('phoneNotes.callerHint')}>
              {control => <input {...control} type="text" value={form.callerName} onChange={e => setForm({ ...form, callerName: e.target.value })} />}
            </FormField>
            <FormField label={t('phoneNotes.callerPhone')} optional>
              {control => <input {...control} type="tel" value={form.callerPhone} onChange={e => setForm({ ...form, callerPhone: e.target.value })} />}
            </FormField>
            <FormField label={t('phoneNotes.subject')} required>
              {control => <input {...control} type="text" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder={t('phoneNotes.subjectPlaceholder')} />}
            </FormField>
            <FormField label={t('phoneNotes.message')} required>
              {control => <textarea {...control} rows={4} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder={t('phoneNotes.messagePlaceholder')} />}
            </FormField>
            <FormField label={t('phoneNotes.routeTo')} optional>
              {control => (
                <Select {...control} value={form.routedToId} onChange={e => setForm({ ...form, routedToId: e.target.value })}>
                  <option value="">{t('o3form.chooseOption')}</option>
                  {providers.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                </Select>
              )}
            </FormField>
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}

      {openNote && (
        <FormSlider
          title={openNote.subject}
          subtitle={formatDateTime(openNote.createdAt)}
          className="tamam-dialog"
          onClose={closeForm}
          busy={busy}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={closeForm}>{t(canRespond ? 'action.cancel' : 'action.close')}</button>
            {canRespond && (
              <button type="button" className="btn btn-primary" disabled={busy || !responseText.trim()} onClick={() => run(() => doRespond(openNote._id))}>{t('phoneNotes.sendResponse')}</button>
            )}
          </>}
        >
          <div className="space-y-4">
            <FormField label={t('phoneNotes.caller')}><p className="tamam-slider-value">{openNote.callerName || '—'}{openNote.callerPhone ? ` · ${openNote.callerPhone}` : ''}</p></FormField>
            <FormField label={t('phoneNotes.message')}><p className="tamam-slider-value">{openNote.message}</p></FormField>
            {openNote.recordedByName && <FormField label={t('phoneNotes.loggedBy')}><p className="tamam-slider-value">{openNote.recordedByName}</p></FormField>}
            {openNote.routedToName && <FormField label={t('phoneNotes.routedTo')}><p className="tamam-slider-value">{openNote.routedToName}</p></FormField>}
            {openNote.response && (
              <FormField label={t('phoneNotes.response')}>
                <p className="tamam-slider-value">{openNote.response}</p>
                <p className="tamam-slider-meta">{openNote.respondedByName} · {formatDateTime(openNote.respondedAt)}</p>
              </FormField>
            )}
            {canRespond && (
              <FormField label={t('phoneNotes.yourResponse')} required>
                {control => <textarea {...control} rows={4} value={responseText} onChange={e => setResponseText(e.target.value)} />}
              </FormField>
            )}
            {error && <FormError message={error} />}
          </div>
        </FormSlider>
      )}
    </ChartSection>
  );
}
