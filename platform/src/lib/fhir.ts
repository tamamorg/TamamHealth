/**
 * FHIR R4 serializers — map our PouchDB entities into minimal FHIR resources
 * for external consumers. These produce READ-ONLY projections; writes still go
 * through the native /api/* routes.
 *
 * We don't attempt full conformance against any specific FHIR profile yet
 * (that would require a registered CapabilityStatement per country). We emit
 * the subset of fields that clinical consumers typically need, with proper
 * FHIR resource shapes so it's parseable by any FHIR-aware tool.
 */
import type {
  PatientDoc,
  MedicalRecordDoc,
  LabResultDoc,
  PrescriptionDoc,
  ReferralDoc,
} from './db-types';

/**
 * Base URI used to namespace FHIR `identifier.system` URLs and the
 * terminology CodeSystem/ValueSet `url` fields. FHIR identifiers must be
 * globally unique; whoever runs this platform should set
 * `NEXT_PUBLIC_FHIR_NAMESPACE_BASE` to a domain they own (e.g.
 * `https://terminology.your-org.org`). Falls back to TamamHealth's own
 * namespace when unset so the demo build remains self-contained.
 */
export const FHIR_NAMESPACE_BASE = (
  process.env.NEXT_PUBLIC_FHIR_NAMESPACE_BASE || 'https://tamamhealth.org'
).replace(/\/+$/, '');

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  meta?: { lastUpdated?: string };
  identifier?: Array<{ system?: string; value: string }>;
  active?: boolean;
  name?: Array<{ use?: string; family?: string; given?: string[] }>;
  telecom?: Array<{ system?: string; value?: string; use?: string }>;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: Array<{ line?: string[]; city?: string; district?: string; state?: string; country?: string }>;
  managingOrganization?: { reference: string };
}

export function toFhirPatient(p: PatientDoc): FhirPatient {
  return {
    resourceType: 'Patient',
    id: p._id,
    meta: { lastUpdated: p.updatedAt },
    identifier: [
      ...(p.hospitalNumber ? [{ system: `${FHIR_NAMESPACE_BASE}/hospital-number`, value: p.hospitalNumber }] : []),
      ...(p.geocodeId ? [{ system: `${FHIR_NAMESPACE_BASE}/geocode`, value: p.geocodeId }] : []),
      ...(p.nationalId ? [{ system: `${FHIR_NAMESPACE_BASE}/national-id`, value: p.nationalId }] : []),
      ...(p.identifiers ?? []).map(id => ({
        system: `${FHIR_NAMESPACE_BASE}/${id.type.replace('_', '-')}${id.country ? `/${id.country.toLowerCase()}` : ''}`,
        value: id.value,
      })),
    ],
    active: p.isActive !== false,
    name: [{
      use: 'official',
      family: p.surname,
      given: [p.firstName, ...(p.middleName ? [p.middleName] : [])].filter(Boolean),
    }],
    telecom: [
      ...(p.phone ? [{ system: 'phone', value: p.phone, use: 'mobile' }] : []),
      ...(p.altPhone ? [{ system: 'phone', value: p.altPhone, use: 'home' }] : []),
    ],
    gender: p.gender === 'Male' ? 'male' : p.gender === 'Female' ? 'female' : p.gender === 'Other' ? 'other' : 'unknown',
    birthDate: p.dateOfBirth,
    address: p.state || p.county || p.residenceCountry ? [{
      line: p.address ? [p.address] : undefined,
      city: p.county,
      district: p.payam,
      state: p.state,
      country: p.residenceCountry ?? p.countryId,
    }] : undefined,
    managingOrganization: p.registrationHospital
      ? { reference: `Organization/${p.registrationHospital}` }
      : undefined,
  };
}

export interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  meta?: { lastUpdated?: string };
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'cancelled';
  category?: Array<{ coding: Array<{ system?: string; code: string; display?: string }> }>;
  code: { text: string };
  subject: { reference: string };
  effectiveDateTime?: string;
  valueString?: string;
  referenceRange?: Array<{ text?: string }>;
  interpretation?: Array<{ coding: Array<{ system?: string; code: string }> }>;
}

export function toFhirObservation(lab: LabResultDoc): FhirObservation {
  const status = lab.status === 'completed'
    ? 'final'
    : lab.status === 'in_progress'
      ? 'preliminary'
      : 'registered';
  return {
    resourceType: 'Observation',
    id: lab._id,
    meta: { lastUpdated: lab.updatedAt },
    status,
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'laboratory',
        display: 'Laboratory',
      }],
    }],
    code: { text: lab.testName },
    subject: { reference: `Patient/${lab.patientId}` },
    effectiveDateTime: lab.completedAt || lab.orderedAt,
    valueString: lab.result ? `${lab.result}${lab.unit ? ' ' + lab.unit : ''}` : undefined,
    referenceRange: lab.referenceRange ? [{ text: lab.referenceRange }] : undefined,
    interpretation: lab.abnormal
      ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: lab.critical ? 'HH' : 'A' }] }]
      : undefined,
  };
}

export interface FhirEncounter {
  resourceType: 'Encounter';
  id: string;
  meta?: { lastUpdated?: string };
  status: 'planned' | 'arrived' | 'in-progress' | 'finished' | 'cancelled';
  class: { system?: string; code: string; display?: string };
  subject: { reference: string };
  period?: { start?: string; end?: string };
  reasonCode?: Array<{ text: string }>;
  serviceProvider?: { reference: string };
}

export function toFhirEncounter(rec: MedicalRecordDoc): FhirEncounter {
  return {
    resourceType: 'Encounter',
    id: rec._id,
    meta: { lastUpdated: rec.updatedAt },
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory',
    },
    subject: { reference: `Patient/${rec.patientId}` },
    period: { start: rec.consultedAt || rec.visitDate },
    reasonCode: rec.chiefComplaint ? [{ text: rec.chiefComplaint }] : undefined,
    serviceProvider: rec.hospitalId ? { reference: `Organization/${rec.hospitalId}` } : undefined,
  };
}

export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  meta?: { lastUpdated?: string };
  status: 'active' | 'completed' | 'cancelled' | 'stopped' | 'draft';
  intent: 'order';
  medicationCodeableConcept: { text: string };
  subject: { reference: string };
  authoredOn?: string;
  requester?: { display?: string };
  dosageInstruction?: Array<{ text: string }>;
}

export function toFhirMedicationRequest(rx: PrescriptionDoc): FhirMedicationRequest {
  const status = rx.status === 'dispensed' ? 'completed' : 'active';
  return {
    resourceType: 'MedicationRequest',
    id: rx._id,
    meta: { lastUpdated: rx.updatedAt },
    status,
    intent: 'order',
    medicationCodeableConcept: { text: rx.medication },
    subject: { reference: `Patient/${rx.patientId}` },
    authoredOn: rx.createdAt,
    requester: rx.prescribedBy ? { display: rx.prescribedBy } : undefined,
    dosageInstruction: rx.dose ? [{ text: `${rx.dose}${rx.frequency ? ' ' + rx.frequency : ''}${rx.duration ? ' for ' + rx.duration : ''}` }] : undefined,
  };
}

export interface FhirBundleEntry {
  fullUrl?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resource: any;
  request?: { method: 'POST' | 'PUT' | 'GET'; url: string };
}

export interface FhirBundle {
  resourceType: 'Bundle';
  id?: string;
  meta?: { lastUpdated?: string };
  type: 'document' | 'searchset' | 'transaction' | 'batch' | 'history' | 'message';
  total?: number;
  entry: FhirBundleEntry[];
  timestamp?: string;
}

export function toFhirReferralBundle(
  ref: ReferralDoc,
  patient?: PatientDoc,
  records?: MedicalRecordDoc[],
  labs?: LabResultDoc[],
  prescriptions?: PrescriptionDoc[],
): FhirBundle {
  const entries: FhirBundleEntry[] = [];
  if (patient) {
    entries.push({ fullUrl: `Patient/${patient._id}`, resource: toFhirPatient(patient) });
  }
  for (const rec of records || []) {
    entries.push({ fullUrl: `Encounter/${rec._id}`, resource: toFhirEncounter(rec) });
  }
  for (const lab of labs || []) {
    entries.push({ fullUrl: `Observation/${lab._id}`, resource: toFhirObservation(lab) });
  }
  for (const rx of prescriptions || []) {
    entries.push({ fullUrl: `MedicationRequest/${rx._id}`, resource: toFhirMedicationRequest(rx) });
  }
  return {
    resourceType: 'Bundle',
    id: ref._id,
    meta: { lastUpdated: ref.updatedAt },
    type: 'document',
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}
