'use client';

/**
 * Patient-portal booking: reason -> week of real availability -> confirm.
 * The slots are the same ones the front desk sees (server channel 'portal');
 * submitting creates a *request* the desk confirms. Mobile first: a vertical
 * list of days with 44px+ time buttons, so there is no horizontal scroll.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { X, ChevronLeft, ChevronRight, CheckCircle2, Loader2 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatClockTime } from '@/lib/format-utils';
import { readPatientPortalSession } from '@/lib/patient-portal-session';
import { parseIsoDate, todayIso } from '@/lib/date-utils';
import type { AppointmentDoc, PatientDoc } from '@/lib/db-types';
import { shortDate } from './shared';
import {
  weekRange, prevWeekStart, nextWeekStart, groupSlotsByDay, slotKey, buildSlotBody, buildLegacyBody,
  type PortalSlot, type ContactPreference,
} from './booking-logic';

interface Reason { id: string; name: string; durationMinutes: number; description?: string }
type Step = 'reason' | 'slots' | 'confirm' | 'done';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function portalApi<T>(path: string, init?: RequestInit): Promise<T> {
  const session = readPatientPortalSession();
  if (!session) throw new HttpError(401, 'Missing patient session');
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${session.token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try { body = await res.json(); } catch { /* generic */ }
    throw new HttpError(res.status, body.error || 'Request failed', body.code);
  }
  return res.json() as Promise<T>;
}

export default function BookingDialog({ patient, facilityName, onClose, onBooked }: {
  patient: PatientDoc;
  facilityName: string;
  onClose: () => void;
  onBooked: (appointment: AppointmentDoc) => void;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => todayIso(), []);
  const [step, setStep] = useState<Step>('reason');
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const [facility, setFacility] = useState(facilityName);
  const [reasonsError, setReasonsError] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [weekStart, setWeekStart] = useState(today);
  const [slots, setSlots] = useState<PortalSlot[]>([]);
  // Loading is derived, not toggled: the week is loading whenever the slots
  // held were not fetched for the current reason + week (+ reload nonce).
  // Toggling a flag synchronously inside the fetch effect is the cascading-
  // render pattern the linter rejects.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [atHorizon, setAtHorizon] = useState(false);
  // Days this week the patient already has an open visit — no new request
  // can be made for them, so they are named rather than silently empty.
  const [ownVisitDates, setOwnVisitDates] = useState<string[]>([]);
  const [chosen, setChosen] = useState<PortalSlot | null>(null);
  const [phone, setPhone] = useState(patient.phone || '');
  const [pref, setPref] = useState<ContactPreference>('either');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callDate, setCallDate] = useState(today);
  const [notice, setNotice] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  // The session's patient object carries no phone, so the field opened empty
  // even when the record has one. Fill it from the profile unless the patient
  // has already started typing.
  useEffect(() => {
    if (patient.phone) return;
    let live = true;
    portalApi<{ profile?: { phone?: string } }>('/api/patient-portal/profile')
      .then(r => { if (live && r.profile?.phone) setPhone(current => current || r.profile!.phone!); })
      .catch(() => { /* the server falls back to the record's phone anyway */ });
    return () => { live = false; };
  }, [patient.phone]);

  useEffect(() => {
    let live = true;
    portalApi<{ facility?: { name?: string }; reasons: Reason[] }>('/api/patient-portal/booking/reasons')
      .then(r => { if (!live) return; setReasons(r.reasons || []); if (r.facility?.name) setFacility(r.facility.name); })
      .catch(() => { if (live) { setReasons([]); setReasonsError(t('patientPortal.bk.reasonsError')); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = useMemo(() => weekRange(weekStart), [weekStart]);

  // Only the newest slot request may write state: going Back and picking
  // another reason can leave an older fetch in flight, and its late answer
  // would show reason A's times under reason B.
  const slotRequest = useRef(0);
  const requestKey = reason ? `${reason.id}|${weekStart}|${reloadNonce}` : null;
  const loadingSlots = step === 'slots' && requestKey !== null && loadedKey !== requestKey;

  useEffect(() => {
    if (step !== 'slots' || !reason || !requestKey) return;
    const r = weekRange(weekStart);
    const mine = ++slotRequest.current;
    portalApi<{ slots: PortalSlot[]; to?: string; ownVisitDates?: string[] }>(
      `/api/patient-portal/booking/slots?reason=${encodeURIComponent(reason.id)}&from=${r.from}&to=${r.to}`,
    )
      .then(res => {
        if (mine !== slotRequest.current) return;
        setSlotsError(null);
        setSlots(res.slots || []);
        setOwnVisitDates(res.ownVisitDates || []);
        // The server clamps `to` at the booking horizon: once it comes back
        // short of this week's end there is nothing further to page to.
        setAtHorizon(!!res.to && res.to < r.to);
      })
      .catch(() => {
        if (mine !== slotRequest.current) return;
        setSlots([]);
        setSlotsError(t('patientPortal.bk.slotsError'));
      })
      .finally(() => { if (mine === slotRequest.current) setLoadedKey(requestKey); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, reason, weekStart, requestKey]);

  const days = useMemo(() => groupSlotsByDay(slots, range), [slots, range]);
  const weekHasSlots = slots.length > 0;

  const dayLabel = (iso: string) => {
    const d = parseIsoDate(iso);
    return `${WEEKDAYS[d.getDay()]} ${shortDate(iso)}`;
  };
  const doctor = (name: string) => (/^dr\.?\s/i.test(name) ? name : `${t('patientPortal.drPrefix')} ${name}`);

  const pickReason = (r: Reason) => { setNotice(null); setReason(r); setChosen(null); setAtHorizon(false); setWeekStart(today); setStep('slots'); };

  const submitSlot = async () => {
    if (!reason || !chosen || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { appointment } = await portalApi<{ appointment: AppointmentDoc }>('/api/patient-portal/appointments', {
        method: 'POST',
        body: JSON.stringify(buildSlotBody({ visitReasonId: reason.id, slot: chosen, phone, contactPreference: pref, notes })),
      });
      onBooked(appointment);
      setStep('done');
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        setChosen(null);
        setNotice(t('patientPortal.bk.taken'));
        setReloadNonce(n => n + 1);
        setStep('slots');
      } else {
        setError(e instanceof Error ? e.message : t('patientPortal.bookingRequestError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitCallMe = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { appointment } = await portalApi<{ appointment: AppointmentDoc }>('/api/patient-portal/appointments', {
        method: 'POST',
        body: JSON.stringify(buildLegacyBody({
          phone: phone || patient.phone || '',
          facilityId: patient.registrationHospital || '',
          facilityName: facility,
          date: callDate,
          reasonText: reason?.name || notes,
          state: patient.state || '',
        })),
      });
      onBooked(appointment);
      setAsked(true);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('patientPortal.bookingRequestError'));
    } finally {
      setSubmitting(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === 'confirm') setStep('slots');
    else if (step === 'slots') setStep('reason');
  };

  const callMeBlock = (
    <div className="pp-bk-callme">
      <p className="pp-bk-help">{t('patientPortal.bk.callMeHelp')}</p>
      <label className="pp-bk-label" htmlFor="bk-call-date">{t('patientPortal.preferredDate')}</label>
      <input id="bk-call-date" className="pp-bk-field" type="date" min={today} value={callDate} onChange={e => setCallDate(e.target.value)} />
      <label className="pp-bk-label" htmlFor="bk-call-phone">{t('patientPortal.bk.phone')}</label>
      <input id="bk-call-phone" className="pp-bk-field" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      {error && <p role="alert" className="pp-bk-error">{error}</p>}
      <button type="button" className="pp-btn pp-btn-secondary pp-bk-wide" onClick={submitCallMe} disabled={submitting || !callDate}>
        {submitting ? t('status.loading') : t('patientPortal.bk.callMe')}
      </button>
    </div>
  );

  const stepNo = step === 'reason' ? 1 : step === 'slots' ? 2 : step === 'confirm' ? 3 : 3;

  return (
    <Modal onClose={onClose}>
      <div className="modal-panel modal-panel--md pp-bk">
        <div className="pp-bk-head">
          <div className="pp-bk-title">
            {(step === 'slots' || step === 'confirm') && (
              <button type="button" className="pp-bk-icon-btn pp-bk-back" onClick={back} aria-label={t('action.back')}><ChevronLeft size={20} /></button>
            )}
            <h3>{t('patientPortal.requestAppointment')}</h3>
          </div>
          <button type="button" className="pp-bk-icon-btn pp-bk-close" onClick={onClose} aria-label={t('action.close')}><X size={18} /></button>
        </div>
        {facility && <p className="pp-bk-facility">{t('patientPortal.bookingAt', { facility })}</p>}
        {step !== 'done' && (
          <div className="pp-bk-steps" aria-hidden>
            {[1, 2, 3].map(n => <i key={n} className={n <= stepNo ? 'on' : ''} />)}
          </div>
        )}

        {step === 'reason' && (
          <div>
            <p className="pp-bk-q">{t('patientPortal.bk.whatFor')}</p>
            {reasons === null && <p className="pp-bk-help">{t('status.loading')}</p>}
            {reasons && reasons.length === 0 && (
              <>
                <p className="pp-bk-help">{reasonsError || t('patientPortal.bk.noReasons')}</p>
                {callMeBlock}
              </>
            )}
            <div className="pp-bk-reasons">
              {(reasons || []).map(r => (
                <button key={r.id} type="button" onClick={() => pickReason(r)} className="pp-bk-reason">
                  <span className="pp-bk-reason-text">
                    <b>{r.name}</b>
                    {r.description && <small>{r.description}</small>}
                  </span>
                  <span className="pp-bk-reason-min">{r.durationMinutes} {t('patientPortal.bk.min')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'slots' && reason && (
          <div>
            <p className="pp-bk-q">{reason.name}</p>
            <div className="pp-bk-week">
              <button type="button" className="pp-btn pp-btn-secondary pp-bk-nav" aria-label={t('patientPortal.bk.prevWeek')}
                disabled={weekStart <= today || loadingSlots} onClick={() => setWeekStart(prevWeekStart(weekStart, today))}><ChevronLeft size={16} /></button>
              <b>{shortDate(range.from)} – {shortDate(range.to)}</b>
              <button type="button" className="pp-btn pp-btn-secondary pp-bk-nav" aria-label={t('patientPortal.bk.nextWeek')}
                disabled={loadingSlots || atHorizon} onClick={() => setWeekStart(nextWeekStart(weekStart))}><ChevronRight size={16} /></button>
            </div>
            {notice && <p role="status" className="pp-bk-error pp-bk-error--strong">{notice}</p>}
            {slotsError && <p role="alert" className="pp-bk-error">{slotsError}</p>}
            {!loadingSlots && ownVisitDates.map(date => (
              <p key={date} className="pp-bk-help">{t('patientPortal.bk.ownVisitDay', { day: dayLabel(date) })}</p>
            ))}
            {loadingSlots ? (
              <p className="pp-bk-help pp-bk-loading"><Loader2 size={14} className="spin" /> {t('status.loading')}</p>
            ) : weekHasSlots ? (
              <div>
                {days.filter(d => d.slots.length > 0).map(d => (
                  <div key={d.date} className="pp-bk-day">
                    <p className="pp-bk-label">{dayLabel(d.date)}</p>
                    <div className="pp-bk-slots">
                      {d.slots.map(s => (
                        <button key={slotKey(s)} type="button" className="pp-bk-slot"
                          onClick={() => { setChosen(s); setStep('confirm'); }}>
                          <b>{formatClockTime(s.startTime)}</b>
                          <small>{doctor(s.providerName)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="pp-bk-hint">{t('patientPortal.bk.noneThisWeekHint')}</p>
              </div>
            ) : (
              !slotsError && <p className="pp-bk-help">{t('patientPortal.bk.noSlotsWeek')}</p>
            )}
            {!loadingSlots && !weekHasSlots && callMeBlock}
            {!loadingSlots && weekHasSlots && (
              <button type="button" className="pp-row-action pp-bk-link" onClick={() => setStep('reason')}>{t('patientPortal.bk.changeReason')}</button>
            )}
          </div>
        )}

        {step === 'confirm' && reason && chosen && (
          <div className="pp-bk-form">
            <div className="pp-bk-summary">
              <b>{reason.name}</b>
              <span>{dayLabel(chosen.date)} · {formatClockTime(chosen.startTime)}</span>
              <small>{doctor(chosen.providerName)}</small>
            </div>
            <div>
              <label className="pp-bk-label" htmlFor="bk-phone">{t('patientPortal.bk.phone')}</label>
              <input id="bk-phone" className="pp-bk-field" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <fieldset className="pp-bk-fieldset">
              <legend className="pp-bk-label">{t('patientPortal.bk.contactPref')}</legend>
              <div className="pp-bk-prefs">
                {([['call', t('patientPortal.bk.prefCall')], ['sms', t('patientPortal.bk.prefSms')], ['either', t('patientPortal.bk.prefEither')]] as const).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={pref === v} onClick={() => setPref(v)}
                    className={`pp-btn pp-bk-pref ${pref === v ? 'pp-btn-primary' : 'pp-btn-secondary'}`}>{label}</button>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="pp-bk-label" htmlFor="bk-notes">{t('patientPortal.bk.notes')}</label>
              <textarea id="bk-notes" className="pp-bk-field pp-bk-area" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('patientPortal.reasonPlaceholder')} />
            </div>
            <p className="pp-bk-hint">{t('patientPortal.bk.requestNote')}</p>
            {error && <p role="alert" className="pp-bk-error">{error}</p>}
            <button type="button" className="pp-btn pp-btn-primary pp-bk-wide" onClick={submitSlot} disabled={submitting}>
              {submitting ? t('status.loading') : t('patientPortal.submitRequest')}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="pp-bk-done">
            <CheckCircle2 size={44} />
            <h4>{t('patientPortal.bk.sentTitle')}</h4>
            {!asked && chosen && <p className="pp-bk-done-when">{dayLabel(chosen.date)} · {formatClockTime(chosen.startTime)} · {doctor(chosen.providerName)}</p>}
            <p className="pp-bk-help">{t('patientPortal.bk.sentBody')}</p>
            <button type="button" className="pp-btn pp-btn-primary pp-bk-wide" onClick={onClose}>{t('action.close')}</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
