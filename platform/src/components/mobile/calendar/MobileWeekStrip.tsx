'use client';

import { addDays, format, isSameDay, isToday, startOfWeek } from 'date-fns';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface MobileWeekStripProps {
  selectedDay: string;
  onSelect: (day: string) => void;
  /** Days (YYYY-MM-DD) that have at least one appointment — drives the dot indicator. */
  daysWithAppointments: Set<string>;
}

export default function MobileWeekStrip({ selectedDay, onSelect, daysWithAppointments }: MobileWeekStripProps) {
  const { t } = useTranslation();
  const selectedDate = new Date(`${selectedDay}T00:00:00`);
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="mobile-week-strip">
      <div className="mobile-week-strip-nav">
        <button type="button" onClick={() => onSelect(format(addDays(selectedDate, -7), 'yyyy-MM-dd'))} aria-label={t('patientPortal.bk.prevWeek')}>‹</button>
        <span>{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}</span>
        <button type="button" onClick={() => onSelect(format(addDays(selectedDate, 7), 'yyyy-MM-dd'))} aria-label={t('patientPortal.bk.nextWeek')}>›</button>
      </div>
      <div className="mobile-week-strip-days">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const selected = isSameDay(d, selectedDate);
          return (
            <button
              key={key}
              type="button"
              className={`mobile-week-day ${selected ? 'selected' : ''} ${isToday(d) ? 'today' : ''}`}
              onClick={() => onSelect(key)}
            >
              <small>{format(d, 'EEE').toUpperCase()}</small>
              <b>{format(d, 'd')}</b>
              <i className={daysWithAppointments.has(key) ? 'has-dot' : ''} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
