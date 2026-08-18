/**
 * SQLite database layer for the TamamHealth Patient app.
 *
 * Provides persistent local storage that survives app restarts.
 * All patient data lives here; the sync engine pushes/pulls
 * changes to/from the platform API when connectivity is available.
 *
 * On web, expo-sqlite is not available so we fall back to in-memory
 * seed data (same behavior as the original mock API).
 */

import { Platform } from 'react-native';
import type {
  MedicalRecord, LabResult, Prescription, Appointment,
  Immunization, Message, Payment, Charge, BillingSummary,
} from './types';
import {
  medicalRecords as seedRecords,
  labResults as seedLabs,
  prescriptions as seedRx,
  appointments as seedApts,
  immunizations as seedImms,
  messages as seedMsgs,
  payments as seedPays,
  charges as seedCharges,
} from './data';

// ---------------------------------------------------------------------------
// Platform detection — expo-sqlite only works on native
// ---------------------------------------------------------------------------

const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

// Lazy-load expo-sqlite only on native to avoid web crash
let SQLite: typeof import('expo-sqlite') | null = null;
if (IS_NATIVE) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchronous native-only load prevents expo-sqlite from entering the web bundle
  SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
}

/** Tables that may be referenced by name in dynamic queries. */
const VALID_TABLES = new Set([
  'medical_records', 'lab_results', 'prescriptions', 'appointments',
  'immunizations', 'messages', 'payments', 'charges',
]);

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'tamamhealth_patient.db';
let _db: any = null;

/**
 * Demo seed gate. We only seed the local SQLite cache with the example
 * `pat-00001` Deng Mabior records when EXPO_PUBLIC_DEMO_MODE is anything
 * other than 'false'. In production the seed is suppressed so a freshly
 * installed app starts empty and waits for a real sync from the platform —
 * no patient ever sees somebody else's records by default.
 */
const SEED_DEMO_DATA = process.env.EXPO_PUBLIC_DEMO_MODE !== 'false';

export async function getDatabase(): Promise<any> {
  if (!IS_NATIVE || !SQLite) return null; // web fallback
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync('PRAGMA journal_mode = WAL;');
  await _db.execAsync('PRAGMA foreign_keys = ON;');
  await createTables(_db);
  if (SEED_DEMO_DATA) {
    await seedIfEmpty(_db);
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

async function createTables(db: any) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS medical_records (
      _id            TEXT PRIMARY KEY,
      patient_id     TEXT NOT NULL,
      visit_type     TEXT NOT NULL,
      chief_complaint TEXT NOT NULL,
      diagnoses      TEXT NOT NULL DEFAULT '[]',
      vital_signs    TEXT,
      consulted_by   TEXT,
      facility_name  TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lab_results (
      _id            TEXT PRIMARY KEY,
      patient_id     TEXT NOT NULL,
      test_name      TEXT NOT NULL,
      specimen       TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      result         TEXT NOT NULL DEFAULT '',
      unit           TEXT NOT NULL DEFAULT '',
      reference_range TEXT NOT NULL DEFAULT '',
      abnormal       INTEGER NOT NULL DEFAULT 0,
      critical       INTEGER NOT NULL DEFAULT 0,
      ordered_at     TEXT NOT NULL,
      completed_at   TEXT NOT NULL DEFAULT '',
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      _id            TEXT PRIMARY KEY,
      patient_id     TEXT NOT NULL,
      medication     TEXT NOT NULL,
      dose           TEXT NOT NULL,
      route          TEXT NOT NULL,
      frequency      TEXT NOT NULL,
      duration       TEXT NOT NULL,
      prescribed_by  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      dispensed_at   TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS appointments (
      _id              TEXT PRIMARY KEY,
      patient_id       TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      appointment_type TEXT NOT NULL,
      reason           TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'scheduled',
      provider_name    TEXT,
      facility_name    TEXT,
      department       TEXT,
      duration         INTEGER,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced           INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS immunizations (
      _id            TEXT PRIMARY KEY,
      patient_id     TEXT NOT NULL,
      vaccine        TEXT NOT NULL,
      dose_number    INTEGER NOT NULL DEFAULT 1,
      date_given     TEXT NOT NULL,
      next_due_date  TEXT,
      status         TEXT NOT NULL DEFAULT 'completed',
      site           TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      synced         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      _id              TEXT PRIMARY KEY,
      patient_id       TEXT NOT NULL,
      from_doctor_name TEXT NOT NULL,
      from_hospital    TEXT NOT NULL,
      subject          TEXT NOT NULL,
      body             TEXT NOT NULL,
      sent_at          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'sent',
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      synced           INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      _id          TEXT PRIMARY KEY,
      patient_id   TEXT NOT NULL DEFAULT '',
      amount       REAL NOT NULL,
      method       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      processed_at TEXT NOT NULL,
      reference    TEXT,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      synced       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS charges (
      _id          TEXT PRIMARY KEY,
      patient_id   TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL,
      billed_amount REAL NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      service_date TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      synced       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name   TEXT NOT NULL,
      record_id    TEXT NOT NULL,
      action       TEXT NOT NULL CHECK(action IN ('create','update','delete')),
      payload      TEXT NOT NULL DEFAULT '{}',
      attempts     INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_error   TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes for query performance
    CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id);
    CREATE INDEX IF NOT EXISTS idx_medical_records_created ON medical_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_patient ON lab_results(patient_id);
    CREATE INDEX IF NOT EXISTS idx_lab_results_ordered ON lab_results(ordered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_immunizations_patient ON immunizations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_messages_patient ON messages(patient_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_charges_patient ON charges(patient_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(attempts, created_at);
  `);
}

// ---------------------------------------------------------------------------
// Seed — only runs once (on first install / after wipe)
// ---------------------------------------------------------------------------

async function seedIfEmpty(db: any) {
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) as cnt FROM medical_records'
  );
  // row.cnt is a number — if any records exist, skip seeding
  if (row != null && Number(row.cnt) > 0) return;

  // Medical records
  for (const r of seedRecords) {
    await db.runAsync(
      `INSERT OR IGNORE INTO medical_records (_id, patient_id, visit_type, chief_complaint, diagnoses, vital_signs, consulted_by, facility_name, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      r._id, r.patientId, r.visitType, r.chiefComplaint,
      JSON.stringify(r.diagnoses), r.vitalSigns ? JSON.stringify(r.vitalSigns) : null,
      r.consultedByName ?? null, r.facilityName ?? null, r.createdAt
    );
  }

  // Lab results
  for (const l of seedLabs) {
    await db.runAsync(
      `INSERT OR IGNORE INTO lab_results (_id, patient_id, test_name, specimen, status, result, unit, reference_range, abnormal, critical, ordered_at, completed_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      l._id, l.patientId, l.testName, l.specimen, l.status,
      l.result, l.unit, l.referenceRange, l.abnormal ? 1 : 0, l.critical ? 1 : 0,
      l.orderedAt, l.completedAt
    );
  }

  // Prescriptions
  for (const p of seedRx) {
    await db.runAsync(
      `INSERT OR IGNORE INTO prescriptions (_id, patient_id, medication, dose, route, frequency, duration, prescribed_by, status, dispensed_at, created_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      p._id, p.patientId, p.medication, p.dose, p.route, p.frequency,
      p.duration, p.prescribedBy, p.status, p.dispensedAt ?? null, p.createdAt
    );
  }

  // Appointments
  for (const a of seedApts) {
    await db.runAsync(
      `INSERT OR IGNORE INTO appointments (_id, patient_id, appointment_date, appointment_time, appointment_type, reason, status, provider_name, facility_name, department, duration, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      a._id, a.patientId, a.appointmentDate, a.appointmentTime,
      a.appointmentType, a.reason, a.status,
      a.providerName ?? null, a.facilityName ?? null, a.department ?? null, a.duration ?? null
    );
  }

  // Immunizations
  for (const i of seedImms) {
    await db.runAsync(
      `INSERT OR IGNORE INTO immunizations (_id, patient_id, vaccine, dose_number, date_given, next_due_date, status, site, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      i._id, i.patientId, i.vaccine, i.doseNumber,
      i.dateGiven, i.nextDueDate ?? null, i.status, i.site ?? null
    );
  }

  // Messages
  for (const m of seedMsgs) {
    await db.runAsync(
      `INSERT OR IGNORE INTO messages (_id, patient_id, from_doctor_name, from_hospital, subject, body, sent_at, status, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      m._id, m.patientId, m.fromDoctorName, m.fromHospitalName,
      m.subject, m.body, m.sentAt, m.status
    );
  }

  // Payments
  for (const p of seedPays) {
    await db.runAsync(
      `INSERT OR IGNORE INTO payments (_id, patient_id, amount, method, status, processed_at, reference, synced)
       VALUES (?, 'pat-00001', ?, ?, ?, ?, ?, 1)`,
      p._id, p.amount, p.method, p.status, p.processedAt, p.reference ?? null
    );
  }

  // Charges
  for (const c of seedCharges) {
    await db.runAsync(
      `INSERT OR IGNORE INTO charges (_id, patient_id, description, billed_amount, status, service_date, synced)
       VALUES (?, 'pat-00001', ?, ?, ?, ?, 1)`,
      c._id, c.description, c.billedAmount, c.status, c.serviceDate
    );
  }

  // Mark seeded
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('seeded_at', ?)`,
    new Date().toISOString()
  );
}

// ---------------------------------------------------------------------------
// Row → Type mappers
// ---------------------------------------------------------------------------

function rowToMedicalRecord(r: any): MedicalRecord {
  return {
    _id: r._id,
    patientId: r.patient_id,
    visitType: r.visit_type,
    chiefComplaint: r.chief_complaint,
    diagnoses: JSON.parse(r.diagnoses || '[]'),
    vitalSigns: r.vital_signs ? JSON.parse(r.vital_signs) : undefined,
    consultedByName: r.consulted_by ?? undefined,
    facilityName: r.facility_name ?? undefined,
    createdAt: r.created_at,
  };
}

function rowToLabResult(r: any): LabResult {
  return {
    _id: r._id,
    patientId: r.patient_id,
    testName: r.test_name,
    specimen: r.specimen,
    status: r.status,
    result: r.result,
    unit: r.unit,
    referenceRange: r.reference_range,
    abnormal: !!r.abnormal,
    critical: !!r.critical,
    orderedAt: r.ordered_at,
    completedAt: r.completed_at,
  };
}

function rowToPrescription(r: any): Prescription {
  return {
    _id: r._id,
    patientId: r.patient_id,
    medication: r.medication,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    duration: r.duration,
    prescribedBy: r.prescribed_by,
    status: r.status,
    dispensedAt: r.dispensed_at ?? undefined,
    createdAt: r.created_at,
  };
}

function rowToAppointment(r: any): Appointment {
  return {
    _id: r._id,
    patientId: r.patient_id,
    appointmentDate: r.appointment_date,
    appointmentTime: r.appointment_time,
    appointmentType: r.appointment_type,
    reason: r.reason,
    status: r.status,
    providerName: r.provider_name ?? undefined,
    facilityName: r.facility_name ?? undefined,
    department: r.department ?? undefined,
    duration: r.duration ?? undefined,
  };
}

function rowToImmunization(r: any): Immunization {
  return {
    _id: r._id,
    patientId: r.patient_id,
    vaccine: r.vaccine,
    doseNumber: r.dose_number,
    dateGiven: r.date_given,
    nextDueDate: r.next_due_date ?? undefined,
    status: r.status,
    site: r.site ?? undefined,
  };
}

function rowToMessage(r: any): Message {
  return {
    _id: r._id,
    patientId: r.patient_id,
    fromDoctorName: r.from_doctor_name,
    fromHospitalName: r.from_hospital,
    subject: r.subject,
    body: r.body,
    sentAt: r.sent_at,
    status: r.status,
  };
}

function rowToPayment(r: any): Payment {
  return {
    _id: r._id,
    amount: r.amount,
    method: r.method,
    status: r.status,
    processedAt: r.processed_at,
    reference: r.reference ?? undefined,
  };
}

function rowToCharge(r: any): Charge {
  return {
    _id: r._id,
    description: r.description,
    billedAmount: r.billed_amount,
    status: r.status,
    serviceDate: r.service_date,
  };
}

// ---------------------------------------------------------------------------
// READ operations — fall back to seed data on web
// ---------------------------------------------------------------------------

export async function getMedicalRecords(): Promise<MedicalRecord[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedRecords : [];
  const rows = await db.getAllAsync('SELECT * FROM medical_records ORDER BY created_at DESC');
  return rows.map(rowToMedicalRecord);
}

export async function getLabResults(): Promise<LabResult[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedLabs : [];
  const rows = await db.getAllAsync('SELECT * FROM lab_results ORDER BY ordered_at DESC');
  return rows.map(rowToLabResult);
}

export async function getPrescriptions(): Promise<Prescription[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedRx : [];
  const rows = await db.getAllAsync('SELECT * FROM prescriptions ORDER BY created_at DESC');
  return rows.map(rowToPrescription);
}

export async function getAppointments(): Promise<Appointment[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedApts : [];
  const rows = await db.getAllAsync('SELECT * FROM appointments ORDER BY appointment_date DESC');
  return rows.map(rowToAppointment);
}

export async function getImmunizations(): Promise<Immunization[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedImms : [];
  const rows = await db.getAllAsync('SELECT * FROM immunizations ORDER BY date_given DESC');
  return rows.map(rowToImmunization);
}

export async function getMessages(): Promise<Message[]> {
  const db = await getDatabase();
  if (!db) return SEED_DEMO_DATA ? seedMsgs : [];
  const rows = await db.getAllAsync('SELECT * FROM messages ORDER BY sent_at DESC');
  return rows.map(rowToMessage);
}

export async function getBilling(): Promise<BillingSummary> {
  const db = await getDatabase();
  const pays: Payment[] = db
    ? (await db.getAllAsync('SELECT * FROM payments ORDER BY processed_at DESC')).map(rowToPayment)
    : (SEED_DEMO_DATA ? seedPays : []);
  const chgs: Charge[] = db
    ? (await db.getAllAsync('SELECT * FROM charges ORDER BY service_date DESC')).map(rowToCharge)
    : (SEED_DEMO_DATA ? seedCharges : []);

  const totalBilled = chgs.reduce((s: number, c: Charge) => s + c.billedAmount, 0);
  const totalPaid = pays.reduce((s: number, p: Payment) => s + p.amount, 0);

  return {
    payments: pays,
    charges: chgs,
    plans: [],
    claims: [],
    policies: [],
    summary: { totalBilled, totalPaid, insurancePaid: 0, outstanding: totalBilled - totalPaid },
    balance: totalBilled - totalPaid,
    ledger: [],
  };
}

// ---------------------------------------------------------------------------
// WRITE operations (also enqueue for sync)
// ---------------------------------------------------------------------------

export async function insertAppointment(apt: Appointment): Promise<void> {
  const db = await getDatabase();
  if (!db) return; // web fallback — data stays in memory only
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO appointments (_id, patient_id, appointment_date, appointment_time, appointment_type, reason, status, provider_name, facility_name, department, duration, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    apt._id, apt.patientId, apt.appointmentDate, apt.appointmentTime,
    apt.appointmentType, apt.reason, apt.status,
    apt.providerName ?? null, apt.facilityName ?? null, apt.department ?? null, apt.duration ?? null, now
  );
  await enqueueSync(db, 'appointments', apt._id, 'create', apt);
}

export async function insertPayment(pay: Payment & { patientId?: string }): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO payments (_id, patient_id, amount, method, status, processed_at, reference, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    pay._id, pay.patientId ?? '', pay.amount, pay.method, pay.status, pay.processedAt, pay.reference ?? null, now
  );
  await enqueueSync(db, 'payments', pay._id, 'create', pay);
}

export async function insertMessage(msg: Message): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO messages (_id, patient_id, from_doctor_name, from_hospital, subject, body, sent_at, status, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    msg._id, msg.patientId, msg.fromDoctorName, msg.fromHospitalName,
    msg.subject, msg.body, msg.sentAt, msg.status, now
  );
  await enqueueSync(db, 'messages', msg._id, 'create', msg);
}

// ---------------------------------------------------------------------------
// Upsert from server (used by sync engine to merge remote data)
// ---------------------------------------------------------------------------

export async function upsertMedicalRecords(records: MedicalRecord[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const r of records) {
    const result = await db.runAsync(
      `INSERT INTO medical_records (_id, patient_id, visit_type, chief_complaint, diagnoses, vital_signs, consulted_by, facility_name, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         visit_type = excluded.visit_type,
         chief_complaint = excluded.chief_complaint,
         diagnoses = excluded.diagnoses,
         vital_signs = excluded.vital_signs,
         consulted_by = excluded.consulted_by,
         facility_name = excluded.facility_name,
         created_at = excluded.created_at,
         updated_at = datetime('now'),
         synced = 1`,
      r._id, r.patientId, r.visitType, r.chiefComplaint,
      JSON.stringify(r.diagnoses), r.vitalSigns ? JSON.stringify(r.vitalSigns) : null,
      r.consultedByName ?? null, r.facilityName ?? null, r.createdAt
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertLabResults(results: LabResult[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const l of results) {
    const result = await db.runAsync(
      `INSERT INTO lab_results (_id, patient_id, test_name, specimen, status, result, unit, reference_range, abnormal, critical, ordered_at, completed_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         test_name = excluded.test_name, specimen = excluded.specimen,
         status = excluded.status, result = excluded.result,
         unit = excluded.unit, reference_range = excluded.reference_range,
         abnormal = excluded.abnormal, critical = excluded.critical,
         ordered_at = excluded.ordered_at, completed_at = excluded.completed_at,
         updated_at = datetime('now'), synced = 1`,
      l._id, l.patientId, l.testName, l.specimen, l.status,
      l.result, l.unit, l.referenceRange, l.abnormal ? 1 : 0, l.critical ? 1 : 0,
      l.orderedAt, l.completedAt
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertPrescriptions(prescriptions: Prescription[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const p of prescriptions) {
    const result = await db.runAsync(
      `INSERT INTO prescriptions (_id, patient_id, medication, dose, route, frequency, duration, prescribed_by, status, dispensed_at, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         medication = excluded.medication, dose = excluded.dose,
         route = excluded.route, frequency = excluded.frequency,
         duration = excluded.duration, prescribed_by = excluded.prescribed_by,
         status = excluded.status, dispensed_at = excluded.dispensed_at,
         updated_at = datetime('now'), synced = 1`,
      p._id, p.patientId, p.medication, p.dose, p.route, p.frequency,
      p.duration, p.prescribedBy, p.status, p.dispensedAt ?? null, p.createdAt
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertAppointments(appointments: Appointment[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const a of appointments) {
    // Skip locally-created unsynced records to avoid overwriting user intent
    const local = await db.getFirstAsync(
      'SELECT synced FROM appointments WHERE _id = ?', a._id
    );
    if (local && local.synced === 0) continue;

    const result = await db.runAsync(
      `INSERT INTO appointments (_id, patient_id, appointment_date, appointment_time, appointment_type, reason, status, provider_name, facility_name, department, duration, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         appointment_date = excluded.appointment_date, appointment_time = excluded.appointment_time,
         appointment_type = excluded.appointment_type, reason = excluded.reason,
         status = excluded.status, provider_name = excluded.provider_name,
         facility_name = excluded.facility_name, department = excluded.department,
         duration = excluded.duration, updated_at = datetime('now'), synced = 1`,
      a._id, a.patientId, a.appointmentDate, a.appointmentTime,
      a.appointmentType, a.reason, a.status,
      a.providerName ?? null, a.facilityName ?? null, a.department ?? null, a.duration ?? null
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertImmunizations(immunizations: Immunization[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const i of immunizations) {
    const result = await db.runAsync(
      `INSERT INTO immunizations (_id, patient_id, vaccine, dose_number, date_given, next_due_date, status, site, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         vaccine = excluded.vaccine, dose_number = excluded.dose_number,
         date_given = excluded.date_given, next_due_date = excluded.next_due_date,
         status = excluded.status, site = excluded.site,
         updated_at = datetime('now'), synced = 1`,
      i._id, i.patientId, i.vaccine, i.doseNumber,
      i.dateGiven, i.nextDueDate ?? null, i.status, i.site ?? null
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertMessages(messages: Message[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const m of messages) {
    const local = await db.getFirstAsync(
      'SELECT synced FROM messages WHERE _id = ?', m._id
    );
    if (local && local.synced === 0) continue;

    const result = await db.runAsync(
      `INSERT INTO messages (_id, patient_id, from_doctor_name, from_hospital, subject, body, sent_at, status, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         from_doctor_name = excluded.from_doctor_name, from_hospital = excluded.from_hospital,
         subject = excluded.subject, body = excluded.body,
         sent_at = excluded.sent_at, status = excluded.status,
         updated_at = datetime('now'), synced = 1`,
      m._id, m.patientId, m.fromDoctorName, m.fromHospitalName,
      m.subject, m.body, m.sentAt, m.status
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertPayments(payments: (Payment & { patientId?: string })[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const p of payments) {
    const local = await db.getFirstAsync(
      'SELECT synced FROM payments WHERE _id = ?', p._id
    );
    if (local && local.synced === 0) continue;

    const result = await db.runAsync(
      `INSERT INTO payments (_id, patient_id, amount, method, status, processed_at, reference, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         patient_id = excluded.patient_id, amount = excluded.amount, method = excluded.method,
         status = excluded.status, processed_at = excluded.processed_at,
         reference = excluded.reference, updated_at = datetime('now'), synced = 1`,
      p._id, p.patientId ?? '', p.amount, p.method, p.status, p.processedAt, p.reference ?? null
    );
    if (result.changes > 0) count++;
  }
  return count;
}

export async function upsertCharges(charges: (Charge & { patientId?: string })[]): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  let count = 0;
  for (const c of charges) {
    const result = await db.runAsync(
      `INSERT INTO charges (_id, patient_id, description, billed_amount, status, service_date, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(_id) DO UPDATE SET
         patient_id = excluded.patient_id, description = excluded.description,
         billed_amount = excluded.billed_amount, status = excluded.status,
         service_date = excluded.service_date, updated_at = datetime('now'), synced = 1`,
      c._id, c.patientId ?? '', c.description, c.billedAmount, c.status, c.serviceDate
    );
    if (result.changes > 0) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Sync queue helpers
// ---------------------------------------------------------------------------

async function enqueueSync(
  db: any,
  tableName: string,
  recordId: string,
  action: 'create' | 'update' | 'delete',
  payload: unknown
): Promise<void> {
  if (!db) return;
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, action, payload)
     VALUES (?, ?, ?, ?)`,
    tableName, recordId, action, JSON.stringify(payload)
  );
}

export type SyncQueueItem = {
  id: number;
  tableName: string;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastError: string | null;
};

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync(
    'SELECT * FROM sync_queue WHERE attempts < max_attempts ORDER BY created_at ASC'
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    tableName: r.table_name,
    recordId: r.record_id,
    action: r.action,
    payload: JSON.parse(r.payload || '{}'),
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    createdAt: r.created_at,
    lastError: r.last_error,
  }));
}

export async function markSyncItemDone(id: number): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?', id);
}

export async function markSyncItemFailed(id: number, error: string): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync(
    'UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    error, id
  );
}

export async function markRecordSynced(tableName: string, recordId: string): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  if (!VALID_TABLES.has(tableName)) {
    throw new Error(`markRecordSynced: invalid table name "${tableName}"`);
  }
  await db.runAsync(
    `UPDATE ${tableName} SET synced = 1 WHERE _id = ?`,
    recordId
  );
}

export async function getSyncQueueCount(): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  const row = await db.getFirstAsync(
    'SELECT COUNT(*) as cnt FROM sync_queue WHERE attempts < max_attempts'
  );
  return row?.cnt ?? 0;
}

export async function getLastSyncTime(): Promise<string | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync(
    "SELECT value FROM sync_metadata WHERE key = 'last_sync'"
  );
  return row?.value ?? null;
}

export async function setLastSyncTime(time: string): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_sync', ?)",
    time
  );
}
