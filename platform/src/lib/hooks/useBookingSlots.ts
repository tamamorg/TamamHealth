'use client';

/**
 * useBookingSlots — bookable times for a facility, recomputed as the request
 * changes.
 *
 * Wraps `booking-service.getAvailableSlots`, which wraps the pure slot engine.
 * Nothing here decides what is bookable; it only decides when to ask.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Slot, SlotChannel } from '../booking/slot-engine';
import { addDays } from '../booking/slot-engine';
import type { PatientClass, VisitReasonDoc } from '../db-types-booking';

export interface UseBookingSlotsOptions {
  facilityId?: string;
  orgId?: string;
  visitReason?: VisitReasonDoc | null;
  patientClass?: PatientClass;
  channel?: SlotChannel;
  /** First day to search. Defaults to the facility's today. */
  from?: string;
  /** How many days to load in one pass. */
  days?: number;
  providerIds?: string[];
  /** A second person the visit needs — slots narrow to when they are free too. */
  secondaryStaffId?: string;
  /** Skip loading entirely (e.g. while the form has no reason chosen yet). */
  enabled?: boolean;
}

export function useBookingSlots(options: UseBookingSlotsOptions) {
  const {
    facilityId, orgId, visitReason,
    patientClass = 'returning',
    channel = 'staff',
    from, days = 30, providerIds, secondaryStaffId,
    enabled = true,
  } = options;

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  // Identify a request by value, so re-rendering with an equal provider array
  // does not refetch. The array is the only reference-typed input.
  const providerKey = useMemo(() => (providerIds ?? []).join(','), [providerIds]);

  // Guards against a slow response for an old request overwriting a new one.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !facilityId || !visitReason) {
      setSlots([]);
      setRange(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const { getAvailableSlots, facilityNow } = await import('../services/booking-service');
      const start = from || facilityNow().date;
      const result = await getAvailableSlots({
        facilityId,
        orgId,
        visitReason,
        patientClass,
        channel,
        from: start,
        to: addDays(start, days),
        providerIds: providerKey ? providerKey.split(',') : undefined,
        secondaryStaffId,
      });
      if (seq !== requestSeq.current) return;   // superseded
      setSlots(result.slots);
      setRange({ from: result.from, to: result.to });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error('[useBookingSlots]', err);
      setError('Could not load available times');
      setSlots([]);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [enabled, facilityId, orgId, visitReason, patientClass, channel, from, days, providerKey, secondaryStaffId]);

  useEffect(() => { load(); }, [load]);

  /** The days that have at least one opening, ascending. */
  const availableDates = useMemo(
    () => [...new Set(slots.map(s => s.date))].sort(),
    [slots],
  );

  return {
    slots,
    availableDates,
    /** First day with an opening — what a picker should land on. */
    firstAvailableDate: availableDates[0],
    loading,
    error,
    range,
    reload: load,
  };
}
