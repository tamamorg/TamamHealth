/**
 * Demo-mode fallback data for the patient-portal API routes.
 *
 * Every other part of this app has an offline-first escape hatch: the
 * browser seeds its own local PouchDB (see `db-seed.ts`) so staff can log in
 * and explore the demo with zero backing infrastructure. The patient-portal
 * API routes (`/api/patient-portal/*`) don't have that — they're plain
 * Next.js server routes that talk directly to a CouchDB cluster (`lib/db.ts`),
 * and there's no equivalent fallback when that cluster isn't reachable
 * (e.g. a local dev checkout with no CouchDB running).
 *
 * Rather than standing up real infrastructure just to demo the portal, this
 * module gives each route a way to answer from the SAME literal seed data
 * already used for the client-side demo (`db-seed.ts`'s hand-authored arrays
 * plus `data/mock.ts`'s deterministic patient roster), filtered to the
 * requesting patient. It's only ever consulted after a real database call
 * has already failed, and only when demo mode is enabled — a working
 * CouchDB always wins.
 */

import type {
  PatientDoc, AppointmentDoc, LabResultDoc, MedicalRecordDoc,
  PrescriptionDoc, ImmunizationDoc, MessageDoc,
} from './db-types';
import type {
  ChargeDoc, PaymentDoc, PaymentPlanDoc, ClaimDoc, InsurancePolicyDoc,
  LedgerEntryDoc, PatientFinancialSummary,
} from './db-types-payments';
import type { BillingDoc } from './db-types-billing';

export function demoFallbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

// Throttled, one-line log for the "CouchDB not reachable → serve demo data"
// fallback. The routes hit this on every request when no CouchDB is running
// (e.g. local dev), so logging the full error + stack each time floods the
// console. Emit one concise line per route per minute instead.
const fallbackLoggedAt: Record<string, number> = {};
export function logDemoFallback(route: string, err: unknown): void {
  const now = Date.now();
  if (fallbackLoggedAt[route] && now - fallbackLoggedAt[route] < 60_000) return;
  fallbackLoggedAt[route] = now;
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[patient-portal/${route}] CouchDB unreachable — serving demo data (${msg})`);
}

// In-memory store for anything the patient submits (appointment requests,
// messages). Lives for the lifetime of the server process — long enough for
// a demo session, gone on restart. Real writes to a configured CouchDB are
// never routed through here; this only backstops the case where there's no
// database to write to at all.
const demoAppointmentWrites: AppointmentDoc[] = [];
const demoMessageWrites: MessageDoc[] = [];

export function recordDemoAppointment(doc: AppointmentDoc): void {
  demoAppointmentWrites.push(doc);
}

export function recordDemoMessage(doc: MessageDoc): void {
  demoMessageWrites.push(doc);
}

/**
 * Mirrors `/api/patient-portal/login`'s own matching rule, but against the
 * deterministic demo roster (`data/mock.ts`'s `patients`) instead of a live
 * CouchDB query. Only one patient in that roster (`pat-00004`, Mary Lado)
 * carries `portalUsername`/`portalPasswordHash` — she's the sole
 * patient-portal login account.
 *
 * Returns the full doc (including `portalPasswordHash`) so the login route
 * can verify the password — the route strips it before responding.
 */
export async function findDemoPatientByUsername(username: string): Promise<PatientDoc | null> {
  const { patients } = await import('@/data/mock');
  const wanted = username.trim().toLowerCase();
  const match = patients.find(p => p.portalUsername?.trim().toLowerCase() === wanted);
  return match ? await toPatientDoc(match) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function toPatientDoc(p: any): Promise<PatientDoc> {
  // The core generated roster (data/mock.ts) only stores the hospital *id*
  // on `registrationHospital` — the hand-authored db-seed.ts patients also
  // carry a `registrationHospitalName` for display, which the portal UI
  // reads directly. Backfill it here so both patient sources look the same
  // to the frontend.
  let registrationHospitalName: string | undefined = p.registrationHospitalName;
  if (!registrationHospitalName && p.registrationHospital) {
    const { hospitals } = await import('@/data/mock');
    registrationHospitalName = hospitals.find(h => h.id === p.registrationHospital)?.name;
  }
  return { ...p, _id: p.id, type: 'patient', registrationHospitalName } as PatientDoc;
}

export async function getDemoAppointmentsByPatient(patientId: string): Promise<AppointmentDoc[]> {
  const { seedAppointments } = await import('./db-seed');
  const seeded = (seedAppointments as AppointmentDoc[]).filter(a => a.patientId === patientId);
  const written = demoAppointmentWrites.filter(a => a.patientId === patientId);
  return [...seeded, ...written];
}

export async function getDemoLabResultsByPatient(patientId: string): Promise<LabResultDoc[]> {
  const { labOrders } = await import('./db-seed');
  return (labOrders as LabResultDoc[]).filter(l => l.patientId === patientId);
}

export async function getDemoPrescriptionsByPatient(patientId: string): Promise<PrescriptionDoc[]> {
  const { prescriptionQueue } = await import('./db-seed');
  return (prescriptionQueue as PrescriptionDoc[]).filter(rx => rx.patientId === patientId);
}

export async function getDemoImmunizationsByPatient(patientId: string): Promise<ImmunizationDoc[]> {
  const { seedImmunizations } = await import('./db-seed');
  return (seedImmunizations as ImmunizationDoc[]).filter(i => i.patientId === patientId);
}

export async function getDemoMessagesByPatient(patientId: string): Promise<MessageDoc[]> {
  const { seedMessages } = await import('./db-seed');
  const seeded = (seedMessages as MessageDoc[]).filter(m => m.patientId === patientId);
  const written = demoMessageWrites.filter(m => m.patientId === patientId);
  return [...seeded, ...written].sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''));
}

export async function getDemoRecordsByPatient(patientId: string): Promise<MedicalRecordDoc[]> {
  const { generateMedicalRecords } = await import('@/data/mock');
  const generated = generateMedicalRecords(patientId, 6);
  return generated.map(r => {
     
    const { id, ...rest } = r;
    // The mock generator only produces `visitDate`/`consultedAt` — real
    // MedicalRecordDocs always carry `createdAt`/`updatedAt` too, and the
    // portal's Records tab sorts on `createdAt` unconditionally.
    const timestamp = r.consultedAt || `${r.visitDate}T00:00:00.000Z`;
    return { ...rest, _id: id, type: 'medical_record', createdAt: timestamp, updatedAt: timestamp } as MedicalRecordDoc;
  });
}

export interface DemoBillingBundle {
  payments: PaymentDoc[];
  charges: ChargeDoc[];
  plans: PaymentPlanDoc[];
  claims: ClaimDoc[];
  policies: InsurancePolicyDoc[];
  summary: PatientFinancialSummary;
  balance: number;
  ledger: LedgerEntryDoc[];
  bills: BillingDoc[];
}

export async function getDemoBillingByPatient(patientId: string): Promise<DemoBillingBundle> {
  const { seedCharges, seedPayments, seedPaymentPlans, seedClaims, seedInsurancePolicies, seedLedgerEntries } = await import('./db-seed');
  const charges = (seedCharges as ChargeDoc[]).filter(c => c.patientId === patientId);
  const payments = (seedPayments as PaymentDoc[]).filter(p => p.patientId === patientId)
    .sort((a, b) => (b.processedAt || b.createdAt || '').localeCompare(a.processedAt || a.createdAt || ''));
  const plans = (seedPaymentPlans as PaymentPlanDoc[]).filter(p => p.patientId === patientId);
  const claims = (seedClaims as ClaimDoc[]).filter(c => c.patientId === patientId);
  const policies = (seedInsurancePolicies as InsurancePolicyDoc[]).filter(i => i.patientId === patientId);
  const ledger = (seedLedgerEntries as LedgerEntryDoc[]).filter(l => l.patientId === patientId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const balance = ledger.length > 0 ? ledger[0].runningBalance : 0;
  const activePlans = plans.filter(p => p.status === 'active');
  const lastPayment = payments[0];

  const summary: PatientFinancialSummary = {
    patientId,
    totalBalance: Math.max(0, balance),
    totalInCollections: 0,
    currentBalance: Math.max(0, balance),
    overdueBalance: 0,
    activePlanBalance: activePlans.reduce((s, p) => s + p.remainingBalance, 0),
    insurancePolicies: policies,
    primaryPolicy: policies.find(p => p.isPrimary) || policies[0],
    eligibilityStatus: 'none',
    lastPaymentDate: lastPayment?.processedAt,
    lastPaymentAmount: lastPayment?.amount,
    savedPaymentMethods: [],
    collectionStage: 'current',
  };

  // No standalone `billing` (invoice) docs exist in the seed data for any
  // patient — real invoices live in the charges/ledger flow above. Returning
  // an empty list here is accurate, not a gap: the portal's Billing tab
  // already has an honest "no bills on file" empty state for this case.
  return { payments, charges, plans, claims, policies, summary, balance, ledger, bills: [] };
}
