'use client';
import type { ToastType, ToastOptions } from '@/components/Toast';
import type { PatientDoc } from '@/lib/db-types';
import { describeError } from '@/lib/user-facing-error';
import type { Dispatch, SetStateAction } from 'react';
export function buildHandleToggleDeceased({ patient, deceasedDateInput, setDeceasedSubmitting, updatePatient, setShowDeceasedModal, showToast, t }: {
  patient: PatientDoc | null | undefined;
  deceasedDateInput: string;
  setDeceasedSubmitting: Dispatch<SetStateAction<boolean>>;
  updatePatient: (id: string, data: Partial<PatientDoc>) => Promise<PatientDoc | null>;
  setShowDeceasedModal: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string, type?: ToastType | undefined, opts?: ToastOptions | undefined) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const handleToggleDeceased = async () => {
    if (!patient) return;
    const marking = !patient.isDeceased;
    if (marking && !deceasedDateInput) return;
    setDeceasedSubmitting(true);
    try {
      // updatePatient returns null when the write is refused (the sync
      // validator rejects the role, or the doc is gone). The handler used to
      // close the modal regardless and show nothing, so a refused
      // mark-deceased looked identical to a successful one — the patient stayed
      // alive in the record while the clerk believed otherwise
      // (security/data audit 2026-11-05, §2.3).
      const updated = await updatePatient(patient._id, marking ? {
        isDeceased: true,
        deceasedDate: deceasedDateInput,
        followUpStatus: 'died',
        isActive: false,
      } : {
        isDeceased: false,
        deceasedDate: undefined,
        followUpStatus: undefined,
        isActive: true,
      });
      if (!updated) {
        showToast(t(marking ? 'msg.patientNotMarkedDeceased' : 'msg.deceasedStatusNotCleared'), 'error');
        return;
      }
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit(
        marking ? 'PATIENT_MARK_DECEASED' : 'PATIENT_MARK_ALIVE',
        undefined,
        undefined,
        marking
          ? `Marked patient ${patient._id} deceased`
          : `Cleared deceased status for patient ${patient._id}`,
      ).catch(() => {});
      showToast(t(marking ? 'msg.patientMarkedDeceased' : 'msg.deceasedStatusCleared'), 'success');
      setShowDeceasedModal(false);
    } catch (err) {
      showToast(describeError(err, t(marking ? 'msg.patientNotMarkedDeceased' : 'msg.deceasedStatusNotCleared')), 'error');
    } finally {
      setDeceasedSubmitting(false);
    }
  };
  return handleToggleDeceased;
}
