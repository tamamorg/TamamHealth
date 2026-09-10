import type { Slot } from './slot-engine';

/** Published hours are not authority to assign a clinician. */
export function eligibleBookingSlots(slots: Slot[], providers: ReadonlyArray<{ _id: string }>): Slot[] {
  const eligibleIds = new Set(providers.map(provider => provider._id));
  return slots.filter(slot => eligibleIds.has(slot.providerId));
}
