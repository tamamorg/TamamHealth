'use client';

/**
 * Clinic hours for the day on screen: who works, from when to when, and
 * their breaks. The desk reads it before booking or sending a patient over
 * ("Dr. Wani is at lunch until 14:00"); for today each row says where the
 * clinician's day stands. A clinician can take their own hours off the day.
 *
 * Reads the same windows the booking wizard turns into slots, so what this
 * list shows and what the wizard offers cannot disagree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2 } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { clinicNow, clinicianDays, type ClinicianDay } from '@/lib/availability-plan';
import { describeError } from '@/lib/user-facing-error';
import { jubaTime } from '@/lib/time-juba';
import type { AvailabilityDoc } from '@/lib/db-types';
import './clinic-hours-panel.css';

/** The facility's wall clock, as the page's "today" (jubaDate) and the slot engine read it. */
const nowHHMM = jubaTime;

/** "Thu 5 Nov" for the day on screen, read as a calendar date (no timezone shift). */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function ClinicHoursPanel({ date, today, reloadKey = 0 }: { date: string; today: string; reloadKey?: number }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [windows, setWindows] = useState<AvailabilityDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [time, setTime] = useState(nowHHMM);

  const load = useCallback(async () => {
    if (!scope) return;
    try {
      const { getAvailabilityOnDate } = await import('@/lib/services/availability-service');
      const rows = await getAvailabilityOnDate(date, scope);
      // The desk's own facility: a clinician's hours elsewhere are not bookable here.
      setWindows(scope.hospitalId ? rows.filter(w => !w.facilityId || w.facilityId === scope.hospitalId) : rows);
    } catch (cause) {
      console.error(cause);
      setWindows([]);
    } finally {
      setLoading(false);
    }
  }, [date, scope]);

  useEffect(() => { void load(); }, [load, reloadKey]);
  useEffect(() => {
    let cancelled = false;
    let changes: { cancel: () => void } | undefined;
    void import('@/lib/db').then(({ availabilityDB }) => {
      if (cancelled) return;
      changes = availabilityDB().changes({ since: 'now', live: true, include_docs: false })
        .on('change', () => { void load(); })
        .on('error', () => undefined);
    });
    return () => { cancelled = true; try { changes?.cancel(); } catch { /* noop */ } };
  }, [load]);
  // Today's "at lunch until 14:00" has to move with the clock.
  useEffect(() => {
    if (date !== today) return;
    const id = window.setInterval(() => setTime(nowHHMM()), 60_000);
    return () => window.clearInterval(id);
  }, [date, today]);

  // No scope yet (signing in) reads as an empty day, not a stale one.
  const days = useMemo(() => (scope ? clinicianDays(windows, date) : []), [scope, windows, date]);

  const withdraw = async (day: ClinicianDay) => {
    if (!currentUser) return;
    const repeating = day.windows.some(w => w.recurrence);
    const ok = await confirm({
      title: t('clinicHours.removeConfirmTitle'),
      message: repeating ? t('clinicHours.removeConfirmRepeating', { hours: `${day.start}–${day.end}` }) : t('clinicHours.removeConfirmOnce', { hours: `${day.start}–${day.end}` }),
      confirmLabel: t('clinicHours.removeForDay'),
      tone: 'warning',
    });
    if (!ok) return;
    setRemoving(day.providerId);
    try {
      const { withdrawAvailabilityOn } = await import('@/lib/services/availability-service');
      for (const window of day.windows.filter((w, i, all) => !w.dayPlanId || all.findIndex(o => o.dayPlanId === w.dayPlanId) === i)) {
        await withdrawAvailabilityOn(window, date, currentUser._id, currentUser.name);
      }
      showToast(t('clinicHours.removedForDay'), 'success');
      await load();
    } catch (err) {
      showToast(describeError(err, t('clinicHours.removeFailed')), 'error');
    } finally {
      setRemoving(null);
    }
  };

  const status = (day: ClinicianDay) => {
    if (date !== today) return null;
    const now = clinicNow(day, time);
    if (now.state === 'before') return { tone: 'later', label: t('clinicHours.nowStarts', { time: day.start }) };
    if (now.state === 'after') return { tone: 'done', label: t('clinicHours.nowFinished') };
    if (now.state === 'break') return { tone: 'break', label: t('clinicHours.nowOnBreak', { kind: t(`clinicHours.break_${now.kind}`), time: now.until }) };
    return { tone: 'in', label: t('clinicHours.nowIn') };
  };

  return (
    <section className="chp" aria-labelledby="chp-title">
      <div className="chp-head">
        <h3 id="chp-title" className="chp-title"><Clock className="w-4 h-4" aria-hidden /> {t('ui.clinicHours')}</h3>
        <span className="chp-date">{date === today ? t('clinicHours.today') : dayLabel(date)}</span>
      </div>
      {loading ? (
        <p className="chp-empty"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('clinicHours.loading')}</p>
      ) : days.length === 0 ? (
        <p className="chp-empty">{t('clinicHours.noneForDay')}</p>
      ) : (
        <ul className="chp-list">
          {days.map(day => {
            const now = status(day);
            const own = day.providerId === currentUser?._id;
            return (
              <li key={day.providerId} className="chp-row">
                <div className="chp-line">
                  <span className="chp-name">{day.providerName}</span>
                  {now && <span className="chp-state" data-tone={now.tone}>{now.label}</span>}
                </div>
                <div className="chp-hours">
                  <b>{day.start}–{day.end}</b>
                  {day.department && <span> · {day.department}</span>}
                </div>
                {day.breaks.length > 0 && (
                  <ul className="chp-breaks" aria-label={t('clinicHours.sectionBreaks')}>
                    {day.breaks.map(b => (
                      <li key={`${b.start}-${b.end}`}>{t(`clinicHours.break_${b.kind}`)} {b.start}–{b.end}</li>
                    ))}
                  </ul>
                )}
                {own && (
                  <button type="button" className="chp-remove" disabled={removing === day.providerId} onClick={() => void withdraw(day)}>
                    {t('clinicHours.removeForDay')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
