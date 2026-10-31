'use client';

import { useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Calendar, ClipboardList, MapPin, CheckCircle, ArrowRightLeft } from '@/components/icons/lucide';
import { formatClockTime } from '@/lib/format-utils';
import type { AppointmentDoc } from '@/lib/db-types';
import { DetailRow } from '@/components/front-desk/DetailPanel';

// ── An appointment already checked in: the booking's detail, with Undo while
//    it is still only checked in. A booking not yet in checks in from its own
//    row's drop-down instead (RowCheckIn), not from here. ──
export default function CheckInModal({
  appt,
  onClose,
  onUndoCheckIn,
  onViewPatient,
}: {
  appt: AppointmentDoc;
  onClose: () => void;
  onUndoCheckIn: (appt: AppointmentDoc) => Promise<void>;
  onViewPatient: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const [reversing, setReversing] = useState(false);
  // Only a plain check-in (not yet in consult / completed) can be cleanly
  // reversed back to scheduled without stepping over later workflow state.
  const canReverseCheckIn = appt.status === 'checked_in';

  return (
    <FormSlider
      title={t('frontDesk.checkInTitle')}
      subtitle={appt.patientName}
      width={440}
      onClose={onClose}
      footer={<>
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
          </div>
      </>}
    >
      <div className="space-y-4">
        {/* Body — appointment detail */}
        <div className="p-4 space-y-2.5">
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <DetailRow icon={<Calendar className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colTime')} value={formatClockTime(appt.appointmentTime)} />
            <DetailRow icon={<ClipboardList className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.colComplaint')} value={appt.reason || '—'} />
            <DetailRow icon={<MapPin className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />} label={t('frontDesk.department')} value={appt.department || '—'} />
          </div>
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
            <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-success)' }} />
            <p className="text-[12px]" style={{ color: 'var(--text-primary)' }}>{t('frontDesk.alreadyInQueue')}</p>
          </div>
        </div>

        {/* Footer */}
      </div>
    </FormSlider>
  );
}
