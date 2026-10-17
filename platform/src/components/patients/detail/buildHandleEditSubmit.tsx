'use client';
import type { PatientDoc } from '@/lib/db-types';
import { isValidPhone, normalizePhone } from '@/lib/field-formats';
import type { Dispatch, SetStateAction } from 'react';
export function buildHandleEditSubmit({ patient, editForm, setEditErrors, t, setEditSubmitting, updatePatient, setShowEditModal }: {
  patient: PatientDoc | null | undefined;
  editForm: { firstName: string; middleName: string; surname: string; phone: string; state: string; county: string; payam: string; boma: string; tribe: string; dateOfBirth: string; gender: "Male" | "Female"; };
  setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  setEditSubmitting: Dispatch<SetStateAction<boolean>>;
  updatePatient: (id: string, data: Partial<PatientDoc>) => Promise<PatientDoc | null>;
  setShowEditModal: Dispatch<SetStateAction<boolean>>;
}) {
  const handleEditSubmit = async () => {
    if (!patient) return;
    // Phone is optional — only block when a non-empty value is malformed.
    if (!isValidPhone(editForm.phone)) {
      setEditErrors({ phone: t('validation.errPhone') });
      return;
    }
    setEditErrors({});
    try {
      setEditSubmitting(true);
      // Normalize to canonical form before persisting (patient-service also
      // re-normalizes, but keep the saved value canonical here too).
      const normPhone = normalizePhone(editForm.phone) ?? editForm.phone.trim();
      await updatePatient(patient._id, {
        firstName: editForm.firstName.trim(),
        middleName: editForm.middleName.trim(),
        surname: editForm.surname.trim(),
        phone: normPhone,
        state: editForm.state.trim(),
        county: editForm.county.trim(),
        payam: editForm.payam.trim(),
        boma: editForm.boma.trim(),
        tribe: editForm.tribe.trim(),
        dateOfBirth: editForm.dateOfBirth,
        gender: editForm.gender,
      });
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit('PATIENT_EDIT', undefined, undefined,
        `Updated demographics for patient ${patient._id}`
      ).catch(() => {});
      setShowEditModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setEditSubmitting(false);
    }
  };
  return handleEditSubmit;
}
