'use client';

import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/Modal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ClipboardCheck, X, Calendar, ClipboardList, MapPin, CheckCircle, ArrowRightLeft } from '@/components/icons/lucide';
import { formatClockTime } from '@/lib/format-utils';
import type { AppointmentDoc } from '@/lib/db-types';
import { DetailRow } from '@/components/front-desk/DetailPanel';

// ── Appointment check-in modal: confirm the patient has arrived; on check-in
//    they're added to the live patient queue. ──
export default function CheckInModal({
  appt,
  onClose,
  onCheckIn,
  onUndoCheckIn,
  onViewPatient,
}: {
  appt: AppointmentDoc;
  onClose: () => void;
  onCheckIn: (appt: AppointmentDoc, attendanceType: 'new' | 'repeat') => Promise<void>;
  onUndoCheckIn: (appt: AppointmentDoc) => Promise<void>;
  onViewPatient: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [reversing, setReversing] = useState(false);
  const alreadyIn = appt.status === 'checked_in' || appt.status === 'in_progress' || appt.status === 'completed';
  // Only a plain check-in (not yet in consult / completed) can be cleanly
  // reversed back to scheduled without stepping over later workflow state.
  const canReverseCheckIn = appt.status === 'checked_in';

  // Visit type (new vs re-attendance) — auto-derived from the patient's
  // history when the modal opens; the clerk can override before confirming.
  const [attendanceType, setAttendanceType] = useState<'new' | 'repeat'>('new');
  const attendanceTouchedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { deriveAttendanceType } = await import('@/lib/services/check-in-service');
        const derived = await deriveAttendanceType(appt.patientId);
        if (!cancelled && !attendanceTouchedRef.current) setAttendanceType(derived);
      } catch {
        if (!cancelled && !attendanceTouchedRef.current) setAttendanceType('new');
      }
    })();
    return () => { cancelled = true; };
  }, [appt.patientId]);

  return (
    <Modal onClose={onClose} width={440}>
      <div className="modal-content card-elevated" style={{ width: '100%' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{t('frontDesk.checkInTitle')}</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{appt.patientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body — appointment detail */}
        <div className="p-4 space-y-2.5">
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <DetailRow icon={<Calendar className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colTime')} value={formatClockTime(appt.appointmentTime)} />
            <DetailRow icon={<ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colComplaint')} value={appt.reason || '—'} />
            <DetailRow icon={<MapPin className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.department')} value={appt.department || '—'} />
          </div>
          {!alreadyIn && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                {t('frontDesk.visitType')}
              </label>
              <div className="flex gap-2">
                {([['new', t('frontDesk.newVisit')], ['repeat', t('frontDesk.reAttendance')]] as const).map(([key, lbl]) => {
                  const on = attendanceType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { attendanceTouchedRef.current = true; setAttendanceType(key); }}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all"
                      style={on
                        ? { background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }
                        : { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {alreadyIn && (
            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
              <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
              <p className="text-[12px]" style={{ color: 'var(--text-primary)' }}>{t('frontDesk.alreadyInQueue')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button onClick={() => onViewPatient(appt.patientId)} className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--accent-primary)' }}>
            {t('frontDesk.viewProfile')}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--text-muted)' }}>
              {t('action.cancel')}
            </button>
            {/* Reverse a mistaken check-in — sends the appointment back to
                scheduled and drops it from the live queue. */}
            {canReverseCheckIn && (
              <button
                onClick={async () => { setReversing(true); try { await onUndoCheckIn(appt); } finally { setReversing(false); } }}
                disabled={reversing}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5 disabled:opacity-50"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
              >
                <ArrowRightLeft className="w-4 h-4" />
                {reversing ? '…' : t('action.undo')}
              </button>
            )}
            {!alreadyIn && (
              <button
                onClick={async () => { setChecking(true); try { await onCheckIn(appt, attendanceType); } finally { setChecking(false); } }}
                disabled={checking}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--color-success)' }}
              >
                <CheckCircle className="w-4 h-4" />
                {checking ? t('frontDesk.checkingIn') : t('frontDesk.checkIn')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
