// Input validation for patient and medical record data

import { isValidPhone, isValidNationalId } from './field-formats';

// File upload constraints
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_TRANSFER_PACKAGE_BYTES = 20 * 1024 * 1024; // 20MB
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/dicom',
  'image/dicom',
];

export function validateAttachment(file: File): { valid: boolean; error?: string } {
  return validateAttachmentPayload({
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}

/**
 * The same rules as `validateAttachment`, without needing a `File`.
 *
 * `validateAttachment` takes a browser `File` and so can only run in the one
 * component that owns the file picker. Every other path — the patient-documents
 * uploader, the radiology dashboard, an API caller, an offline write replayed
 * from a device — arrives with a base64 string and no `File` in sight, and had
 * nothing checking it at all. A 40MB scan became a ~54MB base64 field inside a
 * single document, replicated in full to every clinician's browser in the
 * organisation.
 *
 * Enforce this in the SERVICE, not only in the UI: browser writes go straight
 * to the local replica, so a UI-only check is advisory.
 *
 * `base64Length`, when supplied, is checked against the declared size — a
 * caller may not under-report to slip past the cap. Base64 encodes 3 bytes as
 * 4 characters, so the decoded length is derived rather than trusted.
 */
export function validateAttachmentPayload(input: {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64Length?: number;
}): { valid: boolean; error?: string } {
  const declared = Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0;
  // Derive the real size from the payload when we have it; a client controls
  // `sizeBytes` and the encoded string equally, but only one of them is what
  // actually gets stored.
  const actual = input.base64Length === undefined
    ? declared
    : Math.max(declared, Math.floor((input.base64Length * 3) / 4));

  if (actual > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File "${input.name}" exceeds 5MB limit (${(actual / 1024 / 1024).toFixed(1)}MB)`,
    };
  }
  if (!ALLOWED_FILE_TYPES.includes(input.mimeType) && !input.name.toLowerCase().endsWith('.dcm')) {
    return {
      valid: false,
      error: `File "${input.name}" has unsupported type (${input.mimeType || 'unknown'}). Allowed: JPEG, PNG, GIF, WebP, PDF, DICOM`,
    };
  }
  return { valid: true };
}

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(Object.values(fields).join(', '));
    this.name = 'ValidationError';
  }
}

/**
 * Sanitize a string for safe storage: strip control characters and
 * HTML/script injection vectors. This is defense-in-depth — the
 * application uses React (which auto-escapes on render), but we
 * also sanitize at the data layer to prevent stored XSS if raw
 * values are ever rendered outside React.
 */
export function sanitizeString(val: unknown): string {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\x00-\x1F\x7F]/g, '')     // Control chars
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Script tags
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')                       // Event handlers
    .replace(/javascript:/gi, '')                                        // JS protocol
    .trim();
}

/**
 * Sanitize the string values at the TOP LEVEL of an object.
 *
 * NOT recursive, despite what this was previously documented as. Nested objects
 * and arrays pass through untouched, so a route accepting structured input
 * (e.g. `{ to: { providerName } }`) must sanitize those fields itself with
 * `sanitizeString`. Left non-recursive on purpose: every existing caller was
 * written against this behaviour, and quietly deep-walking arbitrary payloads
 * would change what they store.
 */
export function sanitizePayload<T extends Record<string, unknown>>(data: T): T {
  const cleaned = { ...data } as Record<string, unknown>;
  for (const key of Object.keys(cleaned)) {
    if (typeof cleaned[key] === 'string') {
      cleaned[key] = sanitizeString(cleaned[key]);
    }
  }
  return cleaned as T;
}

function validatePhone(value: unknown, fieldName: string): string | null {
  if (!value || typeof value !== 'string' || value.trim() === '') return null;
  // Canonical South Sudan format enforced via the shared field-formats module:
  // accepts local/international input but must normalize to +211XXXXXXXXX.
  if (!isValidPhone(value)) {
    return `Invalid ${fieldName} — use a valid South Sudan number (e.g. +211 912 345 678 or 0912 345 678)`;
  }
  return null;
}

export function validatePatientData(data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  const firstName = sanitizeString(data.firstName);
  if (!firstName || firstName.length < 1) {
    errors.firstName = 'First name is required';
  } else if (firstName.length > 100) {
    errors.firstName = 'First name is too long';
  }

  const surname = sanitizeString(data.surname);
  if (!surname || surname.length < 1) {
    errors.surname = 'Surname is required';
  } else if (surname.length > 100) {
    errors.surname = 'Surname is too long';
  }

  // Optional name fields — validate length when provided
  const middleName = sanitizeString(data.middleName);
  if (middleName && middleName.length > 100) {
    errors.middleName = 'Middle name is too long';
  }
  const maidenName = sanitizeString(data.maidenName);
  if (maidenName && maidenName.length > 100) {
    errors.maidenName = 'Maiden name is too long';
  }

  if (!normalizeGender(data.gender)) {
    errors.gender = 'Gender is required';
  }

  if (!data.dateOfBirth && !data.estimatedAge) {
    errors.dateOfBirth = 'Date of birth or estimated age is required';
  }

  if (data.dateOfBirth) {
    const dobError = validateDateOfBirth(data.dateOfBirth as string);
    if (dobError) errors.dateOfBirth = dobError;
  }

  // Validate estimated age range
  if (data.estimatedAge !== undefined && data.estimatedAge !== null) {
    const age = Number(data.estimatedAge);
    if (isNaN(age) || age < 0 || age > 150) {
      errors.estimatedAge = 'Estimated age must be between 0 and 150';
    }
  }

  // Validate all phone fields
  const phoneErr = validatePhone(data.phone, 'phone number');
  if (phoneErr) errors.phone = phoneErr;
  const altPhoneErr = validatePhone(data.altPhone, 'alternative phone number');
  if (altPhoneErr) errors.altPhone = altPhoneErr;
  const whatsappErr = validatePhone(data.whatsapp, 'WhatsApp number');
  if (whatsappErr) errors.whatsapp = whatsappErr;
  const nokPhoneErr = validatePhone(data.nokPhone, 'next-of-kin phone number');
  if (nokPhoneErr) errors.nokPhone = nokPhoneErr;

  if (!data.state || typeof data.state !== 'string') {
    errors.state = 'State is required';
  }

  // Required fields must mirror the registration form (patients/new) so a direct
  // API POST cannot persist an incomplete record that the UI would have rejected.
  const primaryLanguage = sanitizeString(data.primaryLanguage);
  if (!primaryLanguage) {
    errors.primaryLanguage = 'Primary language is required';
  }
  // County is required whenever a state is provided (form couples the two).
  if (data.state && !sanitizeString(data.county)) {
    errors.county = 'County is required';
  }
  const nokName = sanitizeString(data.nokName);
  if (!nokName) {
    errors.nokName = 'Next-of-kin name is required';
  }
  if (!sanitizeString(data.nokRelationship)) {
    errors.nokRelationship = 'Next-of-kin relationship is required';
  }
  if (!sanitizeString(data.nokPhone)) {
    errors.nokPhone = 'Next-of-kin phone number is required';
  }

  // Validate boma code format when provided
  if (data.bomaCode && typeof data.bomaCode === 'string') {
    const code = data.bomaCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length === 0 || code.length > 4) {
      errors.bomaCode = 'Boma code must be 1-4 alphanumeric characters';
    }
  }

  // Validate address length
  if (data.address && typeof data.address === 'string' && data.address.length > 500) {
    errors.address = 'Address is too long (max 500 characters)';
  }

  // Validate national ID format when provided (alphanumeric, 3–30 chars).
  if (data.nationalId && typeof data.nationalId === 'string' && data.nationalId.trim() !== '') {
    if (!isValidNationalId(data.nationalId)) {
      errors.nationalId = 'National ID must be 3–30 letters/numbers';
    }
  }

  return errors;
}

/**
 * Age-banded plausibility bounds for vital signs.
 *
 * IMPORTANT — these are PLAUSIBILITY bounds, not "normal" ranges. Their job is
 * to catch data-entry mistakes (a pulse typed into the weight box), NOT to
 * reject clinically abnormal readings. A tachycardic, septic or shocked child
 * must always be recordable; an EHR that refuses to store an alarming vital
 * sign is actively dangerous. So every band is deliberately wider than the WHO
 * normal range for that age.
 *
 * Why age matters: the previous single set of bounds was adult-shaped, and
 * adult bounds REJECT ordinary paediatric physiology. A healthy neonate
 * breathes 40-60/min and can reach 80+ in distress — the old 4-60 ceiling threw
 * a validation error on a real observation. Likewise an infant's systolic BP of
 * 55 is plausible but sat below the old floor of 40 only by luck.
 *
 * Bands follow the standard paediatric groupings (neonate/infant, toddler,
 * pre-school/school-age, adolescent, adult), widened at both ends.
 */
interface VitalBound { min: number; max: number; label: string }

interface VitalBounds {
  systolicBP: VitalBound;
  diastolicBP: VitalBound;
  pulse: VitalBound;
  respiratoryRate: VitalBound;
  weight: VitalBound;
  height: VitalBound;
}

const ADULT_BOUNDS: VitalBounds = {
  systolicBP:      { min: 40,  max: 300, label: 'mmHg' },
  diastolicBP:     { min: 20,  max: 200, label: 'mmHg' },
  pulse:           { min: 20,  max: 250, label: 'bpm' },
  respiratoryRate: { min: 4,   max: 60,  label: 'breaths/min' },
  weight:          { min: 0.5, max: 300, label: 'kg' },
  height:          { min: 20,  max: 250, label: 'cm' },
};

/** Ordered youngest-first; the first band whose `maxAgeYears` fits is used. */
const PAEDIATRIC_BANDS: ReadonlyArray<{ maxAgeYears: number; bounds: VitalBounds }> = [
  {
    // Neonate + infant (< 1 year).
    maxAgeYears: 1,
    bounds: {
      systolicBP:      { min: 30,  max: 140, label: 'mmHg' },
      diastolicBP:     { min: 15,  max: 100, label: 'mmHg' },
      pulse:           { min: 60,  max: 230, label: 'bpm' },
      respiratoryRate: { min: 15,  max: 90,  label: 'breaths/min' },
      weight:          { min: 0.3, max: 20,  label: 'kg' },
      height:          { min: 25,  max: 90,  label: 'cm' },
    },
  },
  {
    // Toddler / pre-school (1-4).
    maxAgeYears: 5,
    bounds: {
      systolicBP:      { min: 40, max: 150, label: 'mmHg' },
      diastolicBP:     { min: 18, max: 110, label: 'mmHg' },
      pulse:           { min: 50, max: 220, label: 'bpm' },
      respiratoryRate: { min: 12, max: 75,  label: 'breaths/min' },
      weight:          { min: 3,  max: 40,  label: 'kg' },
      height:          { min: 50, max: 130, label: 'cm' },
    },
  },
  {
    // School age (5-11).
    maxAgeYears: 12,
    bounds: {
      systolicBP:      { min: 50, max: 180, label: 'mmHg' },
      diastolicBP:     { min: 20, max: 120, label: 'mmHg' },
      pulse:           { min: 40, max: 220, label: 'bpm' },
      respiratoryRate: { min: 10, max: 65,  label: 'breaths/min' },
      weight:          { min: 8,  max: 100, label: 'kg' },
      height:          { min: 85, max: 180, label: 'cm' },
    },
  },
  {
    // Adolescent (12-17) — approaching adult, still wider.
    maxAgeYears: 18,
    bounds: {
      systolicBP:      { min: 40,  max: 220, label: 'mmHg' },
      diastolicBP:     { min: 20,  max: 150, label: 'mmHg' },
      pulse:           { min: 30,  max: 220, label: 'bpm' },
      respiratoryRate: { min: 8,   max: 60,  label: 'breaths/min' },
      weight:          { min: 20,  max: 200, label: 'kg' },
      height:          { min: 110, max: 220, label: 'cm' },
    },
  },
];

/** Resolve the bounds that apply to a patient of the given age. */
export function vitalBoundsForAge(patientAgeYears?: number): VitalBounds {
  if (patientAgeYears === undefined || patientAgeYears === null || isNaN(patientAgeYears)) {
    return ADULT_BOUNDS;
  }
  for (const band of PAEDIATRIC_BANDS) {
    if (patientAgeYears < band.maxAgeYears) return band.bounds;
  }
  return ADULT_BOUNDS;
}

/**
 * Validate vital signs, optionally against age-appropriate bounds.
 *
 * `patientAgeYears` is optional so existing callers keep working; when omitted
 * the adult bounds apply, which is the previous behaviour. Pass the patient's
 * age wherever it is known — for children it is the difference between
 * catching a typo and rejecting a real observation. Fractional ages are fine
 * (a 3-month-old is `0.25`).
 */
export function validateVitalSigns(
  vitals: Record<string, unknown>,
  patientAgeYears?: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const bounds = vitalBoundsForAge(patientAgeYears);

  const check = (
    key: keyof VitalBounds,
    raw: unknown,
    errorKey: string,
    name: string,
  ) => {
    if (raw === undefined || raw === null || raw === '') return;
    const value = Number(raw);
    const { min, max, label } = bounds[key];
    if (isNaN(value) || value < min || value > max) {
      errors[errorKey] = `${name} must be between ${min}-${max} ${label}`;
    }
  };

  // Temperature is not age-banded — human-survivable range is the same at any
  // age, and the bounds are already wide enough for hypothermia and rigors.
  const temp = Number(vitals.temperature);
  if (vitals.temperature && !isNaN(temp)) {
    if (temp < 25 || temp > 45) {
      errors.temperature = 'Temperature must be between 25-45°C';
    }
  }

  check('systolicBP', vitals.systolicBP ?? vitals.systolic, 'systolicBP', 'Systolic BP');
  check('diastolicBP', vitals.diastolicBP ?? vitals.diastolic, 'diastolicBP', 'Diastolic BP');
  check('pulse', vitals.pulse, 'pulse', 'Pulse');
  check('respiratoryRate', vitals.respiratoryRate, 'respiratoryRate', 'Respiratory rate');
  check('weight', vitals.weight, 'weight', 'Weight');
  check('height', vitals.height, 'height', 'Height');

  // SpO2 is a percentage — same physical bounds regardless of age.
  if (vitals.oxygenSaturation) {
    const o2 = Number(vitals.oxygenSaturation);
    if (isNaN(o2) || o2 < 30 || o2 > 100) {
      errors.oxygenSaturation = 'Oxygen saturation must be between 30-100%';
    }
  }

  return errors;
}

/**
 * Canonical gender values (KAN-17).
 *
 * Three layers disagreed: the TypeScript type says `'Male' | 'Female'`, the
 * validator accepted `['male','female','unknown']` after `.toLowerCase()`, and
 * the SQL column was a bare `TEXT` with no CHECK. It passed only by coincidence
 * — `'Male'.toLowerCase()` happens to match — while `'unknown'` was accepted by
 * the API and then **unrepresentable in the type**, so anything that stored it
 * produced a document violating its own contract.
 *
 * Canonical form is the capitalised pair, because that is what the type
 * declares, what every stored document holds, and what 228 call sites compare
 * against. Re-casing to lowercase would have meant a 228-site refactor plus a
 * backfill of every patient record for no behavioural gain.
 *
 * `'unknown'` is deliberately NOT accepted here. Nothing in the codebase stores
 * it (only `fhir.ts` emits lowercase `unknown` outbound, which is correct per
 * the FHIR spec and is a projection, not storage). Adding an Unknown option is
 * a real product gap for unidentified patients and neonates — it is tracked
 * separately in docs/EMR-FIELD-AUDIT-2026-07.md §2 and needs a UI, not just an
 * enum value.
 */
export const CANONICAL_GENDERS = ['Male', 'Female'] as const;
export type CanonicalGender = (typeof CANONICAL_GENDERS)[number];

/**
 * Normalise a supplied gender to its canonical casing, or null when it is not
 * a recognised value. Case-insensitive so a form or import posting `"male"`
 * still lands as `"Male"` in storage rather than creating a second spelling.
 */
export function normalizeGender(value: unknown): CanonicalGender | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'male') return 'Male';
  if (v === 'female') return 'Female';
  return null;
}

/**
 * Validate a date of birth as a CALENDAR date (KAN-16).
 *
 * The old check was `new Date(dob) > new Date()`. On a `YYYY-MM-DD` string —
 * which is what an HTML `type="date"` input produces — `new Date()` parses to
 * **UTC midnight**, while the right-hand side is local now. In Juba (UTC+2) a
 * birth registered today read as 2 hours in the future for the first two hours
 * of every day, so a newborn's registration was rejected as "cannot be in the
 * future". West of UTC the error runs the other way and a genuinely future date
 * passes. Comparing Y/M/D directly removes the timezone from the question.
 *
 * Returns an error message, or null when the value is acceptable.
 */
export function validateDateOfBirth(raw: string, today: Date = new Date()): string | null {
  const value = (raw || '').trim();
  if (!value) return null;

  // Accept only the ISO calendar form the date input emits. `new Date()` would
  // happily accept "not a date"-adjacent strings and silently coerce them.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return 'Invalid date of birth';

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 'Invalid date of birth';

  // Reject impossible days (31 April, 29 Feb in a common year) — Date rolls
  // these forward silently, so "2026-02-30" would otherwise become 2 March.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return 'Invalid date of birth';
  }

  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  if (y > ty || (y === ty && (mo > tm || (mo === tm && d > td)))) {
    return 'Date of birth cannot be in the future';
  }

  // A DOB older than the oldest verified human is a typo, not a centenarian.
  if (ty - y > 150) return 'Invalid date of birth';

  return null;
}

/**
 * Best-effort patient age in years, for age-appropriate vital-sign bounds.
 *
 * Prefers a real date of birth; falls back to `estimatedAge`, which is what
 * registration captures when the patient doesn't know their birthday (common).
 * Returns undefined when neither is present — callers then get adult bounds,
 * which is the pre-existing behaviour.
 */
export function patientAgeInYears(source: Record<string, unknown> | undefined): number | undefined {
  if (!source) return undefined;

  const dob = source.dateOfBirth;
  if (typeof dob === 'string' && dob.trim()) {
    // Compare as calendar dates; `new Date(dob)` on a YYYY-MM-DD string is
    // UTC midnight, so a plain millisecond diff can be off by a day near the
    // boundary depending on server timezone.
    const [y, m, d] = dob.split('-').map(Number);
    if (y && m && d) {
      const today = new Date();
      let age = today.getFullYear() - y;
      const beforeBirthday =
        today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
      if (beforeBirthday) age -= 1;
      // Infants need sub-year precision — the <1 band is the whole point.
      if (age < 1) {
        const days = Math.floor((today.getTime() - Date.UTC(y, m - 1, d)) / 86_400_000);
        return days >= 0 ? days / 365.25 : undefined;
      }
      if (age >= 0 && age < 150) return age;
    }
  }

  const estimated = Number(source.estimatedAge);
  if (!isNaN(estimated) && estimated >= 0 && estimated < 150) return estimated;

  return undefined;
}

export function validateMedicalRecord(data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.patientId || typeof data.patientId !== 'string') {
    errors.patientId = 'Patient ID is required';
  }

  if (!data.hospitalId || typeof data.hospitalId !== 'string') {
    errors.hospitalId = 'Hospital ID is required';
  }

  if (!data.chiefComplaint || (typeof data.chiefComplaint === 'string' && data.chiefComplaint.trim().length < 3)) {
    errors.chiefComplaint = 'Chief complaint is required (min 3 characters)';
  }

  if (data.vitalSigns && typeof data.vitalSigns === 'object') {
    // Pass the patient's age so children are measured against paediatric
    // bounds. `data.patient` is the joined record where available; otherwise
    // an age carried directly on the payload is used. Falls back to adult
    // bounds when neither is known.
    const ageYears = patientAgeInYears(
      (data.patient as Record<string, unknown> | undefined) ?? data,
    );
    const vitalErrors = validateVitalSigns(data.vitalSigns as Record<string, unknown>, ageYears);
    Object.entries(vitalErrors).forEach(([k, v]) => {
      errors[`vitalSigns.${k}`] = v;
    });
  }

  return errors;
}

export function validatePrescription(data: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.medication || (typeof data.medication === 'string' && !data.medication.trim())) {
    errors.medication = 'Medication name is required';
  }
  if (!data.dose || (typeof data.dose === 'string' && !data.dose.trim())) {
    errors.dose = 'Dose is required';
  }
  if (!data.frequency || (typeof data.frequency === 'string' && !data.frequency.trim())) {
    errors.frequency = 'Frequency is required';
  }
  if (!data.patientId || typeof data.patientId !== 'string') {
    errors.patientId = 'Patient ID is required';
  }
  return errors;
}
