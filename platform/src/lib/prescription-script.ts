/**
 * The prescription as the patient carries it: a printed script, or a text
 * message, for a pharmacy that is not this facility's own.
 *
 * Until now the only paper the prescribing dialog produced was a "DRAFT — NOT
 * YET ISSUED" sheet, printed before the order was saved. A facility with no
 * dispensary had nothing valid to hand over. These builders work from the
 * SAVED prescription documents, so what the patient holds always matches the
 * chart, and each item carries a reference a pharmacist can quote back to the
 * facility.
 *
 * Pure: the callers open the print window and send the text.
 */
import type { PrescriptionDoc } from './db-types';
import { escapeHtml } from './safe-html';
import { buildClinicalPrintDocument } from './print-document';
import { toSmsSafe } from './sms/text';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "03 Oct 2026" — fixed, locale-independent, and unambiguous on paper. */
export function scriptDate(iso?: string | null): string {
  if (!iso) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Short reference for one prescription, derived from its id so it needs no
 * extra field and is the same on every device: "RX-4F2A9C".
 */
export function scriptReference(rx: Pick<PrescriptionDoc, '_id'>): string {
  const tail = (rx._id || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return `RX-${tail || 'UNSAVED'}`;
}

/**
 * Stages at which an on-site order may still be turned into a script for an
 * outside pharmacy: before the dispensing queue has taken it, or after the
 * queue has reported it cannot fill it. Anything in between is on a
 * pharmacist's bench, and re-routing it from the chart would pull it out from
 * under them.
 */
const REROUTABLE_STAGES: ReadonlySet<string> = new Set(['prescribed', 'stockout_partial_referred']);

/** Whether this order can be handed to the patient to fill elsewhere. */
export function canRerouteToOutsidePharmacy(
  rx: Pick<PrescriptionDoc, 'status' | 'orderStatus' | 'fulfilment'>,
): boolean {
  if (rx.status !== 'pending') return false;
  if (rx.fulfilment === 'external') return true;
  return REROUTABLE_STAGES.has(rx.orderStatus || 'prescribed');
}

export interface ScriptPatient {
  name: string;
  hospitalNumber?: string;
  ageLabel?: string;
  sex?: string;
  allergies?: string[];
  preferredPharmacy?: { name: string; address?: string; phone?: string };
}

export interface ScriptContext {
  patient: ScriptPatient;
  facilityName: string;
  prescriberName: string;
  /** ISO timestamp the script is being handed over. */
  issuedAt: string;
}

/** Units already handed over at this facility (a partial fill). */
function alreadyDispensed(rx: PrescriptionDoc): number {
  return Math.max(0, Number(rx.quantityDispensed) || 0);
}

/**
 * What the script is FOR: the balance still owed, not the full course. An
 * order the on-site pharmacy part-filled and then referred out would
 * otherwise print its whole quantity, and the patient could collect the
 * course a second time outside — worst of all for a controlled medicine.
 */
export function scriptQuantity(rx: PrescriptionDoc): number {
  const course = Math.max(1, Number(rx.quantityToDispense) || 1);
  return Math.max(1, course - alreadyDispensed(rx));
}

/** Dose shown only when the record holds a real one, not the "As directed" placeholder. */
function statedDose(rx: PrescriptionDoc): string {
  const dose = (rx.dose || '').trim();
  return dose && dose.toLowerCase() !== 'as directed' && !rx.medication.toLowerCase().includes(dose.toLowerCase())
    ? dose
    : '';
}

/**
 * Whether an order can still be handed to the patient as a script.
 *
 * Not a stopped order — and not one this facility has already dispensed in
 * full. `scriptQuantity` floors at 1, so a 30-of-30 dispensed order printed as
 * a signed, valid-looking script for "Qty 1 (balance)": a second course the
 * patient could collect outside.
 */
export function isScriptable(rx: PrescriptionDoc): boolean {
  if (rx.status === 'discontinued' || rx.status === 'dispensed') return false;
  const course = Number(rx.quantityToDispense) || 0;
  return !(course > 0 && alreadyDispensed(rx) >= course);
}

/** Only orders that are still a script — see {@link isScriptable}. */
export function scriptableOnly(prescriptions: PrescriptionDoc[]): PrescriptionDoc[] {
  return prescriptions.filter(isScriptable);
}

export function buildPrescriptionScriptHtml(prescriptions: PrescriptionDoc[], ctx: ScriptContext): string {
  const e = escapeHtml;
  const items = scriptableOnly(prescriptions);
  const rows = items.map((rx, index) => {
    const dose = statedDose(rx);
    const detail = [
      rx.route ? e(rx.route) : '',
      rx.indication ? `For: ${e(rx.indication)}` : '',
      rx.allowSubstitution === false ? '<strong>Do not substitute</strong>' : 'Generic substitution permitted',
      alreadyDispensed(rx) > 0
        ? `<strong>Balance only</strong> — ${alreadyDispensed(rx)} of ${Math.max(1, Number(rx.quantityToDispense) || 1)} already dispensed at ${e(ctx.facilityName)}`
        : '',
      rx.pharmacyInstructions ? `Note to pharmacist: ${e(rx.pharmacyInstructions)}` : '',
    ].filter(Boolean).join(' · ');
    return `<tr>
      <td class="center">${index + 1}</td>
      <td><strong>${e(rx.medication)}</strong>${dose ? ` ${e(dose)}` : ''}<br><span class="muted">${detail}</span></td>
      <td><strong>${e(rx.frequency || 'As directed')}</strong></td>
      <td class="num">${scriptQuantity(rx)}</td>
      <td>${e(rx.duration || '—')}</td>
      <td class="num">${Number(rx.refills) || 0}</td>
      <td>${e(scriptReference(rx))}</td>
    </tr>`;
  }).join('');

  const allergies = (ctx.patient.allergies || []).filter(Boolean);
  const body = `
    <section class="section keep"><h2 class="section-title">Prescription <small>${items.length} item${items.length === 1 ? '' : 's'}</small></h2>
      ${items.length ? `<table>
        <thead><tr><th class="center">#</th><th>Medication</th><th>Directions for patient</th><th class="num">Qty</th><th>Duration</th><th class="num">Refills</th><th>Reference</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p class="empty">No active prescription to print.</p>'}
    </section>
    <section class="section keep"><h2 class="section-title">For the dispensing pharmacist</h2>
      <p><strong>Recorded allergies:</strong> ${e(allergies.join(', ') || 'None recorded')}</p>
      <p class="notice">To be dispensed by a licensed pharmacy. Quote the reference to ${e(ctx.facilityName)} to confirm any item on this prescription.</p>
    </section>
    <div class="signatures">
      <div><div class="signature"></div><div class="signature-label">Prescriber signature · ${e(ctx.prescriberName)}</div></div>
      <div><div class="signature"></div><div class="signature-label">Dispensed by · pharmacy stamp and date</div></div>
    </div>`;

  return buildClinicalPrintDocument({
    title: ctx.patient.name,
    documentLabel: 'Prescription',
    facilityName: ctx.facilityName,
    meta: [
      { label: 'Patient ID', value: ctx.patient.hospitalNumber },
      { label: 'Age / sex', value: [ctx.patient.ageLabel, ctx.patient.sex].filter(Boolean).join(' · ') },
      { label: 'Date issued', value: scriptDate(ctx.issuedAt) },
      { label: 'Prescriber', value: ctx.prescriberName },
      {
        label: 'Preferred pharmacy',
        value: ctx.patient.preferredPharmacy
          ? [ctx.patient.preferredPharmacy.name, ctx.patient.preferredPharmacy.address].filter(Boolean).join(', ')
          : undefined,
      },
    ],
    safeBodyHtml: body,
    footer: `Prescription issued from the clinical record at ${ctx.facilityName}. Valid only with the prescriber's signature.`,
  });
}

export interface PrescriptionText {
  /** The message body, GSM-7 safe. Empty when nothing may be sent. */
  text: string;
  /** Prescriptions the text carries. */
  included: PrescriptionDoc[];
  /** Left off the text: controlled medicines must be handed over on paper. */
  withheld: PrescriptionDoc[];
}

/**
 * The same prescription as a text message.
 *
 * Deliberately lean: a phone is often shared, and a text is neither encrypted
 * nor deletable once sent. It names the patient, the medicines, the
 * directions and who to call — never the diagnosis, date of birth or record
 * number. Controlled medicines are withheld entirely; a texted opioid script
 * is trivially forwarded and cannot be marked as dispensed.
 */
export function buildPrescriptionText(
  prescriptions: PrescriptionDoc[],
  ctx: ScriptContext,
  isControlled: (rx: PrescriptionDoc) => boolean = () => false,
): PrescriptionText {
  const active = scriptableOnly(prescriptions);
  const included = active.filter(rx => !isControlled(rx));
  const withheld = active.filter(rx => isControlled(rx));
  if (included.length === 0) return { text: '', included, withheld };

  const lines = [
    `${ctx.facilityName} - Prescription`,
    `Patient: ${ctx.patient.name}`,
    ...included.map((rx, index) => {
      const dose = statedDose(rx);
      const parts = [
        `${included.length > 1 ? `${index + 1}. ` : ''}${rx.medication}${dose ? ` ${dose}` : ''}, qty ${scriptQuantity(rx)}${alreadyDispensed(rx) > 0 ? ' (balance)' : ''}`,
        // Directions and duration are one instruction: "…after food for 4 days".
        `${(rx.frequency || 'As directed').replace(/[.\s]+$/, '')}${rx.duration ? ` for ${rx.duration}` : ''}`,
        Number(rx.refills) > 0 ? `refills ${Number(rx.refills)}` : '',
        rx.allowSubstitution === false ? 'no substitution' : '',
      ].filter(Boolean);
      return parts.join('. ').replace(/\.\./g, '.');
    }),
    `${ctx.prescriberName}, ${scriptDate(ctx.issuedAt)}`,
    `Ref ${included.map(scriptReference).join(', ')}`,
  ];
  return { text: toSmsSafe(lines.join('\n')), included, withheld };
}
