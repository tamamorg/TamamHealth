'use client';

import { useMemo } from 'react';
import { Loader2 } from '@/components/icons/lucide';
import Badge, { toneForStatus } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { patientInitials, avatarTint } from '@/lib/patient-utils';
import { useMobileShellState } from '@/lib/mobile-shell/use-mobile-shell-state';
import MobileWeekStrip from './MobileWeekStrip';
import { useAuth } from '@/lib/context';
import { appointmentsVisibleToUser } from '@/lib/appointment-visibility';

export default function MobileCalendarView() {
  const { appointments, loading } = useAppointments();
  const { currentUser } = useAuth();
  const shell = useMobileShellState();
  const visibleAppointments = useMemo(
    () => appointmentsVisibleToUser(appointments, currentUser),
    [appointments, currentUser],
  );

  const daysWithAppointments = useMemo(() => new Set(visibleAppointments.map((a) => a.appointmentDate)), [visibleAppointments]);
  const dayAppointments = useMemo(
    () => visibleAppointments.filter((a) => a.appointmentDate === shell.day).sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime)),
    [visibleAppointments, shell.day]
  );

  if (loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mobile-calendar">
      <MobileWeekStrip selectedDay={shell.day} onSelect={shell.setDay} daysWithAppointments={daysWithAppointments} />
      <div className="mobile-calendar-list">
        {dayAppointments.length === 0 ? (
          <EmptyState title="No appointments this day" message="Nothing scheduled for this date." />
        ) : (
          dayAppointments.map((appt) => {
            const initials = patientInitials({ firstName: appt.patientName.split(' ')[0], surname: appt.patientName.split(' ').slice(-1)[0] });
            return (
              <article
                key={appt._id}
                className="mobile-appt-card"
                onClick={() => shell.openChart(appt.patientId)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    shell.openChart(appt.patientId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <strong className="mobile-appt-time">{appt.appointmentTime}</strong>
                <span className="mobile-appt-avatar" style={avatarTint(appt.patientName)}>{initials}</span>
                <span className="mobile-appt-meta">
                  <p className="mobile-appt-name">{appt.patientName}</p>
                  <p className="mobile-appt-reason">{appt.reason}</p>
                </span>
                <Badge tone={toneForStatus(appt.status)} size="sm">{appt.status}</Badge>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
