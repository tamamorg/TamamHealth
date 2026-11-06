import { jubaDate } from '../time-juba';

/**
 * A dispense can be reversed (medicine returned to stock) only on the Juba
 * day it was handed over. Pure, so the form can hide the action with the same
 * rule the service enforces.
 */
export function isWithinReversalWindow(dispensedAt: string | undefined, now: Date = new Date()): boolean {
  return Boolean(dispensedAt) && jubaDate(dispensedAt!) === jubaDate(now);
}
