'use client';

/**
 * Clinic hours: a clinician publishes the day they will keep, with its
 * breaks, once or on repeat. The desk books patients into it (the booking
 * wizard's slots) and sees it on the Appointments page's Clinic hours list.
 *
 * 2026-11-04 (user: "a doctor can specify their availability through the day
 * and their breaks etc and it should be visible to the frontdesk"). It was one
 * start/end pair defaulting to "now" and "now + 3 hours", so in the evening the
 * end landed before the start and the form refused itself; a lunch break meant
 * publishing two windows by hand; and nothing showed the desk what had been
 * published. Now the day's hours, less its breaks, are written as one plan
 * (lib/availability-plan.ts), and the slot engine never offers a break.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { Clock, Loader2, Check, Plus, X } from '@/components/icons/lucide';
import Select from '@/components/Select';
import DepartmentSelect from '@/components/DepartmentSelect';
import FormSlider from '@/components/overlay/FormSlider';
import { FormError } from '@/components/overlay/FormNotices';
import { jubaDate, jubaNow } from '@/lib/time-juba';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  BREAK_KINDS, countSlots, planSegments, validateDayPlan, weekdayOf,
} from '@/lib/availability-plan';
import type { AvailabilityBreak } from '@/lib/db-types';
import './availability-plan.css';

const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];
type Repeat = 'once' | 'weekdays' | 'custom';
/** Monday first, as a clinic week is read. */
const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Today at the facility, or tomorrow once today's default hours are over.
 * Facility time, not the device's: the Appointments page, the slot engine
 * and the desk's Clinic hours list all read the day in Africa/Juba.
 */
function firstDay(): string {
  const today = jubaDate();
  return jubaNow().getHours() >= 17 ? addDays(today, 1) : today;
}

export default function AvailabilityModal({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const today = jubaDate();

  const [date, setDate] = useState(firstDay);
  const [repeat, setRepeat] = useState<Repeat>('once');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [until, setUntil] = useState(() => addDays(firstDay(), 27));
  const [dayStart, setDayStart] = useState('08:00');
  const [dayEnd, setDayEnd] = useState('17:00');
  const [breaks, setBreaks] = useState<AvailabilityBreak[]>([{ kind: 'lunch', start: '13:00', end: '14:00' }]);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [department, setDepartment] = useState(currentUser?.department ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [badBreak, setBadBreak] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const plan = { start: dayStart, end: dayEnd, breaks, slotMinutes };
  const problem = validateDayPlan(plan);
  const segments = useMemo(() => (problem ? [] : planSegments(dayStart, dayEnd, breaks)), [problem, dayStart, dayEnd, breaks]);
  const slots = problem ? 0 : countSlots(segments, slotMinutes);
  const weekdays = repeat === 'weekdays' ? [1, 2, 3, 4, 5] : days;

  const setBreak = (index: number, patch: Partial<AvailabilityBreak>) => {
    setBadBreak(null);
    setBreaks(list => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const addBreak = () => {
    // After the last break (or mid-morning), clamped inside the day.
    const last = [...breaks].sort((a, b) => a.end.localeCompare(b.end)).at(-1);
    const start = last ? last.end : '10:30';
    const [h, m] = start.split(':').map(Number);
    const endMinutes = Math.min(h * 60 + m + 30, 23 * 60 + 59);
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    setBreaks(list => [...list, { kind: 'tea', start, end }]);
  };

  const handleSubmit = async () => {
    setError('');
    setBadBreak(null);
    if (!currentUser) return;
    if (problem) {
      setError(t(problem.problem));
      setBadBreak(problem.breakIndex ?? null);
      return;
    }
    if (repeat !== 'once' && !weekdays.length) { setError(t('clinicHours.errorNoDays')); return; }
    if (repeat !== 'once' && (!until || until < date)) { setError(t('clinicHours.errorUntil')); return; }
    // A repeat whose first day is not one of its weekdays would still
    // publish that first day: start the series on its first real day.
    let first = date;
    if (repeat !== 'once') {
      for (let i = 0; i < 7 && !weekdays.includes(weekdayOf(first)); i += 1) first = addDays(first, 1);
    }
    setSaving(true);
    try {
      const { createAvailabilityPlan } = await import('@/lib/services/availability-service');
      await createAvailabilityPlan(
        {
          providerId: currentUser._id,
          providerName: currentUser.name,
          facilityId: currentUser.hospitalId || '',
          facilityName: currentUser.hospitalName || currentUser.organization?.name || '',
          date: first,
          dayStart,
          dayEnd,
          breaks,
          slotMinutes,
          modality: 'in_person' as const,
          department: department.trim() || undefined,
          notes: notes.trim() || undefined,
          orgId: currentUser.orgId,
          payam: currentUser.payam,
          recurrence: repeat === 'once' ? undefined : { daysOfWeek: [...weekdays].sort(), until },
        },
        currentUser._id,
        currentUser.name,
      );
      onCreated?.();
      onClose();
    } catch (err) {
      const known = (err as { problem?: string })?.problem;
      setError(known ? t(known) : describeError(err, t('msg.availabilityNotAddedTryAgain')));
      setSaving(false);
    }
  };

  return (
    <FormSlider
      title={t('ui.clinicHours')}
      subtitle={currentUser?.hospitalName
        ? t('clinicHours.subtitleAt', { name: currentUser?.name ?? '', facility: currentUser.hospitalName })
        : currentUser?.name}
      width={480}
      onClose={onClose}
      busy={saving}
      footer={<>
        <button type="button" onClick={onClose} className="btn btn-secondary">{t('action.cancel')}</button>
        <button type="button" onClick={handleSubmit} disabled={saving} className="btn btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />}
          {t('ui.publishClinicHours')}
        </button>
      </>}
    >
      {error && <FormError message={error} />}
      <div className="avp">
        <section className="avp-section">
          <h3 className="avp-heading">{t('clinicHours.sectionWhen')}</h3>
          <div className="avp-row">
            <label className="avp-field">
              <span className="avp-label">{repeat === 'once' ? t('clinicHours.date') : t('clinicHours.startsOn')}</span>
              <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} />
            </label>
            <label className="avp-field">
              <span className="avp-label">{t('clinicHours.repeats')}</span>
              <Select value={repeat} onChange={e => setRepeat(e.target.value as Repeat)}>
                <option value="once">{t('clinicHours.repeatOnce')}</option>
                <option value="weekdays">{t('clinicHours.repeatWeekdays')}</option>
                <option value="custom">{t('clinicHours.repeatCustom')}</option>
              </Select>
            </label>
          </div>
          {repeat === 'custom' && (
            <div className="avp-field">
              <span className="avp-label" id="avp-days">{t('clinicHours.onDays')}</span>
              <div className="avp-days" role="group" aria-labelledby="avp-days">
                {WEEK.map(day => {
                  const on = days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className="avp-day"
                      aria-pressed={on}
                      onClick={() => setDays(list => (on ? list.filter(d => d !== day) : [...list, day]))}
                    >
                      {t(`clinicHours.day${day}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {repeat !== 'once' && (
            <label className="avp-field avp-field--half">
              <span className="avp-label">{t('clinicHours.until')}</span>
              <input type="date" value={until} min={date} onChange={e => setUntil(e.target.value)} />
            </label>
          )}
        </section>

        <section className="avp-section">
          <h3 className="avp-heading">{t('clinicHours.sectionHours')}</h3>
          <div className="avp-row">
            <label className="avp-field">
              <span className="avp-label">{t('clinicHours.starts')}</span>
              <input type="time" value={dayStart} onChange={e => setDayStart(e.target.value)} />
            </label>
            <label className="avp-field">
              <span className="avp-label">{t('clinicHours.ends')}</span>
              <input type="time" value={dayEnd} onChange={e => setDayEnd(e.target.value)} />
            </label>
          </div>
          <label className="avp-field avp-field--half">
            <span className="avp-label">{t('ui.slotLength')}</span>
            <Select value={slotMinutes} onChange={e => setSlotMinutes(Number(e.target.value))}>
              {SLOT_OPTIONS.map(s => <option key={s} value={s}>{t('clinicHours.minutes', { count: s })}</option>)}
            </Select>
          </label>
        </section>

        <section className="avp-section">
          <div className="avp-section-head">
            <h3 className="avp-heading">{t('clinicHours.sectionBreaks')}</h3>
            <button type="button" className="avp-add" onClick={addBreak}>
              <Plus className="w-4 h-4" aria-hidden /> {t('clinicHours.addBreak')}
            </button>
          </div>
          {breaks.length === 0 ? (
            <p className="avp-muted">{t('clinicHours.noBreaks')}</p>
          ) : (
            <ul className="avp-breaks">
              {breaks.map((item, index) => (
                <li key={index} className="avp-break" data-invalid={badBreak === index || undefined}>
                  <label className="avp-field">
                    <span className="avp-label">{t('clinicHours.breakKind')}</span>
                    <Select value={item.kind} onChange={e => setBreak(index, { kind: e.target.value as AvailabilityBreak['kind'] })}>
                      {BREAK_KINDS.map(kind => <option key={kind} value={kind}>{t(`clinicHours.break_${kind}`)}</option>)}
                    </Select>
                  </label>
                  <label className="avp-field">
                    <span className="avp-label">{t('clinicHours.from')}</span>
                    <input type="time" value={item.start} aria-invalid={badBreak === index || undefined} onChange={e => setBreak(index, { start: e.target.value })} />
                  </label>
                  <label className="avp-field">
                    <span className="avp-label">{t('clinicHours.to')}</span>
                    <input type="time" value={item.end} aria-invalid={badBreak === index || undefined} onChange={e => setBreak(index, { end: e.target.value })} />
                  </label>
                  <button
                    type="button"
                    className="avp-remove"
                    aria-label={t('clinicHours.removeBreak', { kind: t(`clinicHours.break_${item.kind}`) })}
                    onClick={() => { setBadBreak(null); setBreaks(list => list.filter((_, i) => i !== index)); }}
                  >
                    <X className="w-4 h-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="avp-section">
          <h3 className="avp-heading">{t('clinicHours.sectionDetails')}</h3>
          <label className="avp-field">
            <span className="avp-label">{t('ui.departmentOptional')}</span>
            <DepartmentSelect value={department} facilityId={currentUser?.hospitalId} onChange={name => setDepartment(name)} />
          </label>
          <label className="avp-field">
            <span className="avp-label">{t('nurse.notesOptional')}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </label>
        </section>

        {/* What the desk will be able to book, worked out as you type. */}
        <div className="avp-summary" aria-live="polite">
          <Clock className="w-4 h-4" aria-hidden />
          {problem ? (
            <span>{t('clinicHours.summaryFix')}</span>
          ) : (
            <span>
              <b>{t('clinicHours.summaryBookable', { ranges: segments.map(s => `${s.start}–${s.end}`).join(', ') })}</b>
              {' · '}{t('clinicHours.summarySlots', { count: slots, minutes: slotMinutes })}
              <br />{t('clinicHours.summaryDesk')}
            </span>
          )}
        </div>
      </div>
    </FormSlider>
  );
}
