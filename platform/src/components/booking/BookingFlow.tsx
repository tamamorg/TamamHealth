'use client';

/**
 * BookingFlow — slot → details → insurance → confirmed.
 *
 * The state machine behind every public booking surface. It owns the draft and
 * the hold lifecycle; the surfaces above it own only where the card sits on the
 * page. That is what lets the provider rail, the practice page and the embedded
 * widget book identically without three copies of this logic drifting apart.
 *
 * Two rules worth stating because they are easy to lose in a refactor:
 *
 *  - The hold is taken when a time is picked, not when the form is submitted.
 *    A patient spending four minutes on the details step is not racing anyone.
 *  - A rejected submit sends the patient back to the slot step, not to a dead
 *    end. "That time has just been taken" is only useful next to the times
 *    that are still free.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSlots, holdSlot, submitBooking, addDays, todayIso, longWhen,
  type BookingConfirmation, type PublicPolicy, type PublicProvider,
  type PublicReason, type PublicSlot,
} from '@/lib/booking/public-client';
import {
  BookingCard, PatientClassToggle, DayNavigator, SlotChips, Field,
  BookingSelect, StepDots, ProviderAvatar,
} from './primitives';

export type BookingStep = 'slot' | 'details' | 'insurance' | 'done';

export interface BookingFlowProps {
  practiceSlug: string;
  practiceName: string;
  policy: PublicPolicy;
  reasons: PublicReason[];
  /** Fixed to one clinician on a profile page; the chosen row elsewhere. */
  provider: PublicProvider;
  /** Pre-selected slot, when the surface above already had the patient pick one. */
  initialSlot?: { date: string; startTime: string };
  title?: string;
  onClose?: () => void;
  /** Called with the reference once a booking lands, for surfaces that navigate. */
  onBooked?: (confirmation: BookingConfirmation) => void;
}

interface Draft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  insuranceProvider: string;
  insuranceMemberId: string;
  insuranceGroupId: string;
  notes: string;
  consentPrivacy: boolean;
  consentSms: boolean;
  /** Honeypot — stays empty for a human. */
  website: string;
}

const EMPTY_DRAFT: Draft = {
  firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '',
  insuranceProvider: '', insuranceMemberId: '', insuranceGroupId: '',
  notes: '', consentPrivacy: false, consentSms: false, website: '',
};

export default function BookingFlow({
  practiceSlug, practiceName, policy, reasons, provider,
  initialSlot, title = 'Request Appointment', onClose, onBooked,
}: BookingFlowProps) {
  const [patientClass, setPatientClass] = useState<'new' | 'returning'>('new');
  const [reasonId, setReasonId] = useState('');
  const [date, setDate] = useState(initialSlot?.date || todayIso());
  const [time, setTime] = useState(initialSlot?.startTime || '');
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotNote, setSlotNote] = useState<string | null>(null);

  const [holdToken, setHoldToken] = useState('');
  const [step, setStep] = useState<BookingStep>('slot');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

  const today = todayIso();
  const horizon = useMemo(() => addDays(today, policy.maxAdvanceDays), [today, policy.maxAdvanceDays]);

  // Only the reasons this kind of patient may pick. Changing the toggle can
  // therefore invalidate the current choice — handled below rather than left
  // to submit-time, so the patient never fills in a form for a visit they are
  // not eligible to book.
  const eligibleReasons = useMemo(
    () => reasons.filter(r => (
      patientClass === 'new' ? r.availableToNewPatients : r.availableToReturningPatients
    )),
    [reasons, patientClass],
  );

  useEffect(() => {
    if (!eligibleReasons.length) { setReasonId(''); return; }
    if (!eligibleReasons.some(r => r.id === reasonId)) {
      setReasonId(eligibleReasons[0].id);
      setTime('');
    }
  }, [eligibleReasons, reasonId]);

  const reason = eligibleReasons.find(r => r.id === reasonId);
  const modality: 'in_person' | 'telehealth' = reason?.modality === 'telehealth' ? 'telehealth' : 'in_person';
  const needsInsurance = Boolean(reason?.requiresInsurance || policy.requireInsurance);

  // ── Availability for the visible day ──
  useEffect(() => {
    if (!reasonId) { setSlots([]); return; }
    const ac = new AbortController();
    setLoadingSlots(true);
    setSlotNote(null);
    fetchSlots({ practice: practiceSlug, reason: reasonId, patientClass, modality, from: date, to: date, provider: provider.id }, ac.signal)
      .then(r => {
        setSlots(r.slots);
        if (r.notOfferedToPatientClass) setSlotNote('This visit is not offered to this kind of patient.');
        else if (r.notOfferedInModality) setSlotNote('This visit is not offered in that format.');
        else if (r.beyondHorizon) setSlotNote('That date is beyond how far ahead this practice books.');
      })
      .catch(err => { if (!ac.signal.aborted) setSlotNote(err instanceof Error ? err.message : 'Could not load times.'); })
      .finally(() => { if (!ac.signal.aborted) setLoadingSlots(false); });
    return () => ac.abort();
  }, [practiceSlug, reasonId, patientClass, modality, date, provider.id]);

  const times = useMemo(
    () => Array.from(new Set(slots.filter(s => s.date === date).map(s => s.startTime))).sort(),
    [slots, date],
  );

  const pickTime = useCallback(async (t: string) => {
    if (!reasonId) return;
    setError(null);
    setTime(t);
    try {
      const hold = await holdSlot({
        practice: practiceSlug, reason: reasonId, providerId: provider.id, date, startTime: t,
      });
      setHoldToken(hold.holdToken);
      setStep('details');
    } catch (err) {
      setTime('');
      setError(err instanceof Error ? err.message : 'Could not hold that time.');
    }
  }, [practiceSlug, reasonId, provider.id, date]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const detailsComplete = draft.firstName.trim() && draft.lastName.trim()
    && (draft.phone.trim() || draft.email.trim()) && draft.consentPrivacy;

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitBooking({
        practice: practiceSlug,
        reason: reasonId,
        holdToken,
        patientClass,
        modality,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        dateOfBirth: draft.dateOfBirth || undefined,
        insurance: draft.insuranceProvider.trim()
          ? {
            provider: draft.insuranceProvider.trim(),
            memberId: draft.insuranceMemberId.trim(),
            groupId: draft.insuranceGroupId.trim() || undefined,
          }
          : undefined,
        notes: draft.notes.trim() || undefined,
        consentPrivacy: draft.consentPrivacy,
        consentSms: draft.consentSms,
        website: draft.website,
      });
      setConfirmation(result);
      setStep('done');
      onBooked?.(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      setError(e.message);
      // A gone slot is not a form error — send them back to the times.
      if (e.code === 'SLOT_TAKEN' || e.code === 'HOLD_EXPIRED') {
        setStep('slot');
        setTime('');
        setHoldToken('');
      }
    } finally {
      setSubmitting(false);
    }
  }, [practiceSlug, reasonId, holdToken, patientClass, modality, draft, onBooked]);

  const stepIndex = step === 'slot' ? 0 : step === 'details' ? 1 : 2;
  const stepCount = needsInsurance ? 3 : 2;

  // ── Confirmed ──
  if (step === 'done' && confirmation) {
    return (
      <BookingCard title="Appointment requested" onClose={onClose}>
        <p className="booking-hint" style={{ fontSize: 15 }}>
          {confirmation.status === 'scheduled'
            ? 'Your appointment is confirmed.'
            : 'Your request has been sent. The practice will confirm it shortly.'}
        </p>
        <div className="booking-reference">{confirmation.reference}</div>
        <div className="booking-divider" />
        <b style={{ fontSize: 16 }}>{longWhen(confirmation.date, confirmation.startTime)}</b>
        <span className="booking-hint">
          {confirmation.visitReasonName} · {confirmation.providerName} · {confirmation.facilityName}
        </span>
        <p className="booking-hint">
          Keep this reference — you can check or cancel this booking with it.
        </p>
      </BookingCard>
    );
  }

  // ── Slot ──
  if (step === 'slot') {
    return (
      <BookingCard title={title} onClose={onClose}>
        <PatientClassToggle value={patientClass} onChange={setPatientClass} />

        {eligibleReasons.length === 0 ? (
          <p className="booking-empty-note">
            This practice is not taking {patientClass === 'new' ? 'new' : 'returning'} patients online right now.
          </p>
        ) : (
          <BookingSelect value={reasonId} onChange={v => { setReasonId(v); setTime(''); }} ariaLabel="Reason for visit">
            {eligibleReasons.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </BookingSelect>
        )}

        {error && <p className="booking-error">{error}</p>}

        {eligibleReasons.length > 0 && (
          <>
            <div className="booking-divider" />
            <DayNavigator
              date={date}
              onPrev={() => { setDate(addDays(date, -1)); setTime(''); }}
              onNext={() => { setDate(addDays(date, 1)); setTime(''); }}
              canGoBack={date > today}
              canGoForward={date < horizon}
            />
            <div className="booking-divider" />
            {loadingSlots
              ? <p className="booking-empty-note">Loading times…</p>
              : slotNote
                ? <p className="booking-empty-note">{slotNote}</p>
                : <SlotChips times={times} selected={time} onPick={pickTime} />}
          </>
        )}
      </BookingCard>
    );
  }

  // ── Details / insurance ──
  const backToSlot = () => { setStep('slot'); setError(null); };

  return (
    <BookingCard title={title} onBack={step === 'insurance' ? () => setStep('details') : backToSlot} onClose={onClose}>
      <div className="booking-summary" style={{ margin: '-16px -16px 0', padding: '14px 16px' }}>
        <ProviderAvatar name={provider.displayName} photoUrl={provider.photoUrl} />
        <div className="booking-summary-meta">
          <b>{longWhen(date, time)}</b>
          <span>{provider.displayName} · {practiceName}</span>
        </div>
      </div>

      {error && <p className="booking-error">{error}</p>}

      {step === 'details' ? (
        <>
          <Field label="First Name" htmlFor="bk-first">
            <input id="bk-first" className="booking-input" value={draft.firstName}
              autoComplete="given-name" onChange={e => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last Name" htmlFor="bk-last">
            <input id="bk-last" className="booking-input" value={draft.lastName}
              autoComplete="family-name" onChange={e => set('lastName', e.target.value)} />
          </Field>
          <div className="booking-field-row">
            <Field label="Email" htmlFor="bk-email">
              <input id="bk-email" type="email" className="booking-input" placeholder="email@domain.com"
                value={draft.email} autoComplete="email" onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="bk-phone">
              <input id="bk-phone" type="tel" className="booking-input" placeholder="+211 900 000 000"
                value={draft.phone} autoComplete="tel" onChange={e => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="Date of Birth" htmlFor="bk-dob">
            <input id="bk-dob" type="date" value={draft.dateOfBirth}
              max={today} onChange={e => set('dateOfBirth', e.target.value)} />
          </Field>

          {/* Honeypot. Hidden from people, irresistible to form-fillers. */}
          <input
            type="text" name="website" tabIndex={-1} autoComplete="off" value={draft.website}
            onChange={e => set('website', e.target.value)}
            aria-hidden style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
          />

          <div className="booking-consent">
            <label className="booking-check">
              <input type="checkbox" checked={draft.consentPrivacy}
                onChange={e => set('consentPrivacy', e.target.checked)} />
              <span style={{ fontWeight: 600 }}>{policy.consentTextPrivacy}</span>
            </label>
            <label className="booking-check">
              <input type="checkbox" checked={draft.consentSms}
                onChange={e => set('consentSms', e.target.checked)} />
              <span style={{ fontWeight: 600 }}>{policy.consentTextSms}</span>
            </label>
            {/* The consent above names two documents; these are how the patient
                actually reads them — in a new tab, without an account, and
                without losing the half-filled form behind them. Separate links
                rather than markup inside the consent string, which is
                tenant-authored and rendered as plain text on purpose. */}
            <p className="booking-consent-links">
              <a href="/terms" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>
              <span aria-hidden> · </span>
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </p>

            {/* Practice-authored, rendered as text. Never dangerouslySetInnerHTML:
                this string is supplied by a tenant and read on a public page. */}
            {policy.policyText && <p className="booking-policy-text">{policy.policyText}</p>}
          </div>

          <div className="booking-actions">
            <StepDots count={stepCount} active={stepIndex} />
            <button
              type="button" className="booking-btn"
              disabled={!detailsComplete || submitting}
              onClick={() => (needsInsurance ? setStep('insurance') : submit())}
            >
              {needsInsurance ? 'Continue →' : submitting ? 'Sending…' : 'Confirm request'}
            </button>
          </div>
        </>
      ) : (
        <>
          <Field label="Insurance" htmlFor="bk-ins">
            <input id="bk-ins" className="booking-input" value={draft.insuranceProvider}
              onChange={e => set('insuranceProvider', e.target.value)} />
          </Field>
          <div className="booking-field-row">
            <Field label="Insurance Member ID#" htmlFor="bk-member">
              <input id="bk-member" className="booking-input" value={draft.insuranceMemberId}
                onChange={e => set('insuranceMemberId', e.target.value)} />
            </Field>
            <Field label="Insurance Group ID#" htmlFor="bk-group">
              <input id="bk-group" className="booking-input" value={draft.insuranceGroupId}
                onChange={e => set('insuranceGroupId', e.target.value)} />
            </Field>
          </div>
          <Field label="Additional notes for the practice" htmlFor="bk-notes">
            <textarea id="bk-notes" className="booking-input" rows={3}
              style={{ minHeight: 88, padding: 12, resize: 'vertical' }}
              value={draft.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
          <div className="booking-actions">
            <StepDots count={stepCount} active={stepIndex} />
            <button
              type="button" className="booking-btn"
              disabled={submitting || !draft.insuranceProvider.trim()}
              onClick={submit}
            >
              {submitting ? 'Sending…' : 'Confirm request'}
            </button>
          </div>
        </>
      )}
    </BookingCard>
  );
}
