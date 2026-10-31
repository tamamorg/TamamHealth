'use client';
import { identifiersFrom, isValidDocumentNumber } from '@/lib/country/patient-identity';
import type { PatientEditForm } from './PatientEditModal';
import type { PatientDoc } from '@/lib/db-types';
import { isValidPhone, normalizePhone, isValidEmail, normalizeEmail } from '@/lib/field-formats';
import { todayIso } from '@/lib/date-utils';
import { describeError } from '@/lib/user-facing-error';
import type { Dispatch, SetStateAction } from 'react';
export function buildHandleEditSubmit({ patient, editForm, setEditErrors, t, setEditSubmitting, updatePatient, setShowEditModal, showToast }: {
  patient: PatientDoc | null | undefined;
  editForm: PatientEditForm;
  setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  setEditSubmitting: Dispatch<SetStateAction<boolean>>;
  updatePatient: (id: string, data: Partial<PatientDoc>) => Promise<PatientDoc | null>;
  setShowEditModal: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  const handleEditSubmit = async () => {
    if (!patient) return;
    // Phone is optional — only block when a non-empty value is malformed.
    if (!isValidPhone(editForm.phone)) {
      setEditErrors({ phone: t('validation.errPhone') });
      return;
    }
    if (!isValidEmail(editForm.email)) {
      setEditErrors({ email: t('validation.errEmail') });
      return;
    }
    // A record must keep a name and a real date of birth: these were written
    // through blank or in the future, and every list then showed "—".
    if (!editForm.firstName.trim()) {
      showToast(t('msg.enterFirstName'), 'error');
      return;
    }
    if (editForm.idNumber.trim() && (!editForm.idType || !isValidDocumentNumber(editForm.idNumber))) {
      showToast(t('validation.errDocumentNumber'), 'error');
      return;
    }
    if (editForm.dateOfBirth && editForm.dateOfBirth > todayIso()) {
      showToast(t('msg.dateOfBirthInFuture'), 'error');
      return;
    }
    setEditErrors({});
    try {
      setEditSubmitting(true);
      // Normalize to canonical form before persisting (patient-service also
      // re-normalizes, but keep the saved value canonical here too).
      const normPhone = normalizePhone(editForm.phone) ?? editForm.phone.trim();
      const saved = await updatePatient(patient._id, {
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
        email: normalizeEmail(editForm.email) || undefined,
        residenceCountry: editForm.residenceCountry || undefined,
        citizenship: editForm.citizenship || undefined,
        identifiers: identifiersFrom(editForm.idType, editForm.idNumber, editForm.idCountry),
      });
      // null: the record was not found. Not a success, and nothing to audit.
      if (!saved) throw new Error('Change not saved. Try again.');
      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit('PATIENT_EDIT', undefined, undefined,
        `Updated demographics for patient ${patient._id}`
      ).catch(() => {});
      showToast(t('msg.patientDetailsUpdated'), 'success');
      setShowEditModal(false);
    } catch (err) {
      // A failed save used to be logged and nothing else: the dialog just sat there.
      console.error(err);
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    } finally {
      setEditSubmitting(false);
    }
  };
  return handleEditSubmit;
}
