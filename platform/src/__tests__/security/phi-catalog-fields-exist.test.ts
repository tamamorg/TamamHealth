/**
 * Every field the PHI catalog seals must exist on the document type it names.
 *
 * A path that names nothing seals nothing and looks protected: provider_review
 * listed `comment` / `comments` while the stored field is `body`, so review
 * text sat in plaintext behind a catalog entry that said otherwise.
 *
 * The check reads the document interfaces in db-types*.ts: the interface whose
 * `type` discriminant is the catalog key must declare the first segment of
 * every path (directly or through `extends`).
 */
import fs from 'node:fs';
import path from 'node:path';
import catalog from '@/lib/phi-field-catalog.json';

const LIB = path.resolve(__dirname, '../../lib');
const sources = fs.readdirSync(LIB)
  .filter(name => /^db-types.*\.ts$/.test(name))
  .map(name => fs.readFileSync(path.join(LIB, name), 'utf8'))
  .concat(['../../modules/specialty-care/core/types.ts', '../../data/mock.ts']
    .map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8')));

interface Declared { fields: Set<string>; extendsNames: string[]; discriminant: string | null }

/**
 * Interfaces by name. Line-based on purpose: every interface here closes with
 * a `}` in column 0, and a brace counter is thrown off by braces in comments.
 */
function interfaces(): Map<string, Declared> {
  const out = new Map<string, Declared>();
  for (const source of sources) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const header = /^export interface (\w+)(?:<[^>]*>)?(?: extends ([\w, <>.'"()-]+?))? \{\s*$/.exec(lines[i]);
      if (!header) continue;
      const fields = new Set<string>();
      let discriminant: string | null = null;
      for (i += 1; i < lines.length && lines[i] !== '}'; i++) {
        const member = /^ {2}(?:readonly\s+)?['"]?([A-Za-z_$][\w$]*)['"]?\??:\s*(.*)$/.exec(lines[i]);
        if (!member) continue;
        fields.add(member[1]);
        const literal = member[1] === 'type' ? /^'([\w]+)'/.exec(member[2]) : null;
        if (literal) discriminant = literal[1];
      }
      out.set(header[1], {
        discriminant,
        fields,
        extendsNames: (header[2] || '').match(/\b[A-Z]\w*/g)?.filter(name => !['Omit', 'Pick', 'Partial'].includes(name)) ?? [],
      });
    }
  }
  return out;
}

const all = interfaces();

function declares(name: string, field: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const declared = all.get(name);
  if (!declared) return false;
  return declared.fields.has(field) || declared.extendsNames.some(parent => declares(parent, field, seen));
}

/** The interface whose `type: '<key>'` discriminant is the catalog key. */
function interfaceFor(typeKey: string): string | null {
  for (const [name, declared] of all) if (declared.discriminant === typeKey) return name;
  return null;
}

/**
 * Catalog entries for types with no TypeScript interface (their documents are
 * built ad hoc). Listed so a NEW such entry is a conscious decision.
 */
const NO_INTERFACE = new Set(['patient_feedback', 'workflow_repair', 'sync_event', 'audit_log', 'bed']);

/**
 * Paths that predate this test and that no declared interface backs (they are
 * written by older or ad hoc code, or are defensive). Sealing a path that
 * names nothing is harmless, so they stay; the list is a ratchet. A NEW entry
 * that names nothing fails the test, and one that starts to exist must be
 * removed from here.
 */
const UNVERIFIED_BASELINE = new Set([
  'patient.name (not on PatientDoc)',
  'patient.ngoName (not on PatientDoc)',
  'patient.exemptionReason (not on PatientDoc)',
  'patient.programEnrollment (not on PatientDoc)',
  'medical_record.patientName (not on MedicalRecordDoc)',
  'clinical_note: no interface with type: \'clinical_note\'',
  'specialty_care_episode.notes (not on SpecialtyCareEpisodeDoc)',
  'billing.payerName (not on BillingDoc)',
  'billing.memberId (not on BillingDoc)',
  'billing.phoneNumber (not on BillingDoc)',
  'charge.patientName (not on ChargeDoc)',
  'charge.notes (not on ChargeDoc)',
  'claim.memberId (not on ClaimDoc)',
  'claim.subscriberName (not on ClaimDoc)',
  'claim.notes (not on ClaimDoc)',
  'payment.phoneNumber (not on PaymentDoc)',
  'payment.payerName (not on PaymentDoc)',
  'refund.notes (not on RefundDoc)',
  'payment_plan.notes (not on PaymentPlanDoc)',
  'invoice.notes (not on InvoiceDoc)',
  'insurance_policy.patientName (not on InsurancePolicyDoc)',
  'insurance_policy.subscriberPhone (not on InsurancePolicyDoc)',
  'insurance_policy.notes (not on InsurancePolicyDoc)',
  'eligibility_check.patientName (not on EligibilityCheckDoc)',
  'eligibility_check.memberId (not on EligibilityCheckDoc)',
  'eligibility_check.responseNote (not on EligibilityCheckDoc)',
  'saved_payment_method.patientName (not on SavedPaymentMethodDoc)',
  'saved_payment_method.holderName (not on SavedPaymentMethodDoc)',
  'ledger_entry.patientName (not on LedgerEntryDoc)',
  'ledger_entry.memo (not on LedgerEntryDoc)',
  'provider_review.patientName (not on ProviderReviewDoc)',
]);

describe('PHI catalog paths exist on real document types', () => {
  const entries = catalog.types as Record<string, { fields: string[] }>;

  test('every sealed path starts at a field its document type declares', () => {
    const missing: string[] = [];
    for (const [type, entry] of Object.entries(entries)) {
      const iface = interfaceFor(type);
      if (!iface) {
        if (!NO_INTERFACE.has(type)) missing.push(`${type}: no interface with type: '${type}'`);
        continue;
      }
      for (const field of entry.fields) {
        const first = field.split('.')[0].replace(/\[\]$/, '');
        if (!declares(iface, first)) missing.push(`${type}.${field} (not on ${iface})`);
      }
    }
    const fresh = missing.filter(entry => !UNVERIFIED_BASELINE.has(entry));
    const healed = [...UNVERIFIED_BASELINE].filter(entry => !missing.includes(entry));
    expect(fresh).toEqual([]);
    expect(healed).toEqual([]);
  });

  test('the fields added for billing, coding and reviews are sealed', () => {
    const sealed = (type: string) => entries[type].fields;
    expect(sealed('provider_review')).toEqual(expect.arrayContaining(['body']));
    expect(sealed('provider_review')).not.toEqual(expect.arrayContaining(['comment']));
    expect(sealed('billing')).toContain('items[].description');
    expect(sealed('invoice')).toContain('lineItems[].description');
    expect(sealed('claim')).toContain('billItems[].description');
    expect(sealed('death')).toEqual(expect.arrayContaining(['underlyingICD11', 'mannerOfDeath']));
    expect(sealed('payment')).toContain('mobileMoneyPhone');
    expect(sealed('insurance_policy')).toContain('policyNumber');
  });

  test('structural keys the pay-first gate and reports match on stay readable', () => {
    for (const field of ['category', 'referenceId', 'referenceType', 'id']) {
      expect(entries.billing.fields).not.toContain(`items[].${field}`);
    }
  });
});
