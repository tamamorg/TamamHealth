import type { CapturedFingerprint } from '@/components/FingerprintCapture';
import {
  EMPTY_REGISTRATION_FORM,
  MAX_ADDITIONAL_NOK,
  type AdditionalNok,
  type RegistrationForm,
} from '@/components/patients/registration/registration-form';
import { dropDraft, loadDraft, saveDraft } from '@/lib/draft-storage';

const DRAFT_KEY_PREFIX = 'patient-registration:';
const DRAFT_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Registration hand-offs are short-lived even when the general draft TTL is longer. */
export const PATIENT_REGISTRATION_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export interface PatientRegistrationDraft {
  version: 1;
  form: RegistrationForm;
  additionalNok: AdditionalNok[];
  fingerprints: CapturedFingerprint[];
  patientPhotoUrl: string | null;
  reviewMode: boolean;
}

export function createPatientRegistrationDraftId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isPatientRegistrationDraftId(value: string | null | undefined): value is string {
  return typeof value === 'string' && DRAFT_ID_PATTERN.test(value);
}

export async function savePatientRegistrationDraft(
  id: string,
  draft: PatientRegistrationDraft,
): Promise<boolean> {
  if (!isPatientRegistrationDraftId(id)) return false;
  const key = `${DRAFT_KEY_PREFIX}${id}`;
  await saveDraft(key, draft, PATIENT_REGISTRATION_DRAFT_TTL_MS);
  // The generic draft layer intentionally swallows blocked/quota errors so an
  // open form remains usable. A hand-off cannot: verify it before unmounting
  // the only in-memory copy of this registration.
  return normalizePatientRegistrationDraft(await loadDraft<unknown>(key)) !== null;
}

export async function loadPatientRegistrationDraft(
  id: string,
): Promise<PatientRegistrationDraft | null> {
  if (!isPatientRegistrationDraftId(id)) return null;
  const raw = await loadDraft<unknown>(`${DRAFT_KEY_PREFIX}${id}`);
  return normalizePatientRegistrationDraft(raw);
}

export async function dropPatientRegistrationDraft(id: string): Promise<void> {
  if (!isPatientRegistrationDraftId(id)) return;
  await dropDraft(`${DRAFT_KEY_PREFIX}${id}`);
}

/**
 * Treat decrypted browser storage as untrusted input. A corrupt or older
 * payload must never be allowed to replace the form's known-safe defaults.
 */
export function normalizePatientRegistrationDraft(raw: unknown): PatientRegistrationDraft | null {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.form)) return null;
  const rawForm = raw.form;

  const formEntries = Object.entries(EMPTY_REGISTRATION_FORM).map(([key, defaultValue]) => {
    const candidate = rawForm[key];
    if (key === 'payorCoverageType') {
      return isCoverageType(candidate) ? [key, candidate] : [key, defaultValue];
    }
    return [key, typeof candidate === 'string' ? candidate : defaultValue];
  });

  const additionalNok = Array.isArray(raw.additionalNok)
    ? raw.additionalNok.slice(0, MAX_ADDITIONAL_NOK).filter(isAdditionalNok)
    : [];
  const fingerprints = Array.isArray(raw.fingerprints)
    ? raw.fingerprints.slice(0, 10).filter(isCapturedFingerprint)
    : [];

  return {
    version: 1,
    form: Object.fromEntries(formEntries) as unknown as RegistrationForm,
    additionalNok,
    fingerprints,
    patientPhotoUrl: typeof raw.patientPhotoUrl === 'string' ? raw.patientPhotoUrl : null,
    reviewMode: raw.reviewMode === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCoverageType(value: unknown): value is RegistrationForm['payorCoverageType'] {
  return value === 'out-of-pocket' || value === 'program' || value === 'exemption' || value === 'ngo';
}

function isAdditionalNok(value: unknown): value is AdditionalNok {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.relationship === 'string'
    && typeof value.phone === 'string'
    && typeof value.address === 'string';
}

function isCapturedFingerprint(value: unknown): value is CapturedFingerprint {
  return isRecord(value)
    && FINGER_POSITIONS.has(value.finger)
    && typeof value.template === 'string'
    && typeof value.quality === 'number'
    && Number.isFinite(value.quality)
    && BIOMETRIC_FORMATS.has(value.format)
    && typeof value.driver === 'string';
}

const FINGER_POSITIONS = new Set<unknown>([
  'right_thumb', 'right_index', 'right_middle', 'right_ring', 'right_little',
  'left_thumb', 'left_index', 'left_middle', 'left_ring', 'left_little',
]);
const BIOMETRIC_FORMATS = new Set<unknown>(['ISO_19794_2', 'ANSI_378', 'PROPRIETARY', 'MOCK']);
