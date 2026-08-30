import { getAllBirths, getBirthStats } from './birth-service';
import { getAllDeaths, getDeathStats } from './death-service';
import { getAllAssessments } from './facility-assessment-service';
import { getNationalDataQuality } from './data-quality-service';
import { getAllEncounters } from './encounter-service';
import { hospitalsDB, patientsDB, referralsDB, diseaseAlertsDB, labResultsDB, prescriptionsDB, immunizationsDB, ancDB } from '../db';
import type { HospitalDoc, PatientDoc, ReferralDoc, DiseaseAlertDoc, LabResultDoc, PrescriptionDoc, ImmunizationDoc, ANCVisitDoc, EncounterDoc, UserRole } from '../db-types';
import { findByType } from './db-query';
import { resolveDataElement, validateDataElements } from './dhis2-element-map';
import type { DHIS2ElementValidation } from './dhis2-element-map';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { isInRange } from '../time-juba';
import { escapeCsvCell } from '../csv';

// DHIS2 only accepts compact period codes (YYYYMM / YYYYWww / YYYY) — accept
// the HTML-friendly YYYY-MM the UI emits but reject anything else.
export function normalizeDhis2Period(period: string, frequency: 'monthly' | 'weekly' | 'yearly' = 'monthly'): string {
  if (frequency === 'monthly') {
    const m = /^(\d{4})-?(\d{2})$/.exec(period);
    if (m) return `${m[1]}${m[2]}`;
  } else if (frequency === 'yearly') {
    if (/^\d{4}$/.test(period)) return period;
  } else if (frequency === 'weekly') {
    const m = /^(\d{4})-?W(\d{2})$/.exec(period);
    if (m) return `${m[1]}W${m[2]}`;
  }
  throw new Error('Invalid DHIS2 period format: ' + period);
}

// An aggregate emitted at the wrong level shows up at DHIS2 as a national
// submission — scope down to facility/payam/org when present, only fall
// back to 'SS' for truly national exporters.
export function aggregateOrgUnit(scope?: { hospitalId?: string; orgId?: string; role?: string }): string {
  if (!scope) return 'SS';
  if (scope.hospitalId) return scope.hospitalId;
  if (scope.orgId) return scope.orgId;
  return 'SS';
}

export interface DHIS2ExportScope {
  hospitalId?: string;
  orgId?: string;
  role?: string;
}

/** Africa/Juba is UTC+02:00 (CAT since 1 Feb 2021), no DST — mirrors the constant in time-juba.ts. */
const JUBA_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * Convert a normalized DHIS2 period (YYYYMM / YYYYWww / YYYY — the output of
 * `normalizeDhis2Period`) into a half-open [from, to) ISO instant range,
 * anchored to Africa/Juba wall-clock boundaries. Every data element below is
 * filtered to source docs whose own event timestamp falls in this range —
 * previously `period` was only used as a label, never as a filter
 * (docs/EMR-FIELD-AUDIT-2026-07.md §4).
 */
export function periodToRange(period: string, frequency: 'monthly' | 'weekly' | 'yearly' = 'monthly'): { from: string; to: string } {
  if (frequency === 'yearly') {
    const y = Number(period);
    return {
      from: new Date(Date.UTC(y, 0, 1) - JUBA_OFFSET_MS).toISOString(),
      to: new Date(Date.UTC(y + 1, 0, 1) - JUBA_OFFSET_MS).toISOString(),
    };
  }
  if (frequency === 'weekly') {
    const m = /^(\d{4})W(\d{2})$/.exec(period);
    if (!m) throw new Error('Invalid weekly DHIS2 period: ' + period);
    const y = Number(m[1]);
    const week = Number(m[2]);
    // ISO week 1 is the week containing Jan 4th. Find that week's Monday
    // (calendar-date arithmetic — weekday doesn't depend on timezone), then
    // step forward (week - 1) weeks, matching jubaWeekStart()'s Monday-start
    // convention.
    const jan4Day = new Date(Date.UTC(y, 0, 4)).getUTCDay();
    const daysFromMonday = (jan4Day + 6) % 7;
    const week1MondayCalendarMs = Date.UTC(y, 0, 4 - daysFromMonday);
    const startCalendarMs = week1MondayCalendarMs + (week - 1) * 7 * 24 * 60 * 60 * 1000;
    return {
      from: new Date(startCalendarMs - JUBA_OFFSET_MS).toISOString(),
      to: new Date(startCalendarMs + 7 * 24 * 60 * 60 * 1000 - JUBA_OFFSET_MS).toISOString(),
    };
  }
  // monthly: YYYYMM
  const y = Number(period.slice(0, 4));
  const mo = Number(period.slice(4, 6)); // 1-12
  return {
    from: new Date(Date.UTC(y, mo - 1, 1) - JUBA_OFFSET_MS).toISOString(),
    to: new Date(Date.UTC(y, mo, 1) - JUBA_OFFSET_MS).toISOString(),
  };
}

/**
 * Build the filterByScope-compatible DataScope from the export's (looser)
 * DHIS2ExportScope. Without a role we can't tell admin/national roles from
 * facility-scoped ones, so we deliberately skip scope filtering rather than
 * guess — the caller gets the pre-existing unscoped behavior in that case.
 */
function toDataScope(scope?: DHIS2ExportScope): DataScope | undefined {
  if (!scope?.role) return undefined;
  return { role: scope.role as UserRole, orgId: scope.orgId, hospitalId: scope.hospitalId };
}

/**
 * Age band for the OPD attendance category combo, as of the encounter's
 * `startedAt`. Prefers an exact age from `dateOfBirth`; falls back to the
 * patient's raw `estimatedAge` (registration-time estimate, not decayed
 * forward — decaying it would be a guess layered on a guess); returns
 * 'unknown-age' when neither is available or the patient can't be joined at
 * all. Never fabricates a band.
 */
function resolveAgeBand(patient: PatientDoc | undefined, atIso: string): 'under5' | '5plus' | 'unknown-age' {
  if (!patient) return 'unknown-age';
  let ageYears: number | undefined;
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth).getTime();
    const at = new Date(atIso).getTime();
    if (!Number.isNaN(dob) && !Number.isNaN(at)) {
      ageYears = (at - dob) / (365.25 * 24 * 60 * 60 * 1000);
    }
  }
  if (ageYears === undefined && typeof patient.estimatedAge === 'number') {
    ageYears = patient.estimatedAge;
  }
  if (ageYears === undefined || ageYears < 0) return 'unknown-age';
  return ageYears < 5 ? 'under5' : '5plus';
}

/**
 * Sex label for the OPD category combo. PatientDoc.gender is currently a
 * required 'Male' | 'Female' field (no 'Unknown' option yet —
 * docs/EMR-FIELD-AUDIT-2026-07.md §2 reception table flags that as a
 * separate fix), so the only way to land here without an exact match is an
 * unjoinable patient (deleted/missing doc) — never guessed as either sex.
 */
function resolveSexLabel(patient: PatientDoc | undefined): 'male' | 'female' | 'unknown-sex' {
  if (patient?.gender === 'Male') return 'male';
  if (patient?.gender === 'Female') return 'female';
  return 'unknown-sex';
}

export interface DHIS2DataSet {
  exportDate: string;
  period: string;
  orgUnit: string;
  dataValues: DHIS2DataValue[];
  /**
   * Whether every `dataElement` above is a real DHIS2 UID. Absent on datasets
   * built before the UID map existed. Surface `warning` in the export UI —
   * an unmapped payload is accepted here and rejected by DHIS2.
   */
  elementValidation?: DHIS2ElementValidation;
}

export interface DHIS2DataValue {
  dataElement: string;
  category: string;
  value: string;
  period: string;
  orgUnit: string;
}

export async function generateDHIS2Export(
  rawPeriod: string,
  scope?: DHIS2ExportScope,
  frequency: 'monthly' | 'weekly' | 'yearly' = 'monthly',
): Promise<DHIS2DataSet> {
  const period = normalizeDhis2Period(rawPeriod, frequency);
  const orgUnit = aggregateOrgUnit(scope);
  const now = new Date().toISOString();
  const range = periodToRange(period, frequency);
  const dataScope = toDataScope(scope);

  // Gather all data. Every element below is either (a) a STOCK value — a
  // point-in-time count (facility roster, staff, beds, current patient
  // register, readiness assessment) that is scope-filtered but NOT
  // period-filtered because "how many beds does the facility have right now"
  // has no period, or (b) a FLOW value — activity that happened inside
  // `range`, filtered on the source doc's own event timestamp per
  // docs/EMR-FIELD-AUDIT-2026-07.md §4.
  const hDB = hospitalsDB();
  let hospitals = await findByType<HospitalDoc>(hDB, 'hospital');
  if (dataScope) {
    // HospitalDoc has no separate `hospitalId` field — its own `_id` IS the
    // facility id — so mirror data-quality-service.ts's approach of aliasing
    // `_id` onto `hospitalId` before running it through the shared scope filter.
    hospitals = filterByScope(
      hospitals.map(h => ({ ...h, hospitalId: (h as HospitalDoc & { hospitalId?: string }).hospitalId ?? h._id })),
      dataScope,
    ) as HospitalDoc[];
  }

  const pDB = patientsDB();
  const allPatients = await findByType<PatientDoc>(pDB, 'patient');
  // Kept unfiltered for the OPD age/sex join below — an encounter can belong
  // to a patient registered at a different facility (referral/transfer), so
  // the join must not be pre-restricted to the export's own scope. The STOCK
  // "how many patients on file" count below uses the scoped view instead.
  const patients = dataScope ? filterByScope(allPatients, dataScope) : allPatients;
  const patientById = new Map(allPatients.map(p => [p._id, p]));

  const rDB = referralsDB();
  let referrals = await findByType<ReferralDoc>(rDB, 'referral');
  if (dataScope) referrals = filterByScope(referrals, dataScope);
  referrals = referrals.filter(r => isInRange(r.createdAt, range));

  const daDB = diseaseAlertsDB();
  let alerts = await findByType<DiseaseAlertDoc>(daDB, 'disease_alert');
  if (dataScope) alerts = filterByScope(alerts, dataScope);
  alerts = alerts.filter(a => isInRange(a.reportDate, range));

  const birthStats = await getBirthStats(dataScope, range);
  const deathStats = await getDeathStats(dataScope, range);
  const births = (await getAllBirths(dataScope)).filter(b => isInRange(b.dateOfBirth, range));
  const deaths = (await getAllDeaths(dataScope)).filter(d => isInRange(d.dateOfDeath, range));
  // Facility readiness assessments and the national data-quality rollup are
  // STOCK values (current state of the facility, not something that
  // happened inside the period) — scope-filtered only.
  const assessments = await getAllAssessments(dataScope);
  const dataQuality = await getNationalDataQuality(dataScope);

  // Lab data — event timestamp is the order date.
  const labDB = labResultsDB();
  let labResults = await findByType<LabResultDoc>(labDB, 'lab_result');
  if (dataScope) labResults = filterByScope(labResults, dataScope);
  labResults = labResults.filter(l => isInRange(l.orderedAt, range));

  // Prescription data — PrescriptionDoc has no distinct `prescribedAt`; the
  // inherited BaseDoc `createdAt` is the moment the order was written, which
  // is the prescribing event.
  const rxDB = prescriptionsDB();
  let prescriptions = await findByType<PrescriptionDoc>(rxDB, 'prescription');
  if (dataScope) prescriptions = filterByScope(prescriptions, dataScope);
  prescriptions = prescriptions.filter(p => isInRange(p.createdAt, range));

  // Immunization data — event timestamp is the administration date.
  const immDB = immunizationsDB();
  let immunizations = await findByType<ImmunizationDoc>(immDB, 'immunization');
  if (dataScope) immunizations = filterByScope(immunizations, dataScope);
  immunizations = immunizations.filter(i => isInRange(i.dateGiven, range));

  // ANC data — event timestamp is the visit date.
  const ancDatabase = ancDB();
  let ancVisits = await findByType<ANCVisitDoc>(ancDatabase, 'anc_visit');
  if (dataScope) ancVisits = filterByScope(ancVisits, dataScope);
  ancVisits = ancVisits.filter(a => isInRange(a.visitDate, range));

  // Encounters — the OPD attendance source. Event timestamp is arrival
  // (`startedAt`), matching how the encounter is created at check-in
  // (encounter-service.ts createArrivalEncounter).
  const allEncounters: EncounterDoc[] = await getAllEncounters(dataScope);
  const encounters = allEncounters.filter(e => isInRange(e.startedAt, range));

  const dataValues: DHIS2DataValue[] = [];

  // Population health indicators (STOCK — scope-filtered, not period-filtered)
  dataValues.push(
    { dataElement: 'TOTAL_HOSPITALS', category: 'default', value: hospitals.length.toString(), period, orgUnit },
    { dataElement: 'TOTAL_PATIENTS', category: 'default', value: patients.length.toString(), period, orgUnit },
    { dataElement: 'TOTAL_BEDS', category: 'default', value: hospitals.reduce((s, h) => s + h.totalBeds, 0).toString(), period, orgUnit },
    { dataElement: 'TOTAL_DOCTORS', category: 'default', value: hospitals.reduce((s, h) => s + h.doctors, 0).toString(), period, orgUnit },
    { dataElement: 'TOTAL_NURSES', category: 'default', value: hospitals.reduce((s, h) => s + h.nurses, 0).toString(), period, orgUnit },
    { dataElement: 'TOTAL_CLINICAL_OFFICERS', category: 'default', value: hospitals.reduce((s, h) => s + h.clinicalOfficers, 0).toString(), period, orgUnit },
  );

  // OPD attendance (new indicator — docs/EMR-FIELD-AUDIT-2026-07.md §4 item 1:
  // "OPD attendances (new/repeat × age-band × sex) — needs encounter +
  // attendanceType only"). Period + scope filtered above.
  const attendanceNew = encounters.filter(e => e.attendanceType === 'new').length;
  const attendanceRepeat = encounters.filter(e => e.attendanceType === 'repeat').length;
  dataValues.push(
    { dataElement: 'OPD_ATTENDANCE_TOTAL', category: 'default', value: encounters.length.toString(), period, orgUnit },
    { dataElement: 'OPD_ATTENDANCE_NEW', category: 'default', value: attendanceNew.toString(), period, orgUnit },
    { dataElement: 'OPD_ATTENDANCE_REPEAT', category: 'default', value: attendanceRepeat.toString(), period, orgUnit },
  );
  // Age-band × sex category combos, joined from PatientDoc at encounter time.
  // Seed the expected grid with zeros (same "emit zeros" rationale as the
  // per-facility births/deaths loop below) so an empty combo is
  // distinguishable from a combo that was never computed; a patient with no
  // DOB/estimatedAge or no matching PatientDoc lands in the explicit
  // unknown-age combo — never guessed.
  const opdCategoryCounts = new Map<string, number>([
    ['under5-male', 0], ['under5-female', 0],
    ['5plus-male', 0], ['5plus-female', 0],
    ['unknown-age-male', 0], ['unknown-age-female', 0],
  ]);
  for (const enc of encounters) {
    const patient = patientById.get(enc.patientId);
    const ageBand = resolveAgeBand(patient, enc.startedAt);
    const sexLabel = resolveSexLabel(patient);
    const key = `${ageBand}-${sexLabel}`;
    opdCategoryCounts.set(key, (opdCategoryCounts.get(key) ?? 0) + 1);
  }
  for (const [category, count] of [...opdCategoryCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    dataValues.push({ dataElement: 'OPD_ATTENDANCE_BY_CATEGORY', category, value: count.toString(), period, orgUnit });
  }

  // CRVS indicators
  dataValues.push(
    { dataElement: 'BIRTHS_REGISTERED', category: 'default', value: birthStats.total.toString(), period, orgUnit },
    { dataElement: 'BIRTHS_MALE', category: 'male', value: birthStats.byGender.male.toString(), period, orgUnit },
    { dataElement: 'BIRTHS_FEMALE', category: 'female', value: birthStats.byGender.female.toString(), period, orgUnit },
    { dataElement: 'BIRTHS_CAESAREAN', category: 'default', value: birthStats.byDeliveryType.caesarean.toString(), period, orgUnit },
    { dataElement: 'DEATHS_REGISTERED', category: 'default', value: deathStats.total.toString(), period, orgUnit },
    { dataElement: 'DEATHS_WITH_ICD11', category: 'default', value: deathStats.withICD11Code.toString(), period, orgUnit },
    { dataElement: 'MATERNAL_DEATHS', category: 'default', value: deathStats.maternalDeaths.toString(), period, orgUnit },
    { dataElement: 'UNDER5_DEATHS', category: 'default', value: deathStats.under5Deaths.toString(), period, orgUnit },
    { dataElement: 'NEONATAL_DEATHS', category: 'default', value: deathStats.neonatalDeaths.toString(), period, orgUnit },
    { dataElement: 'DEATH_NOTIFICATION_RATE', category: 'default', value: deathStats.total ? Math.round(deathStats.notified / deathStats.total * 100).toString() : '0', period, orgUnit },
    { dataElement: 'DEATH_REGISTRATION_RATE', category: 'default', value: deathStats.total ? Math.round(deathStats.registered / deathStats.total * 100).toString() : '0', period, orgUnit },
  );

  // Disease surveillance
  dataValues.push(
    { dataElement: 'ACTIVE_DISEASE_ALERTS', category: 'default', value: alerts.filter(a => a.alertLevel === 'emergency' || a.alertLevel === 'warning').length.toString(), period, orgUnit },
    { dataElement: 'TOTAL_REFERRALS', category: 'default', value: referrals.length.toString(), period, orgUnit },
  );

  // Lab indicators
  const labCompleted = labResults.filter(l => l.status === 'completed').length;
  const labPending = labResults.filter(l => l.status === 'pending').length;
  const labInProgress = labResults.filter(l => l.status === 'in_progress').length;
  const labCritical = labResults.filter(l => l.critical).length;
  dataValues.push(
    { dataElement: 'LAB_TESTS_TOTAL', category: 'default', value: labResults.length.toString(), period, orgUnit },
    { dataElement: 'LAB_TESTS_COMPLETED', category: 'default', value: labCompleted.toString(), period, orgUnit },
    { dataElement: 'LAB_TESTS_PENDING', category: 'default', value: labPending.toString(), period, orgUnit },
    { dataElement: 'LAB_TESTS_IN_PROGRESS', category: 'default', value: labInProgress.toString(), period, orgUnit },
    { dataElement: 'LAB_CRITICAL_RESULTS', category: 'default', value: labCritical.toString(), period, orgUnit },
  );

  // Prescription indicators
  const rxDispensed = prescriptions.filter(p => p.status === 'dispensed').length;
  const rxPending = prescriptions.filter(p => p.status === 'pending').length;
  dataValues.push(
    { dataElement: 'PRESCRIPTIONS_TOTAL', category: 'default', value: prescriptions.length.toString(), period, orgUnit },
    { dataElement: 'PRESCRIPTIONS_DISPENSED', category: 'default', value: rxDispensed.toString(), period, orgUnit },
    { dataElement: 'PRESCRIPTIONS_PENDING', category: 'default', value: rxPending.toString(), period, orgUnit },
  );

  // Immunization indicators. Coverage percentages (IMM_*_COVERAGE) were
  // removed: they divided doses by "unique children seen in this dataset"
  // rather than a population/census denominator, so the resulting "%" was
  // uninterpretable as coverage (docs/EMR-FIELD-AUDIT-2026-07.md §4 honesty
  // fix). Dose counts — the actual captured data — are kept.
  const bcgCompleted = immunizations.filter(i => i.vaccine === 'BCG' && i.status === 'completed').length;
  const penta3Completed = immunizations.filter(i => i.vaccine === 'Penta' && i.doseNumber === 3 && i.status === 'completed').length;
  const measles1Completed = immunizations.filter(i => i.vaccine === 'Measles' && i.doseNumber === 1 && i.status === 'completed').length;
  const immDefaulters = immunizations.filter(i => i.status === 'overdue' || i.status === 'missed').length;
  const uniqueChildren = new Set(immunizations.map(i => i.patientId)).size;
  dataValues.push(
    { dataElement: 'IMM_CHILDREN_TOTAL', category: 'default', value: uniqueChildren.toString(), period, orgUnit },
    { dataElement: 'IMM_BCG_COMPLETED', category: 'default', value: bcgCompleted.toString(), period, orgUnit },
    { dataElement: 'IMM_PENTA3_COMPLETED', category: 'default', value: penta3Completed.toString(), period, orgUnit },
    { dataElement: 'IMM_MEASLES1_COMPLETED', category: 'default', value: measles1Completed.toString(), period, orgUnit },
    { dataElement: 'IMM_DEFAULTERS', category: 'default', value: immDefaulters.toString(), period, orgUnit },
  );

  // ANC indicators
  const uniqueMothers = new Set(ancVisits.map(a => a.motherId)).size;
  const anc4Plus = new Map<string, number>();
  ancVisits.forEach(a => {
    anc4Plus.set(a.motherId, (anc4Plus.get(a.motherId) || 0) + 1);
  });
  const mothersWithANC4Plus = [...anc4Plus.values()].filter(v => v >= 4).length;
  const highRiskMothers = new Set(ancVisits.filter(a => a.riskLevel === 'high').map(a => a.motherId)).size;
  dataValues.push(
    { dataElement: 'ANC_MOTHERS_TOTAL', category: 'default', value: uniqueMothers.toString(), period, orgUnit },
    { dataElement: 'ANC_VISITS_TOTAL', category: 'default', value: ancVisits.length.toString(), period, orgUnit },
    { dataElement: 'ANC_4PLUS_VISITS', category: 'default', value: mothersWithANC4Plus.toString(), period, orgUnit },
    { dataElement: 'ANC_HIGH_RISK', category: 'default', value: highRiskMothers.toString(), period, orgUnit },
  );

  // Data quality indicators (from WHO report) — STOCK, scope-filtered only.
  dataValues.push(
    { dataElement: 'REPORTING_COMPLETENESS', category: 'default', value: dataQuality.avgCompleteness.toString(), period, orgUnit },
    { dataElement: 'REPORTING_TIMELINESS', category: 'default', value: dataQuality.avgTimeliness.toString(), period, orgUnit },
    { dataElement: 'DATA_QUALITY_SCORE', category: 'default', value: dataQuality.avgQuality.toString(), period, orgUnit },
    { dataElement: 'DHIS2_ADOPTION_RATE', category: 'default', value: dataQuality.dhis2Adoption.toString(), period, orgUnit },
    { dataElement: 'FACILITIES_ASSESSED', category: 'default', value: assessments.length.toString(), period, orgUnit },
    { dataElement: 'HIS_WORKFORCE', category: 'default', value: dataQuality.totalHISStaff.toString(), period, orgUnit },
  );

  // Per-facility births/deaths — emit zeros so a facility that reported 0 is
  // distinguishable from a facility that didn't report at all. `births`/
  // `deaths` are already period+scope filtered above.
  for (const h of hospitals) {
    const fBirths = births.filter(b => b.facilityId === h._id).length;
    const fDeaths = deaths.filter(d => d.facilityId === h._id).length;
    dataValues.push({ dataElement: 'FACILITY_BIRTHS', category: 'default', value: fBirths.toString(), period, orgUnit: h._id });
    dataValues.push({ dataElement: 'FACILITY_DEATHS', category: 'default', value: fDeaths.toString(), period, orgUnit: h._id });
  }

  // Translate concept names to the deployment's configured DHIS2 UIDs. With no
  // map configured this is a no-op and `elementValidation` explains why the
  // receiving instance will reject the payload — see dhis2-element-map.ts.
  const resolved = dataValues.map((dv) => ({ ...dv, dataElement: resolveDataElement(dv.dataElement) }));
  const elementValidation = validateDataElements(resolved.map((dv) => dv.dataElement));
  if (!elementValidation.valid) {
    console.warn('[dhis2-export]', elementValidation.warning);
  }

  return {
    exportDate: now,
    period,
    orgUnit,
    dataValues: resolved,
    elementValidation,
  };
}

export function exportToJSON(dataset: DHIS2DataSet): string {
  return JSON.stringify(dataset, null, 2);
}

/**
 * Push a generated dataset to the configured DHIS2 server.
 * Reads NEXT_PUBLIC_DHIS2_BASE_URL (e.g. https://hmis.southsudan.health) and
 * sends the dataset as a `dataValueSets` POST. Returns a structured outcome
 * so the UI can show "queued for retry" on a flaky network without a
 * try/catch wrapper at every call site.
 */
export interface DHIS2PushResult {
  ok: boolean;
  status: 'pushed' | 'queued' | 'unconfigured' | 'failed';
  pushed?: number;
  message: string;
}

export async function pushDataSetToDHIS2(
  dataset: DHIS2DataSet,
  options: { baseUrl?: string; authHeader?: string; signal?: AbortSignal } = {},
): Promise<DHIS2PushResult> {
  // Server-side prefers DHIS2_BASE_URL (private, no NEXT_PUBLIC prefix) with
  // DHIS2_USER / DHIS2_PASSWORD or DHIS2_PAT credentials so the live-push
  // endpoint can assemble an authenticated request without leaking creds to
  // the browser. Falls back to the client-facing NEXT_PUBLIC_* for legacy UI
  // code and to blank (returns 'unconfigured') when neither is set.
  const baseUrl = options.baseUrl
    || (typeof process !== 'undefined' ? (process.env.DHIS2_BASE_URL || process.env.NEXT_PUBLIC_DHIS2_BASE_URL) : '')
    || '';
  if (!baseUrl) {
    return {
      ok: true,
      status: 'unconfigured',
      message: 'No DHIS2 server configured (DHIS2_BASE_URL unset). Export prepared locally — sync when online.',
    };
  }

  // Auto-compose Authorization header from env if caller didn't pass one.
  if (!options.authHeader && typeof process !== 'undefined') {
    const pat = process.env.DHIS2_PAT;
    const user = process.env.DHIS2_USER;
    const pass = process.env.DHIS2_PASSWORD;
    if (pat) {
      options = { ...options, authHeader: `ApiToken ${pat}` };
    } else if (user && pass) {
      const b64 = Buffer.from(`${user}:${pass}`).toString('base64');
      options = { ...options, authHeader: `Basic ${b64}` };
    }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: true,
      status: 'queued',
      message: 'Offline — sync queued for retry when network returns.',
    };
  }

  // Retry policy: DHIS2 servers commonly throttle (429) or take downtime for
  // backups (502/503/504). A naive single-shot push fails the export silently,
  // even though the next attempt seconds later would succeed. Three tries with
  // capped exponential backoff (250ms → 1s → 4s) cover the common transient
  // window without holding the user / cron up indefinitely. We DO NOT retry
  // 4xx errors other than 429: those are client-side problems (auth, payload
  // shape) where retry just wastes the operator's time.
  const url = `${baseUrl.replace(/\/$/, '')}/api/dataValueSets`;
  const body = JSON.stringify({
    period: dataset.period,
    orgUnit: dataset.orgUnit,
    completeDate: dataset.exportDate,
    dataValues: dataset.dataValues,
  });
  const headers = {
    'Content-Type': 'application/json',
    ...(options.authHeader ? { Authorization: options.authHeader } : {}),
  };
  const MAX_ATTEMPTS = 3;
  const isRetryableStatus = (s: number) => s === 408 || s === 429 || (s >= 500 && s < 600);
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  let lastErr: { status: number | null; message: string } = { status: null, message: '' };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: options.signal });
      if (res.ok) {
        return {
          ok: true,
          status: 'pushed',
          pushed: dataset.dataValues?.length ?? 0,
          message: `Pushed ${dataset.dataValues?.length ?? 0} data values to DHIS2.`,
        };
      }
      const text = await res.text().catch(() => '');
      lastErr = { status: res.status, message: `DHIS2 server responded ${res.status}${text ? ': ' + text.slice(0, 200) : ''}` };
      if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
        return { ok: false, status: 'failed', message: lastErr.message };
      }
    } catch (err) {
      // AbortError (caller cancelled) — propagate immediately, do NOT retry.
      const name = (err as Error)?.name;
      if (name === 'AbortError') {
        return { ok: false, status: 'failed', message: 'Push aborted by caller' };
      }
      lastErr = { status: null, message: `Network error: ${(err as Error).message}` };
      if (attempt === MAX_ATTEMPTS) {
        return { ok: false, status: 'failed', message: lastErr.message };
      }
    }
    // Backoff: 250ms, 1s, 4s. Jittered slightly so retries from many clients
    // don't synchronize against a flapping DHIS2 box.
    const base = 250 * Math.pow(4, attempt - 1);
    const jitter = Math.floor(Math.random() * 100);
    await sleep(base + jitter);
  }
  return { ok: false, status: 'failed', message: lastErr.message || 'Unknown error' };
}

export function exportToCSV(dataset: DHIS2DataSet): string {
  const header = 'dataElement,category,value,period,orgUnit';
  const rows = dataset.dataValues.map(v =>
    [v.dataElement, v.category, v.value, v.period, v.orgUnit].map(escapeCsvCell).join(',')
  );
  return [header, ...rows].join('\n');
}
