import type { FormularyDrug } from '@/lib/data/formulary';
import { todayIso } from '@/lib/date-utils';
import { getRoleChoice } from '@/lib/settings/role-settings-store';

/** The prescription being written. One draft per Rx; "Add Rx" resets it. */
export interface RxDraft {
  drug: FormularyDrug | null;
  quantity: string;
  refills: string;
  daysSupply: string;
  effectiveOn: string;
  allowSubstitution: boolean;
  serviceLocation: string;
  /** "1A40 · Malaria" — cited from the patient's active problem list. */
  reason: string;
  instructions: string;
  pharmacyNote: string;
}

/** "5 days" → "5". Empty when the setting is unset or unparseable. */
function defaultDaysSupply(): string {
  const choice = getRoleChoice('rx.duration', '');
  const match = /^(\d+)/.exec(choice.trim());
  return match ? match[1] : '';
}

export function emptyDraft(serviceLocation: string): RxDraft {
  return {
    drug: null,
    quantity: '1',
    refills: '0',
    // The prescriber's "Default prescription duration" (`rx.duration`, e.g.
    // "5 days"). Editable per prescription — this only seeds the field.
    daysSupply: defaultDaysSupply(),
    effectiveOn: todayIso(),
    allowSubstitution: true,
    serviceLocation,
    reason: '',
    instructions: '',
    pharmacyNote: '',
  };
}
