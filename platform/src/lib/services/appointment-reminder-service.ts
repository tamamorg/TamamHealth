import { appointmentsDB } from '../db';
import type { AppointmentDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';

import { findByType } from './db-query';
import { sendSms } from '../sms';
import { jubaDate } from '../time-juba';
import { createMessage, updateMessage } from '@/modules/communication/services/message-service';

export async function getUpcomingReminders(daysAhead?: number, facilityId?: string, scope?: DataScope): Promise<AppointmentDoc[]> {
  /* istanbul ignore next -- defensive default */
  const effectiveDays = daysAhead ?? 1;
  const db = appointmentsDB();
  const all = await findByType<AppointmentDoc>(db, 'appointment');

  const today = jubaDate();
  const future = new Date();
  future.setDate(future.getDate() + effectiveDays);
  const futureDate = jubaDate(future);

  const upcoming = all.filter(a =>
    a.appointmentDate >= today &&
    a.appointmentDate <= futureDate &&
    a.status !== 'cancelled' &&
    a.status !== 'completed' &&
    a.status !== 'no_show' &&
    !a.reminderSent &&
    (!facilityId || a.facilityId === facilityId)
  );

  return scope ? filterByScope(upcoming, scope) : upcoming;
}

export async function generateReminderMessages(appointments: AppointmentDoc[]): Promise<{
  appointmentId: string;
  patientPhone?: string;
  patientName: string;
  message: string;
  channel: 'sms' | 'app' | 'both';
}[]> {
  const messages = appointments.map(apt => ({
    appointmentId: apt._id,
    patientPhone: apt.patientPhone,
    patientName: apt.patientName,
    message: generateReminderMessage(apt),
    channel: apt.reminderChannel || 'both' as const,
  }));

  // Persist each reminder into the messages DB and mark the appointment so
  // the next sweep doesn't re-send. Previously this function only built an
  // in-memory list and returned it — nothing was ever actually queued for
  // delivery and the appointment's `reminderSent` flag was never flipped, so
  // every cron run rebuilt the same list. The persisted Message doc is what
  // the staff inbox and the SMS gateway both consume, so writing it here is
  // the hand-off that closes the loop.
  const db = appointmentsDB();
  // SMS dispatch is opt-in per deployment: without the flag the reminder
  // still lands in the staff inbox via createMessage(), but no phone bill is
  // incurred. Operators enable it once the SMS provider credentials are
  // verified end-to-end on staging.
  const smsEnabled = process.env.APPOINTMENT_REMINDER_SMS_ENABLED === 'true';
  for (const apt of appointments) {
    try {
      const channel = apt.reminderChannel || 'both';
      const reminderText = generateReminderMessage(apt);
      const created = await createMessage({
        recipientType: 'patient',
        direction: 'staff_to_patient',
        patientId: apt.patientId,
        patientName: apt.patientName,
        patientPhone: apt.patientPhone || '',
        fromDoctorId: apt.providerId,
        fromDoctorName: apt.providerName,
        fromHospitalId: apt.facilityId,
        fromHospitalName: apt.facilityName,
        subject: `Appointment reminder — ${apt.appointmentDate} ${apt.appointmentTime}`,
        body: reminderText,
        channel,
        sentAt: new Date().toISOString(),
        orgId: apt.orgId,
      });

      // Hand the reminder to the SMS gateway when the channel calls for it
      // and the deployment has opted in. We await the send (rather than the
      // fire-and-forget pattern used in the messages API) because the cron
      // runner already isolates appointments — a slow gateway delays the
      // batch but never the user-facing request path.
      if (smsEnabled && (channel === 'sms' || channel === 'both') && apt.patientPhone) {
        const result = await sendSms({ to: apt.patientPhone, body: reminderText });
        // Best-effort persist of the delivery result — but log the failure so a
        // broken result-write doesn't silently punch a hole in the SMS audit trail.
        await updateMessage(created._id, { smsResult: result }).catch(err => {
          console.warn(`Failed to persist SMS result on message ${created._id}`, err);
        });
      }

      // Best-effort flip of reminderSent. If this throws (e.g. doc deleted
      // mid-flight) we still keep the Message we just wrote.
      try {
        const fresh = await db.get(apt._id) as AppointmentDoc;
        await db.put({ ...fresh, reminderSent: true, updatedAt: new Date().toISOString() });
      } catch {
        // ignore — Message persisted is what matters for delivery
      }
    } catch (err) {
      // Reminder generation should never block the cron job — one bad
      // appointment must not stop the rest of the batch.
      console.warn('[appointment-reminder] failed to persist reminder for', apt._id, err);
    }
  }

  await logAuditSafe('GENERATE_REMINDERS', undefined, undefined,
    `Generated ${messages.length} appointment reminders`
  );

  return messages;
}

export async function getOverdueAppointments(facilityId?: string): Promise<AppointmentDoc[]> {
  const db = appointmentsDB();
  const all = await findByType<AppointmentDoc>(db, 'appointment');

  const today = jubaDate();

  return all.filter(a =>
    a.appointmentDate < today &&
    a.status !== 'completed' &&
    a.status !== 'no_show' &&
    a.status !== 'cancelled' &&
    (!facilityId || a.facilityId === facilityId)
  );
}

export async function getNoShowStats(
  dateRange: { start: string; end: string },
  facilityId?: string
): Promise<{
  totalAppointments: number;
  noShowCount: number;
  noShowRate: number;
  completedCount: number;
  cancelledCount: number;
  byDepartment: Record<string, { total: number; noShow: number; rate: number }>;
}> {
  const db = appointmentsDB();
  const all = await findByType<AppointmentDoc>(db, 'appointment');

  const filtered = all.filter(a =>
    a.appointmentDate >= dateRange.start &&
    a.appointmentDate <= dateRange.end &&
    (!facilityId || a.facilityId === facilityId)
  );

  const noShows = filtered.filter(a => a.status === 'no_show');
  const completed = filtered.filter(a => a.status === 'completed');
  const cancelled = filtered.filter(a => a.status === 'cancelled');

  const byDepartment: Record<string, { total: number; noShow: number; rate: number }> = {};
  for (const dept of new Set(filtered.map(a => a.department))) {
    const deptAppts = filtered.filter(a => a.department === dept);
    const deptNoShows = deptAppts.filter(a => a.status === 'no_show');
    /* istanbul ignore next -- defensive: deptAppts always has entries when iterated */
    const deptRate = deptAppts.length > 0 ? Math.round((deptNoShows.length / deptAppts.length) * 100) : 0;
    byDepartment[dept] = {
      total: deptAppts.length,
      noShow: deptNoShows.length,
      rate: deptRate,
    };
  }

  return {
    totalAppointments: filtered.length,
    noShowCount: noShows.length,
    noShowRate: filtered.length > 0 ? Math.round((noShows.length / filtered.length) * 100) : 0,
    completedCount: completed.length,
    cancelledCount: cancelled.length,
    byDepartment,
  };
}

export async function getMissedFollowUps(facilityId?: string): Promise<AppointmentDoc[]> {
  const db = appointmentsDB();
  const all = await findByType<AppointmentDoc>(db, 'appointment');

  const today = jubaDate();

  return all.filter(a =>
    a.appointmentType === 'follow_up' &&
    a.appointmentDate < today &&
    a.status === 'no_show' &&
    (!facilityId || a.facilityId === facilityId)
  );
}

// ===== Helper Functions =====

function generateReminderMessage(appointment: AppointmentDoc): string {
  const appointmentDate = new Date(appointment.appointmentDate).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return `Reminder: You have an appointment on ${appointmentDate} at ${appointment.appointmentTime} with ${appointment.providerName} at ${appointment.facilityName}. Please arrive 10 minutes early. Reply CONFIRM to confirm or CANCEL to cancel.`;
}
