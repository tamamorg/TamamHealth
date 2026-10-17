'use client';
import type { PatientDoc } from '@/lib/db-types';
import type { Dispatch, SetStateAction } from 'react';
export function buildHandleToggleDeceased({ patient, deceasedDateInput, setDeceasedSubmitting, updatePatient, setShowDeceasedModal }: {
  patient: PatientDoc | null | undefined;
  deceasedDateInput: string;
  setDeceasedSubmitting: Dispatch<SetStateAction<boolean>>;
  updatePatient: (id: string, data: Partial<PatientDoc>) => Promise<PatientDoc | null>;
  setShowDeceasedModal: Dispatch<SetStateAction<boolean>>;
}) {
  const handleToggleDeceased = async () => {
    if (!patient) return;
    const marking = !patient.isDeceased;
    if (marking && !deceasedDateInput) return;
    setDeceasedSubmitting(true);
    try {
      await updatePatient(patient._id, marking ? {
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
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit(
        marking ? 'PATIENT_MARK_DECEASED' : 'PATIENT_MARK_ALIVE',
        undefined,
        undefined,
        marking
          ? `Marked patient ${patient._id} deceased`
          : `Cleared deceased status for patient ${patient._id}`,
      ).catch(() => {});
      setShowDeceasedModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setDeceasedSubmitting(false);
    }
  };
  return handleToggleDeceased;
}
