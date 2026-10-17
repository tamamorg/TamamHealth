/** Payment service split: saved-methods. Re-exported through ../payment-service. */
import { findByType } from '../db-query';
import type { SavedPaymentMethodDoc, SavedPaymentMethodType } from '../../db-types-payments';
import type { DataScope } from '../data-scope';
import { filterByScope } from '../data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '../audit-service';
import { savedPaymentMethodsDB } from './shared';

// ═══════════════════════════════════════════════════════════════════
// SAVED PAYMENT METHODS
// ═══════════════════════════════════════════════════════════════════

export async function savePaymentMethod(input: {
  patientId: string;
  methodType: SavedPaymentMethodType;
  phoneNumber?: string;
  cardToken?: string;
  cardLast4?: string;
  cardBrand?: string;
  cardExpiry?: string;
  bankName?: string;
  bankAccountLast4?: string;
  label?: string;
  isDefault?: boolean;
  facilityId: string;
  orgId?: string;
}): Promise<SavedPaymentMethodDoc> {
  const db = savedPaymentMethodsDB();
  const now = new Date().toISOString();

  // Auto-generate label
  let label = input.label;
  if (!label) {
    if (input.phoneNumber) label = `${input.methodType === 'mpesa' ? 'M-Pesa' : input.methodType === 'airtel' ? 'Airtel' : 'MTN'} \u2022\u2022\u2022${input.phoneNumber.slice(-4)}`;
    else if (input.cardLast4) label = `${input.cardBrand || 'Card'} \u2022\u2022\u2022${input.cardLast4}`;
    else if (input.bankAccountLast4) label = `${input.bankName || 'Bank'} \u2022\u2022\u2022${input.bankAccountLast4}`;
    else label = input.methodType;
  }

  const doc: SavedPaymentMethodDoc = {
    _id: `spm-${uuidv4()}`,
    type: 'saved_payment_method',
    ...input,
    label,
    isDefault: input.isDefault || false,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  return doc;
}

export async function getPatientPaymentMethods(patientId: string, scope: DataScope): Promise<SavedPaymentMethodDoc[]> {
  return readPatientPaymentMethods(patientId, scope);
}

/** Reader shared with the portal summary, which passes `undefined` (see buildFinancialSummary). */
export async function readPatientPaymentMethods(patientId: string, scope: DataScope | undefined): Promise<SavedPaymentMethodDoc[]> {
  const rows = await findByType<SavedPaymentMethodDoc>(savedPaymentMethodsDB(), 'saved_payment_method', { patientId }, { indexFields: ['type', 'patientId'] });
  return scope ? filterByScope(rows, scope) : rows;
}

/** Remove a saved payment method (patient-managed convenience record). */
export async function deletePaymentMethod(id: string): Promise<boolean> {
  const db = savedPaymentMethodsDB();
  try {
    const doc = await db.get(id);
    await db.remove(doc);
    await logAuditSafe('DELETE_PAYMENT_METHOD', undefined, undefined, `Saved payment method ${id} removed`);
    return true;
  } catch {
    return false;
  }
}
