/**
 * Turn the registration form into the patient document that gets saved.
 *
 * Pure mapping, kept out of the component so the field-by-field translation
 * can be read and tested without rendering a form or mocking a database — it
 * was a 55-line object literal in the middle of an async submit handler,
 * which is the last place anyone looks for "what do we actually store".
 *
 * Normalizes phones, the national ID and the email on the way through.
 * `patient-service` normalizes again on write; doing it here as well keeps the
 * value we hand over identical to the value that lands, so the review the
 * clerk just confirmed is the record that gets created.
 */

import { normalizePhone, normalizeEmail, normalizeNationalId } from '@/lib/field-formats';
import { identifiersFrom } from '@/lib/country/patient-identity';
import type { PatientDoc } from '@/lib/db-types';
import type { AdditionalNok, RegistrationForm } from './registration-form';

export interface BuildPatientDocInput {
  form: RegistrationForm;
  additionalNok: AdditionalNok[];
  geocodeId?: string;
  photoUrl: string | null;
  /** Who is registering, and where. */
  hospitalId: string;
  registeredBy: string;
  /** Passed in rather than read from the clock, so the result is testable. */
  nowIso: string;
}

/** Parse a numeric form field, or undefined when it is blank or not a number. */
function optionalInt(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function buildPatientDoc({
  form, additionalNok, geocodeId, photoUrl, hospitalId, registeredBy, nowIso,
}: BuildPatientDocInput) {
  const today = nowIso.split('T')[0];
  const namedNok = additionalNok.filter(n => n.name.trim());
  const exemptionReason = form.payorCoverageType === 'exemption'
    ? (form.payorExemptionReason === 'Other' ? form.payorExemptionOther.trim() : form.payorExemptionReason)
    : '';

  return {
    hospitalNumber: '',
    geocodeId,
    householdNumber: optionalInt(form.householdNumber),
    nationalId: normalizeNationalId(form.nationalId) || undefined,
    bomaCode: form.bomaCode || undefined,
    firstName: form.firstName.trim(),
    middleName: form.middleName.trim(),
    surname: form.surname.trim(),
    maidenName: form.maidenName.trim(),
    latinName: form.latinName.trim() || undefined,
    residenceCountry: form.residenceCountry || undefined,
    citizenship: form.citizenship || undefined,
    identifiers: identifiersFrom(form.idType, form.idNumber, form.idCountry),
    dateOfBirth: form.dateOfBirth,
    estimatedAge: optionalInt(form.estimatedAge),
    gender: form.gender as PatientDoc['gender'],
    tribe: form.tribe,
    primaryLanguage: form.primaryLanguage,
    phone: normalizePhone(form.phone) ?? form.phone,
    altPhone: normalizePhone(form.altPhone) ?? form.altPhone,
    whatsapp: normalizePhone(form.whatsapp) ?? form.whatsapp,
    // Omitted rather than stored empty, so `patient.email` being set is a
    // reliable test for "can we email this patient".
    email: normalizeEmail(form.email) || undefined,
    state: form.state,
    county: form.county,
    payam: form.payam,
    boma: form.boma,
    address: form.address,
    nokName: form.nokName,
    nokRelationship: form.nokRelationship,
    nokPhone: normalizePhone(form.nokPhone) ?? form.nokPhone,
    nokEmail: normalizeEmail(form.nokEmail) || undefined,
    nokAddress: form.nokAddress,
    // A contact with no name is an empty row the clerk added and left, not a
    // person — it is dropped rather than stored blank.
    ...(namedNok.length > 0 ? {
      additionalNextOfKin: namedNok.map(n => ({
        name: n.name.trim(),
        relationship: n.relationship,
        phone: normalizePhone(n.phone) ?? n.phone,
        address: n.address || undefined,
      })),
    } : {}),
    payorInfo: {
      coverageType: form.payorCoverageType,
      ...(form.payorProgram ? { programEnrollment: form.payorProgram } : {}),
      ...(form.payorNgo ? { ngoName: form.payorNgo } : {}),
      ...(exemptionReason ? { exemptionReason } : {}),
    },
    // Clinical detail is collected at triage, not registration — these are the
    // documented "not asked yet" defaults, not findings.
    bloodType: 'Unknown' as const,
    allergies: ['None known'],
    chronicConditions: ['None'],
    ...(photoUrl ? { photoUrl } : {}),
    registrationHospital: hospitalId,
    registrationDate: today,
    registeredAt: nowIso,
    registeredBy,
    lastVisitDate: today,
    lastVisitHospital: hospitalId,
    isActive: true,
  };
}
