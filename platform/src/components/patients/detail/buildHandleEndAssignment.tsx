'use client';
import type { ToastType, ToastOptions } from '@/components/Toast';
import type { ConfirmPromptOptions } from '@/components/ConfirmDialog';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import type { AppUser } from '@/lib/context/types';
import { describeError } from '@/lib/user-facing-error';
export function buildHandleEndAssignment({ t, patient, currentUser, confirmPrompt, showToast, reloadPatients }: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  patient: PatientDoc | null | undefined;
  currentUser: AppUser | null;
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<string | null>;
  showToast: (message: string, type?: ToastType | undefined, opts?: ToastOptions | undefined) => void;
  reloadPatients: () => Promise<void>;
}) {
  const handleEndAssignment = async () => {
    if (!patient || !currentUser) return;
    const displayName = patientFullName(patient);
    const reason = await confirmPrompt({
      title: t('msg.endTheAssignmentFor', { displayName }),
      message: t('msg.theyWillLeaveTheAssigned'),
      confirmLabel: t('msg.endAssignment'),
      tone: 'danger',
      inputLabel: t('appointments.labelReason'),
      inputPlaceholder: t('msg.eGPatientLeftAnd'),
      inputRequired: true,
    });
    if (reason === null) return;
    try {
      const { completePatientAssignment } = await import('@/lib/services/patient-assignment-service');
      await completePatientAssignment({
        patientId: patient._id,
        patientName: displayName,
        reason,
        actor: { id: currentUser._id, name: currentUser.name, role: currentUser.role },
      });
      showToast(t('msg.assignmentForEnded', { displayName }), 'success');
      // The header's care-team line and the ⋯ menu both read the patient doc.
      await reloadPatients();
    } catch (err) {
      showToast(describeError(err, t('msg.assignmentNotEndedTryAgain')), 'error');
    }
  };
  return handleEndAssignment;
}
