/**
 * The conversation between a patient and the people caring for them.
 *
 * Both ends already wrote messages — the chart into the patient's portal inbox,
 * the portal back to "the facility" — but nothing joined them up. A patient's
 * reply carried no organisation, so every staff screen filtered it out, and it
 * named no clinician, so even a visible reply belonged to nobody. This module
 * is the join: who a reply is for, what the thread looks like in order, and
 * which replies are still waiting on an answer.
 *
 * The rules are pure functions so the portal route, the chart and the
 * notification bell all apply the same ones.
 */
import type { MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

type ThreadMessage = Pick<MessageDoc,
  '_id' | 'patientId' | 'direction' | 'recipientType' | 'fromDoctorId' | 'fromDoctorName'
  | 'fromHospitalId' | 'sentAt' | 'createdAt' | 'deleted' | 'automated'>;

const at = (m: Pick<MessageDoc, 'sentAt' | 'createdAt'>) => m.sentAt || m.createdAt || '';

/** A message the patient wrote (the legacy sender id covers pre-direction docs). */
export function isFromPatient(m: Pick<MessageDoc, 'direction' | 'fromDoctorId'>): boolean {
  return m.direction === 'patient_to_staff' || m.fromDoctorId === 'patient';
}

/**
 * A message staff wrote TO the patient.
 *
 * Not "anything that is not from the patient": the messages database also
 * holds staff-to-staff alerts that merely concern a patient — a critical lab
 * result is written with the patient's id and `recipientType: 'staff'`, and no
 * direction at all. Counting those put internal alerts in the patient's
 * conversation, addressed the patient's next reply to the lab bench, and let
 * an alert pass for an answer. A message with no direction predates the field
 * and is to the patient unless it says its recipient is staff.
 */
export function isToPatient(m: Pick<MessageDoc, 'direction' | 'recipientType' | 'fromDoctorId'>): boolean {
  if (isFromPatient(m)) return false;
  if (m.direction) return m.direction === 'staff_to_patient';
  return m.recipientType !== 'staff';
}

/** Part of the patient ↔ care-team conversation, in either direction. */
export function isInPatientConversation(
  m: Pick<MessageDoc, 'direction' | 'recipientType' | 'fromDoctorId'>,
): boolean {
  return isFromPatient(m) || isToPatient(m);
}

/** A patient's conversation: oldest first, internal staff traffic excluded. */
export function patientThread<T extends ThreadMessage>(messages: readonly T[]): T[] {
  return messages
    .filter(isInPatientConversation)
    .slice()
    .sort((a, b) => at(a).localeCompare(at(b)));
}

export interface ReplyRecipient {
  id: string;
  name?: string;
  /**
   * The facility that clinician wrote from. A patient registered at one
   * facility and seen at another replies to a doctor who is scoped to the
   * second; the reply has to be filed where that doctor can see it.
   */
  hospitalId?: string;
}

/**
 * Who a patient's new message is for.
 *
 * The clinician who most recently wrote to them, because a reply answers the
 * last thing said; otherwise the doctor assigned to them; otherwise nobody,
 * and the message stays a facility enquiry for the front desk.
 */
export function resolveReplyRecipient(
  messages: readonly ThreadMessage[],
  patient?: { assignedDoctor?: string; assignedDoctorName?: string } | null,
): ReplyRecipient | undefined {
  const lastFromStaff = patientThread(messages)
    // A reminder is sent in the provider's name by the system; the patient's
    // next message is not a reply to it.
    .filter(m => isToPatient(m) && !m.deleted && !m.automated && m.fromDoctorId)
    .pop();
  if (lastFromStaff) {
    return {
      id: lastFromStaff.fromDoctorId,
      name: lastFromStaff.fromDoctorName,
      hospitalId: lastFromStaff.fromHospitalId || undefined,
    };
  }
  if (patient?.assignedDoctor) return { id: patient.assignedDoctor, name: patient.assignedDoctorName };
  return undefined;
}

/**
 * Patient messages addressed to this clinician that nobody has answered yet —
 * what the notification bell shows. "Answered" means any staff message to that
 * patient sent afterwards, by anyone: once a colleague has replied, the patient
 * is no longer waiting, and the bell should stop saying they are. A reply that
 * was then removed does not count — the patient cannot read it — and neither
 * does an internal alert about the patient, which was never sent to them, nor
 * an automated reminder, which nobody wrote.
 */
export function unansweredPatientMessages<T extends ThreadMessage & Pick<MessageDoc, 'recipientStaffId'>>(
  messages: readonly T[],
  userId: string,
): T[] {
  const lastStaffReply = new Map<string, string>();
  for (const m of messages) {
    if (!isToPatient(m) || m.deleted || m.automated) continue;
    const when = at(m);
    if (when > (lastStaffReply.get(m.patientId) || '')) lastStaffReply.set(m.patientId, when);
  }
  return messages
    .filter(m => isFromPatient(m) && m.recipientStaffId === userId && !m.deleted)
    .filter(m => at(m) > (lastStaffReply.get(m.patientId) || ''))
    .sort((a, b) => at(b).localeCompare(at(a)));
}

/** The chart's read: this patient's conversation, within the reader's scope. */
export async function getPatientThread(patientId: string, scope: DataScope): Promise<MessageDoc[]> {
  const { getMessagesByPatient } = await import('./message-service');
  return patientThread(await getMessagesByPatient(patientId, scope));
}

/** The bell's read: this clinician's unanswered patient messages. */
export async function getUnansweredPatientMessages(userId: string, scope: DataScope): Promise<MessageDoc[]> {
  const { getAllMessages } = await import('./message-service');
  return unansweredPatientMessages(await getAllMessages(scope), userId);
}
