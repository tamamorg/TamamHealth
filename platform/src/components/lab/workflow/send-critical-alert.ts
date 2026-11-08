/**
 * Message the care team about a critical lab value. Best-effort: a saved result
 * the lab can phone through beats a blocked save. The bench form, an approved
 * correction and batch entry all send the same message.
 */
import type { LabResultDoc } from '@/lib/db-types';

export interface CriticalAlertSender {
  _id?: string;
  name?: string;
  hospitalName?: string;
  orgId?: string;
}

export async function sendCriticalLabAlert(
  order: Pick<LabResultDoc, 'patientId' | 'patientName' | 'testName' | 'hospitalName' | 'orgId'>,
  value: { result: string; unit: string; referenceRange: string },
  sender: CriticalAlertSender | null | undefined,
): Promise<void> {
  try {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    const { result, unit, referenceRange } = value;
    await createMessage({
      recipientType: 'staff',
      patientId: order.patientId,
      patientName: order.patientName,
      patientPhone: '',
      fromDoctorId: sender?._id || 'lab',
      fromDoctorName: sender?.name || 'Laboratory',
      fromHospitalName: sender?.hospitalName || order.hospitalName || '',
      subject: `CRITICAL: ${order.testName} for ${order.patientName}`,
      body: `Critical lab result for ${order.patientName} — ${order.testName}: ${result}${unit ? ` ${unit}` : ''}${referenceRange ? ` (reference range: ${referenceRange})` : ''}. Please review immediately.`,
      channel: 'app',
      sentAt: new Date().toISOString(),
      orgId: sender?.orgId || order.orgId,
    });
  } catch (err) {
    console.error('[lab-workflow] critical-result alert failed; phone the clinician', err);
  }
}
