import type { AdmissionDoc } from './db-types-ward';
import { jubaDate } from './time-juba';

/** Why a discharge can no longer be undone, or null. Same Juba day, plain discharge only. */
export function findUndoDischargeBlocker(admission: AdmissionDoc, now: Date = new Date()): string | null {
  if (admission.status !== 'discharged' || !admission.dischargeDate) {
    return 'Only a discharged admission can be reopened. Deaths, transfers and absconding are closed by their own records.';
  }
  if (jubaDate(admission.dischargeDate) !== jubaDate(now)) {
    return 'A discharge can only be undone on the day it was made.';
  }
  return null;
}

