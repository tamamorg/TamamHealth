'use client';

/**
 * S4 — the practice-wide booking page.
 *
 * One row per clinician, one column per day, and the cells are what each of
 * them has free. That shape is the whole point: a flat list of times repeats
 * "9:00 AM" once per clinician and leaves the reader to work out whose is
 * whose, whereas this lets a patient who does not mind *who* they see pick the
 * earliest opening in one glance.
 *
 * Two clinicians genuinely may hold the same 9:00 — parallel booking across
 * providers at one location is the product behaviour, not an oversight. See
 * `singleSlotPerFacility` in the booking policy for the opposite.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import {
  fetchSlots, addDays, todayIso, dayParts, to12Hour,
  type PracticePayload, type PublicProvider, type PublicSlot,
} from '@/lib/booking/public-client';
import {
  PatientClassToggle, BookingSelect, Field,
  ProviderAvatar, VirtualBadge,
} from './primitives';
import BookingFlow from './BookingFlow';

const DAYS = 5;
const MAX_PER_CELL = 3;

export default function PracticeBooking({ data }: { data: PracticePayload }) {
  const { practice, policy, providers, reasons } = data;

  const [patientClass, setPatientClass] = useState<'new' | 'returning'>('new');
  const [providerFilter, setProviderFilter] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [weekStart, setWeekStart] = useState(todayIso());
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The row+time the patient clicked. Opens the wizard in place. */
  const [picked, setPicked] = useState<{ provider: PublicProvider; date: string; startTime: string } | null>(null);

  const today = todayIso();
  const horizon = useMemo(() => addDays(today, policy.maxAdvanceDays), [today, policy.maxAdvanceDays]);

  const eligibleReasons = useMemo(
    () => reasons.filter(r => (
      patientClass === 'new' ? r.availableToNewPatients : r.availableToReturningPatients
    )),
    [reasons, patientClass],
  );

  useEffect(() => {
    if (!eligibleReasons.length) { setReasonId(''); return; }
    if (!eligibleReasons.some(r => r.id === reasonId)) setReasonId(eligibleReasons[0].id);
  }, [eligibleReasons, reasonId]);

  const columns = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  useEffect(() => {
    if (!reasonId) { setSlots([]); return; }
    const ac = new AbortController();
    setLoading(true);
    setNote(null);
    fetchSlots({
      practice: practice.slug,
      reason: reasonId,
      patientClass,
      from: columns[0],
      to: columns[columns.length - 1],
      provider: providerFilter || undefined,
    }, ac.signal)
      .then(r => {
        setSlots(r.slots);
        if (r.notOfferedToPatientClass) setNote('This visit is not offered to this kind of patient.');
        else if (r.notOfferedInModality) setNote('This visit is not offered in that format.');
      })
      .catch(err => { if (!ac.signal.aborted) setNote(err instanceof Error ? err.message : 'Could not load availability.'); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [practice.slug, reasonId, patientClass, providerFilter, columns]);

  /** providerId → date → sorted start times. */
  const byProvider = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    for (const s of slots) {
      let byDate = map.get(s.providerId);
      if (!byDate) { byDate = new Map(); map.set(s.providerId, byDate); }
      const list = byDate.get(s.date);
      if (list) { if (!list.includes(s.startTime)) list.push(s.startTime); }
      else byDate.set(s.date, [s.startTime]);
    }
    for (const byDate of map.values()) for (const list of byDate.values()) list.sort();
    return map;
  }, [slots]);

  // Rows: everyone when unfiltered, so a clinician with nothing free this week
  // still appears with em-dashes rather than vanishing — "Dr X is off" is a
  // fact worth showing.
  const rows = useMemo(
    () => (providerFilter ? providers.filter(p => p.id === providerFilter) : providers),
    [providers, providerFilter],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const gridTemplate = `minmax(210px, 1.4fr) repeat(${DAYS}, minmax(96px, 1fr))`;

  if (picked) {
    const reason = eligibleReasons.find(r => r.id === reasonId);
    return (
      <div className="booking-page" style={{ maxWidth: 560 }}>
        <button type="button" className="booking-linkish" style={{ marginBottom: 14 }} onClick={() => setPicked(null)}>
          ← Back to all times
        </button>
        <BookingFlow
          practiceSlug={practice.slug}
          practiceName={practice.name}
          policy={policy}
          reasons={reason ? [reason] : eligibleReasons}
          provider={picked.provider}
          initialSlot={{ date: picked.date, startTime: picked.startTime }}
          onClose={() => setPicked(null)}
        />
      </div>
    );
  }

  return (
    <div className="booking-page">
      <h1 className="booking-h1">Book an appointment</h1>
      <p className="booking-sub">
        {practice.name}{practice.town ? ` · ${practice.town}` : ''}
      </p>

      <section className="booking-card">
        <div className="booking-card-body">
          <PatientClassToggle value={patientClass} onChange={setPatientClass} variant="checkbox" />

          <div className="booking-field-row">
            <Field label="Reason for visit">
              <BookingSelect value={reasonId} onChange={setReasonId} ariaLabel="Reason for visit">
                {eligibleReasons.length === 0 && <option value="">Nothing bookable online</option>}
                {eligibleReasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </BookingSelect>
            </Field>
            <Field label="Provider">
              <BookingSelect value={providerFilter} onChange={setProviderFilter} ariaLabel="Provider">
                <option value="">Any provider</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </BookingSelect>
            </Field>
          </div>

          <div className="booking-divider" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginInlineStart: 'auto' }}>
              <button
                type="button" className="booking-round-btn" aria-label="Previous days"
                disabled={weekStart <= today}
                onClick={() => setWeekStart(w => {
                  const back = addDays(w, -DAYS);
                  return back < today ? today : back;
                })}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button" className="booking-round-btn" aria-label="Next days"
                disabled={columns[columns.length - 1] >= horizon}
                onClick={() => setWeekStart(w => addDays(w, DAYS))}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>

        <div className="booking-card-body" style={{ paddingTop: 0 }}>
          <div className="booking-week">
            <div className="booking-week-head" style={{ gridTemplateColumns: gridTemplate }}>
              <span />
              {columns.map(d => {
                const { weekday, label } = dayParts(d);
                return (
                  <div key={d} className="booking-week-col">
                    <small>{weekday}</small>
                    <b>{label}</b>
                  </div>
                );
              })}
            </div>

            {note && <p className="booking-empty-note">{note}</p>}
            {!note && loading && <p className="booking-empty-note">Loading availability…</p>}
            {!note && !loading && rows.length === 0 && (
              <p className="booking-empty-note">This practice has no clinicians published for online booking yet.</p>
            )}

            {!note && !loading && rows.map(p => (
              <div key={p.id} className="booking-week-row" style={{ gridTemplateColumns: gridTemplate }}>
                <div className="booking-provider">
                  <ProviderAvatar name={p.displayName} photoUrl={p.photoUrl} />
                  <div className="booking-provider-meta">
                    <b>{p.displayName}</b>
                    {p.specialtyLabel && <span>{p.specialtyLabel}</span>}
                  </div>
                </div>

                {columns.map(d => {
                  const all = byProvider.get(p.id)?.get(d) ?? [];
                  const key = `${p.id}|${d}`;
                  const isOpen = expanded.has(key);
                  const shown = isOpen ? all : all.slice(0, MAX_PER_CELL);
                  return (
                    <div key={d} className="booking-cell">
                      {all.length === 0 && <span className="booking-slot-empty" aria-label="No times">—</span>}
                      {shown.map(t => (
                        <button
                          key={t} type="button" className="booking-slot"
                          onClick={() => setPicked({ provider: p, date: d, startTime: t })}
                        >
                          {to12Hour(t)}
                        </button>
                      ))}
                      {/* Expands in place, so one busy clinician cannot push
                          the next one off the bottom of the page. */}
                      {all.length > MAX_PER_CELL && (
                        <button type="button" className="booking-slot is-more" onClick={() => toggleExpanded(key)}>
                          {isOpen ? 'less' : 'more'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
