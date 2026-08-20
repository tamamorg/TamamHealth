import { medicalRecordsDB } from '../db';
import type { MedicalRecordDoc, RecordAddendum } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { validateMedicalRecord, ValidationError } from '../validation';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { isProviderRole, isClinicalAuthorRole } from '../clinical-roles';
import { maybeDecrypt, maybeEncrypt } from '../field-encryption';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { validateDiagnosisCodes, lookupIcd11 } from '../clinical/diagnosis-validation';
import type { DiagnosisLike } from '../clinical/diagnosis-validation';

const ENCRYPTED_RECORD_FIELDS = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'familyHistory',
  'treatmentPlan',
] as const;

function decryptRecord(doc: MedicalRecordDoc): MedicalRecordDoc {
  const out = { ...doc };
  for (const field of ENCRYPTED_RECORD_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = maybeDecrypt(value);
  }
  if (out.followUp?.reason) {
    out.followUp = { ...out.followUp, reason: maybeDecrypt(out.followUp.reason) };
  }
  if (out.aiEvaluation?.clinicalNotes) {
    out.aiEvaluation = { ...out.aiEvaluation, clinicalNotes: maybeDecrypt(out.aiEvaluation.clinicalNotes) };
  }
  if (out.addenda) {
    out.addenda = out.addenda.map(a => ({ ...a, text: maybeDecrypt(a.text) }));
  }
  return out;
}

function encryptRecordFields<T extends Partial<MedicalRecordDoc>>(data: T): T {
  const out = { ...data };
  for (const field of ENCRYPTED_RECORD_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) out[field] = maybeEncrypt(value);
  }
  if (out.followUp?.reason) {
    out.followUp = { ...out.followUp, reason: maybeEncrypt(out.followUp.reason) };
  }
  if (out.aiEvaluation?.clinicalNotes) {
    out.aiEvaluation = { ...out.aiEvaluation, clinicalNotes: maybeEncrypt(out.aiEvaluation.clinicalNotes) };
  }
  if (out.addenda) {
    out.addenda = out.addenda.map(a => ({ ...a, text: maybeEncrypt(a.text) }));
  }
  return out;
}

/**
 * Thrown when a caller tries to mutate the clinical content of a record that
 * has already been signed (and is therefore locked). Corrections must be made
 * with {@link addAddendum} instead, which preserves the original attestation.
 */
export class SignedRecordLockError extends Error {
  constructor(id: string) {
    super(`Medical record ${id} is signed and locked; add an addendum instead of editing.`);
    this.name = 'SignedRecordLockError';
  }
}

/**
 * Thrown when the acting user's role is not permitted to perform a signing
 * action. Enforced at the service layer (not just the UI) so the medico-legal
 * attestation rules can't be bypassed by another caller.
 */
export class SigningAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningAuthorizationError';
  }
}

/** A record is locked against in-place edits once it has been signed. */
export function isRecordLocked(rec: Pick<MedicalRecordDoc, 'documentStatus'>): boolean {
  return rec.documentStatus === 'signed' || rec.documentStatus === 'amended';
}

export interface SignerIdentity {
  userId?: string;
  userName: string;
  userRole?: string;
}

// Track per-database "we already created the patientId index" state. Mango
// `createIndex` is idempotent server-side but each call still issues a network
// round-trip — once per process per DB is enough.
const indexed = new Set<string>();

async function ensurePatientIdIndex(db: PouchDB.Database): Promise<void> {
  const dbName = (db as unknown as { name?: string }).name || 'unknown';
  if (indexed.has(dbName)) return;
  try {
    // pouchdb-find is loaded by loadPouchDB() in src/lib/db.ts for both
    // browser and server runtimes, so createIndex is always available.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).createIndex({ index: { fields: ['type', 'patientId'] } });
  } catch {
    // If index creation fails (older CouchDB / view conflict), find() falls
    // back to a full scan. Cache the failure so we don't retry every call.
  }
  indexed.add(dbName);
}

export async function getRecordsByPatient(patientId: string, scope?: DataScope): Promise<MedicalRecordDoc[]> {
  const db = medicalRecordsDB();
  await ensurePatientIdIndex(db);
  // Mango query: cherry-pick only this patient's records instead of streaming
  // the entire medical_records DB (which at 1M rows is hundreds of MB).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (db as any).find({
    selector: { type: 'medical_record', patientId },
    limit: 10000,
  }) as { docs: MedicalRecordDoc[] };
  let docs = ((result.docs || []) as MedicalRecordDoc[]).map(decryptRecord);
  if (scope) docs = filterByScope(docs, scope);
  // Sort by consultedAt (full datetime) when present so records with the
  // same visitDate still order correctly. Fall back to visitDate/createdAt.
  /* istanbul ignore next -- defensive null-safety in sort fallback chain */
  docs.sort((a, b) => {
    const ak = a.consultedAt || a.visitDate || a.createdAt || '';
    const bk = b.consultedAt || b.visitDate || b.createdAt || '';
    return bk.localeCompare(ak);
  });
  return docs;
}

export async function createMedicalRecord(
  data: Omit<MedicalRecordDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<MedicalRecordDoc> {
  const errors = validateMedicalRecord(data as unknown as Record<string, unknown>);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
  const db = medicalRecordsDB();
  const now = new Date().toISOString();
  const doc: MedicalRecordDoc = encryptRecordFields(withPendingOfflineSync({
    _id: `rec-${uuidv4()}`,
    type: 'medical_record',
    ...data,
    createdAt: now,
    updatedAt: now,
  } as MedicalRecordDoc, now));
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const plaintextDoc = decryptRecord(doc);
  await logAuditSafe('CREATE_MEDICAL_RECORD', undefined, undefined, `Record ${plaintextDoc._id} for patient ${plaintextDoc.patientId}`);
  emitSyncEvent({
    resourceType: 'medical_record',
    resourceId: plaintextDoc._id,
    operation: 'create',
    resourceVersion: plaintextDoc._rev,
    orgId: plaintextDoc.orgId,
    hospitalId: plaintextDoc.hospitalId,
  });
  await raiseNotifiableDiseaseAlerts(plaintextDoc);
  return plaintextDoc;
}

/**
 * Raise a `disease_alert` for every notifiable diagnosis on a saved record
 * (KAN-31 / CRIT-10).
 *
 * Before this, a clinician could save a confirmed cholera or measles
 * consultation and nothing downstream ever learned about it — the ICD-11
 * catalogue carried a `notifiable` flag that nothing read, so surveillance and
 * the DHIS2 export both under-counted outbreaks at source.
 *
 * Best-effort by design: this runs AFTER the record is durably written, and a
 * failure here must never fail the consultation save. A lost alert is
 * recoverable from the record; a lost record is not.
 */
async function raiseNotifiableDiseaseAlerts(record: MedicalRecordDoc): Promise<void> {
  try {
    const diagnoses = (record.diagnoses ?? []) as DiagnosisLike[];
    if (diagnoses.length === 0) return;

    // Coded notifiable diagnoses, plus uncoded free-text ones that name a
    // notifiable disease — a free-text "measles" must reach surveillance too.
    const { notifiableCodes, freeTextNotifiableMatches } = validateDiagnosisCodes(diagnoses);
    const codes = [...new Set([...notifiableCodes, ...freeTextNotifiableMatches.map(m => m.code)])];
    if (codes.length === 0) return;

    const { createAlert, getAlertsBySourceRecord } = await import('./surveillance-service');

    // One case per (record, code) — ever. This function also runs on record
    // updates, so a re-saved or amended consultation must not double-count.
    const alreadyRaised = new Set(
      (await getAlertsBySourceRecord(record._id)).map(a => a.icd11Code || '')
    );

    // Geography for the state-keyed surveillance views (epidemic curves,
    // syndromic thresholds, the choropleth). The record itself carries no
    // state/county, so resolve them from the patient's registration data,
    // falling back to the reporting facility's own address.
    let state = '';
    let county = '';
    if (record.patientId) {
      try {
        const { getPatientById } = await import('./patient-service');
        const patient = await getPatientById(record.patientId);
        state = patient?.state || '';
        county = patient?.county || '';
      } catch { /* best-effort — try the facility next */ }
    }
    if (!state && record.hospitalId) {
      try {
        const { getHospitalById } = await import('./hospital-service');
        const hospital = await getHospitalById(record.hospitalId);
        state = hospital?.state || '';
        county = county || hospital?.county || '';
      } catch { /* best-effort — an alert without geography still counts nationally */ }
    }

    for (const code of codes) {
      if (alreadyRaised.has(code)) continue;
      const entry = lookupIcd11(code);
      if (!entry) continue;
      // One case per record. Aggregation into outbreak counts is the
      // surveillance layer's job — this only guarantees the case is visible.
      await createAlert({
        disease: entry.title,
        state,
        county,
        cases: 1,
        deaths: 0,
        // A single case is a signal to watch, not an outbreak declaration.
        // Escalation belongs to whoever reviews the surveillance queue.
        alertLevel: 'watch',
        reportDate: new Date().toISOString(),
        trend: 'stable',
        orgId: record.orgId,
        hospitalId: record.hospitalId,
        patientId: record.patientId,
        icd11Code: entry.code,
        sourceRecordId: record._id,
      });
      alreadyRaised.add(code);
    }
  } catch (err) {
    console.warn('[medical-record] notifiable disease alert failed (record was saved):', err);
  }
}

export async function updateMedicalRecord(id: string, data: Partial<MedicalRecordDoc>): Promise<MedicalRecordDoc | null> {
  const db = medicalRecordsDB();
  let existing: MedicalRecordDoc;
  try {
    existing = await db.get(id) as MedicalRecordDoc;
  } catch {
    return null;
  }
  // A signed document is locked: its clinical content must not change in place.
  // This guard is intentionally OUTSIDE the not-found try/catch so the lock
  // surfaces as a thrown error rather than being swallowed into a null return.
  if (isRecordLocked(existing)) {
    throw new SignedRecordLockError(id);
  }
  try {
    const updated = encryptRecordFields(withPendingOfflineSync({
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    } as MedicalRecordDoc));
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    const plaintextUpdated = decryptRecord(updated);
    await logAuditSafe('UPDATE_MEDICAL_RECORD', undefined, undefined, `Updated record ${id} for patient ${plaintextUpdated.patientId}`);
    emitSyncEvent({
      resourceType: 'medical_record',
      resourceId: plaintextUpdated._id,
      operation: 'update',
      resourceVersion: plaintextUpdated._rev,
      orgId: plaintextUpdated.orgId,
      hospitalId: plaintextUpdated.hospitalId,
    });
    // A diagnosis added after the initial save must still reach surveillance.
    // (createMedicalRecord covers the first save; the (record, code) dedupe
    // inside makes this safe to run on every update.)
    await raiseNotifiableDiseaseAlerts(plaintextUpdated);
    return plaintextUpdated;
  } catch {
    return null;
  }
}

/**
 * Sign (attest) a clinical document and lock it against further edits.
 *
 * Signing is the medico-legal act that turns a draft into a permanent record.
 * After this, {@link updateMedicalRecord} will refuse in-place edits; use
 * {@link addAddendum} for corrections. Re-signing an already-signed record is
 * rejected so a second clinician can't silently overwrite the attestation.
 *
 * Pass `awaitingCosign: true` to mark the document as signed-by-trainee and
 * pending a supervising provider's co-signature (see {@link cosignMedicalRecord}).
 */
export async function signMedicalRecord(
  id: string,
  signer: SignerIdentity,
  opts: { awaitingCosign?: boolean } = {}
): Promise<MedicalRecordDoc | null> {
  if (!isClinicalAuthorRole(signer.userRole)) {
    throw new SigningAuthorizationError(`Role "${signer.userRole ?? 'unknown'}" may not sign clinical notes.`);
  }
  const db = medicalRecordsDB();
  let existing: MedicalRecordDoc;
  try {
    existing = await db.get(id) as MedicalRecordDoc;
  } catch {
    return null;
  }
  if (existing.documentStatus === 'signed' || existing.documentStatus === 'amended') {
    throw new SignedRecordLockError(id);
  }
  const now = new Date().toISOString();
  const signed: MedicalRecordDoc = withPendingOfflineSync({
    ...existing,
    documentStatus: opts.awaitingCosign ? 'awaiting_cosign' : 'signed',
    signedBy: signer.userId,
    signedByName: signer.userName,
    signedByRole: signer.userRole,
    signedAt: now,
    syncStatus: 'pending',
    updatedAt: now,
  } as MedicalRecordDoc, now);
  const resp = await db.put(signed);
  signed._rev = resp.rev;
  const plaintextSigned = decryptRecord(signed);
  await logAuditSafe(
    opts.awaitingCosign ? 'SIGN_MEDICAL_RECORD_AWAITING_COSIGN' : 'SIGN_MEDICAL_RECORD',
    signer.userId,
    signer.userName,
    `Signed record ${id} for patient ${plaintextSigned.patientId}`,
  );
  emitSyncEvent({
    resourceType: 'medical_record',
    resourceId: plaintextSigned._id,
    operation: 'update',
    resourceVersion: plaintextSigned._rev,
    orgId: plaintextSigned.orgId,
    hospitalId: plaintextSigned.hospitalId,
  });
  return plaintextSigned;
}

/**
 * Append an immutable addendum to a signed record. The original signed content
 * is never altered; the document moves to 'amended' status and keeps every
 * addendum in chronological order.
 */
export async function addAddendum(
  id: string,
  text: string,
  author: SignerIdentity,
): Promise<MedicalRecordDoc | null> {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) {
    throw new ValidationError({ text: 'Addendum text is required' });
  }
  const db = medicalRecordsDB();
  let existing: MedicalRecordDoc;
  try {
    existing = await db.get(id) as MedicalRecordDoc;
  } catch {
    return null;
  }
  if (!isRecordLocked(existing)) {
    // Addenda only apply to a finalized (signed/amended) record. A draft is
    // edited directly; a note still awaiting co-signature must be co-signed
    // first, otherwise amending it would orphan it from the co-sign queue.
    const why = existing.documentStatus === 'awaiting_cosign'
      ? `Medical record ${id} is awaiting co-signature; it must be co-signed before an addendum can be added.`
      : `Medical record ${id} is not signed; edit the draft directly instead of adding an addendum.`;
    throw new Error(why);
  }
  const now = new Date().toISOString();
  const addendum: RecordAddendum = {
    text: trimmed,
    authorId: author.userId,
    authorName: author.userName,
    authorRole: author.userRole,
    createdAt: now,
  };
  const amended: MedicalRecordDoc = encryptRecordFields(withPendingOfflineSync({
    ...existing,
    addenda: [...(existing.addenda || []), addendum],
    documentStatus: 'amended',
    syncStatus: 'pending',
    updatedAt: now,
  } as MedicalRecordDoc, now));
  const resp = await db.put(amended);
  amended._rev = resp.rev;
  const plaintextAmended = decryptRecord(amended);
  await logAuditSafe('ADDENDUM_MEDICAL_RECORD', author.userId, author.userName, `Addendum on record ${id} for patient ${plaintextAmended.patientId}`);
  emitSyncEvent({
    resourceType: 'medical_record',
    resourceId: plaintextAmended._id,
    operation: 'update',
    resourceVersion: plaintextAmended._rev,
    orgId: plaintextAmended.orgId,
    hospitalId: plaintextAmended.hospitalId,
  });
  return plaintextAmended;
}

/**
 * Co-sign a record that a trainee signed into 'awaiting_cosign'. The
 * supervising provider reviews and attests; the document then becomes a fully
 * signed, locked record. Records not awaiting co-signature are rejected so a
 * co-signature can't be applied out of band.
 */
export async function cosignMedicalRecord(
  id: string,
  cosigner: SignerIdentity,
): Promise<MedicalRecordDoc | null> {
  if (!isProviderRole(cosigner.userRole)) {
    throw new SigningAuthorizationError(`Role "${cosigner.userRole ?? 'unknown'}" may not co-sign clinical notes.`);
  }
  const db = medicalRecordsDB();
  let existing: MedicalRecordDoc;
  try {
    existing = await db.get(id) as MedicalRecordDoc;
  } catch {
    return null;
  }
  if (existing.documentStatus !== 'awaiting_cosign') {
    throw new Error(`Medical record ${id} is not awaiting co-signature (status: ${existing.documentStatus ?? 'draft'}).`);
  }
  // A clinician cannot co-sign their own attestation — co-signature must come
  // from a different (supervising) provider.
  if (cosigner.userId && existing.signedBy && cosigner.userId === existing.signedBy) {
    throw new SigningAuthorizationError('A note must be co-signed by a different provider than the author.');
  }
  const now = new Date().toISOString();
  const cosigned: MedicalRecordDoc = withPendingOfflineSync({
    ...existing,
    documentStatus: 'signed',
    cosignedBy: cosigner.userId,
    cosignedByName: cosigner.userName,
    cosignedAt: now,
    syncStatus: 'pending',
    updatedAt: now,
  } as MedicalRecordDoc, now);
  const resp = await db.put(cosigned);
  cosigned._rev = resp.rev;
  const plaintextCosigned = decryptRecord(cosigned);
  await logAuditSafe('COSIGN_MEDICAL_RECORD', cosigner.userId, cosigner.userName, `Co-signed record ${id} for patient ${plaintextCosigned.patientId}`);
  emitSyncEvent({
    resourceType: 'medical_record',
    resourceId: plaintextCosigned._id,
    operation: 'update',
    resourceVersion: plaintextCosigned._rev,
    orgId: plaintextCosigned.orgId,
    hospitalId: plaintextCosigned.hospitalId,
  });
  return plaintextCosigned;
}

/**
 * Records that still need someone's attention in the signing workflow, for the
 * provider inbox (P1.1):
 *  - `unsignedDrafts`     : draft/legacy records with clinical content not yet signed.
 *  - `awaitingCosign`     : trainee-signed records pending a supervisor co-signature.
 * Scope-filtered like the other reads so a user only sees their facility/org.
 */
export interface SigningInbox {
  unsignedDrafts: MedicalRecordDoc[];
  awaitingCosign: MedicalRecordDoc[];
}

export async function getSigningInbox(scope?: DataScope): Promise<SigningInbox> {
  const db = medicalRecordsDB();
  let docs = (await findByType<MedicalRecordDoc>(db, 'medical_record')).map(decryptRecord);
  if (scope) docs = filterByScope(docs, scope);
  // Nursing vitals observations are standalone snapshots, not consult notes
  // that require attestation — exclude them from the "to sign" queue. Prefer the
  // structural marker; fall back to the legacy chief-complaint string for
  // records written before recordKind existed.
  const isConsultNote = (r: MedicalRecordDoc) =>
    r.recordKind !== 'nursing_vitals' && r.chiefComplaint !== 'Nursing vitals observation';
  const byNewest = (a: MedicalRecordDoc, b: MedicalRecordDoc) =>
    (b.consultedAt || b.visitDate || b.createdAt || '').localeCompare(a.consultedAt || a.visitDate || a.createdAt || '');
  const unsignedDrafts = docs
    .filter((r) => isConsultNote(r) && (r.documentStatus === undefined || r.documentStatus === 'draft'))
    .sort(byNewest);
  const awaitingCosign = docs
    .filter((r) => r.documentStatus === 'awaiting_cosign')
    .sort(byNewest);
  return { unsignedDrafts, awaitingCosign };
}

/** Fetch a single medical record by id, or null if not found. */
export async function getMedicalRecordById(id: string): Promise<MedicalRecordDoc | null> {
  try {
    return decryptRecord(await medicalRecordsDB().get(id) as MedicalRecordDoc);
  } catch {
    return null;
  }
}

export async function deleteMedicalRecord(id: string): Promise<boolean> {
  const db = medicalRecordsDB();
  try {
    const doc = await db.get(id) as MedicalRecordDoc;
    await db.remove({ _id: doc._id, _rev: doc._rev! });
    await logAuditSafe('DELETE_MEDICAL_RECORD', undefined, undefined, `Deleted record ${id} for patient ${doc.patientId}`);
    emitSyncEvent({
      resourceType: 'medical_record',
      resourceId: id,
      operation: 'delete',
      orgId: doc.orgId,
      hospitalId: doc.hospitalId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a nurse vitals observation as a real medical_record so it is
 * retrievable on the patient chart / vitals trends and syncs to CouchDB.
 *
 * Replaces the previous ward-board write to an orphan `tamamhealth_vitals` DB
 * that nothing read or synced. Reuses MedicalRecordDoc.vitalSigns — the exact
 * shape VitalsTrends and the patient record already consume.
 */
export interface NursingVitalsInput {
  patientId: string;
  patientName: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  recordedById?: string;
  recordedByName?: string;
  encounterId?: string;
  vitals: {
    systolic?: string;
    diastolic?: string;
    temperature?: string;
    pulse?: string;
    spo2?: string;
    weight?: string;
    height?: string;
    respiratoryRate?: string;
    painScore?: string;
    bloodGlucose?: string;
    gcs?: string;
    muac?: string;
    notes?: string;
  };
  /** Optional intake/output (mL) captured on ward rounds. */
  fluidBalance?: {
    oralIntakeMl?: string;
    ivIntakeMl?: string;
    urineOutputMl?: string;
    otherOutputMl?: string;
  };
}

function numOrZero(v?: string): number {
  const n = parseFloat((v ?? '').toString());
  return isNaN(n) ? 0 : n;
}

/** Parse to a number, or undefined when empty/invalid (for optional fields). */
function numOrUndef(v?: string): number | undefined {
  if (v == null || v.toString().trim() === '') return undefined;
  const n = parseFloat(v.toString());
  return isNaN(n) ? undefined : n;
}

/**
 * BMI from weight (kg) and height (cm), or 0 when either is missing.
 *
 * Returns 0 rather than undefined because `VitalSigns.bmi` is a required
 * number; unlike weight/height it is not range-validated, so the placeholder
 * cannot fail a write.
 */
function bmiFrom(weightKg?: number, heightCm?: number): number {
  if (!weightKg || !heightCm) return 0;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export async function recordNursingVitals(input: NursingVitalsInput): Promise<MedicalRecordDoc> {
  const now = new Date().toISOString();
  const record = {
    patientId: input.patientId,
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName || '',
    orgId: input.orgId,
    encounterId: input.encounterId,
    visitDate: now,
    consultedAt: now,
    visitType: 'inpatient' as const,
    providerName: input.recordedByName || 'Nurse',
    providerRole: 'nurse',
    department: 'Nursing',
    // Min 3 chars required by validateMedicalRecord; identifies this as a
    // standalone nursing observation rather than a full consultation.
    chiefComplaint: 'Nursing vitals observation',
    recordKind: 'nursing_vitals' as const,
    historyOfPresentIllness: input.vitals.notes?.trim() || '',
    vitalSigns: {
      temperature: numOrUndef(input.vitals.temperature),
      systolic: numOrUndef(input.vitals.systolic),
      diastolic: numOrUndef(input.vitals.diastolic),
      pulse: numOrUndef(input.vitals.pulse),
      // Absent measurements are left UNDEFINED, not zeroed.
      //
      // `validateMedicalRecord` skips undefined/empty but range-checks 0, and
      // 0 kg / 0 cm / 0 breaths-per-minute are outside every bound — so
      // hardcoding `height: 0` made EVERY call to this function throw
      // ValidationError, which silently killed nursing vitals capture
      // entirely. Zero is an absence marker here, never an observation.
      respiratoryRate: numOrUndef(input.vitals.respiratoryRate),
      oxygenSaturation: numOrUndef(input.vitals.spo2),
      weight: numOrUndef(input.vitals.weight),
      height: numOrUndef(input.vitals.height),
      // Derived when both measurements are present. `bmi` is not range-checked
      // by the validator, so 0 here is inert rather than fatal — but a real
      // value is better than a placeholder the chart would plot as a data
      // point.
      bmi: bmiFrom(numOrUndef(input.vitals.weight), numOrUndef(input.vitals.height)),
      muac: numOrUndef(input.vitals.muac),
      painScore: numOrUndef(input.vitals.painScore),
      bloodGlucose: numOrUndef(input.vitals.bloodGlucose),
      gcs: numOrUndef(input.vitals.gcs),
      recordedAt: now,
    },
    fluidBalance: input.fluidBalance ? {
      oralIntakeMl: numOrUndef(input.fluidBalance.oralIntakeMl),
      ivIntakeMl: numOrUndef(input.fluidBalance.ivIntakeMl),
      urineOutputMl: numOrUndef(input.fluidBalance.urineOutputMl),
      otherOutputMl: numOrUndef(input.fluidBalance.otherOutputMl),
    } : undefined,
    diagnoses: [],
    prescriptions: [],
    labResults: [],
    treatmentPlan: '',
    syncStatus: 'pending' as const,
  } as Omit<MedicalRecordDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

  return createMedicalRecord(record);
}

export async function getRecentRecords(limit: number = 20, scope?: DataScope): Promise<MedicalRecordDoc[]> {
  const db = medicalRecordsDB();
  let docs = await findByType<MedicalRecordDoc>(db, 'medical_record');
  if (scope) docs = filterByScope(docs, scope);
  return docs
    .sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''))
    .slice(0, limit);
}
