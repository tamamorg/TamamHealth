'use client';

/**
 * ChartVitalsBand — sticky "Vitals and biometrics" band directly under the
 * patient header. Reads from the already-computed `latestVitals` (the most
 * recent medical record's vitalSigns) — no new data fetching here.
 *
 * Every reading is assessed before it is drawn. The band used to format the
 * numbers and nothing else, so a one-day-old at 40°C with a pulse of 73 read
 * exactly like a well adult: the first thing a clinician sees on opening the
 * chart said nothing was wrong. The assessment is `assessVitalsForDisplay` —
 * the same age- and pregnancy-aware IITT bands triage escalates on — so the
 * band can never disagree with the triage that put the patient in the queue.
 *
 * A flagged cell says it three ways, none of them colour alone: a tint, an
 * arrow for the direction (doubled when critical), and the reason on hover and
 * to a screen reader.
 */

import { AlertTriangle, Info, History, Activity } from '@/components/icons/lucide';
import { assessVitalsForDisplay, type VitalDisplayFlag, type VitalDisplayLevel } from '@/lib/clinical/vitals';
import { formatDateTime } from '@/lib/format-utils';
import { useNow } from '@/lib/hooks/useNow';

// Loosely typed — mirrors data/mock.ts VitalSigns, but every field is read
// defensively since records may have partial vitals.
type VitalsLike = Partial<{
  temperature: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  weight: number;
  height: number;
  bmi: number;
}>;

function fmt(value: number | undefined | null, unit: string): { value: string; unit: string } {
  if (value === undefined || value === null || Number.isNaN(value) || value === ('' as unknown)) {
    return { value: '--', unit: '' };
  }
  return { value: String(value), unit };
}

const LEVEL_RANK: Record<VitalDisplayLevel, number> = { abnormal: 1, high_risk: 2, critical: 3 };

/** BP is one cell fed by two readings — it takes the worse of the two. */
function worst(...flags: Array<VitalDisplayFlag | undefined>): VitalDisplayFlag | undefined {
  const found = flags.filter((flag): flag is VitalDisplayFlag => Boolean(flag));
  if (found.length === 0) return undefined;
  const top = found.reduce((a, b) => (LEVEL_RANK[b.level] > LEVEL_RANK[a.level] ? b : a));
  return { ...top, message: found.map(flag => flag.message).join(' ') };
}

function arrowFor(flag: VitalDisplayFlag): string {
  const glyph = flag.direction === 'high' ? '↑' : '↓';
  return flag.level === 'critical' ? glyph + glyph : glyph;
}

interface ChartVitalsBandProps {
  latestVitals: VitalsLike | undefined;
  latestRecordDate?: string;
  /**
   * FRACTIONAL years (`patientAgeYearsExact`) — the paediatric bands compare
   * against fractions of a year. Omit when the record carries no age: adult
   * ranges then apply, and each affected reading says so in its reason.
   */
  patientAgeYears?: number;
  /** Active pregnancy — IITT's blood-pressure RED rule is a pregnancy rule. */
  isPregnant?: boolean;
  onViewVitalsHistory: () => void;
  onRecordVitals: () => void;
  canRecordVitals: boolean;
}

export default function ChartVitalsBand({
  latestVitals, latestRecordDate, patientAgeYears, isPregnant,
  onViewVitalsHistory, onRecordVitals, canRecordVitals,
}: ChartVitalsBandProps) {
  // How old the last set of vitals is has to keep counting while the chart is
  // open, and must not differ between two renders of the same reading.
  const now = useNow(60_000);
  const recordTs = latestRecordDate ? new Date(latestRecordDate).getTime() : NaN;
  const hoursOld = Number.isNaN(recordTs) ? null : (now - recordTs) / 3600000;
  const isStale = hoursOld !== null && hoursOld > 16;
  let freshnessLabel = '';
  if (isStale && hoursOld !== null) {
    const days = Math.floor(hoursOld / 24);
    freshnessLabel = days >= 1
      ? `${days} day${days === 1 ? '' : 's'} old`
      : `${Math.floor(hoursOld)} hour${Math.floor(hoursOld) === 1 ? '' : 's'} old`;
  }

  const bmi = latestVitals?.bmi ?? (
    latestVitals?.weight && latestVitals?.height
      ? Number((latestVitals.weight / ((latestVitals.height / 100) ** 2)).toFixed(1))
      : undefined
  );

  const bp = latestVitals?.systolic && latestVitals?.diastolic
    ? { value: `${latestVitals.systolic}/${latestVitals.diastolic}`, unit: 'mmHg' }
    : { value: '--', unit: '' };

  const flags = latestVitals
    ? assessVitalsForDisplay(latestVitals, patientAgeYears, { isPregnant })
    : {};

  const cells: Array<{ label: string; value: string; unit: string; flag?: VitalDisplayFlag }> = [
    { label: 'BP', ...bp, flag: worst(flags.systolic, flags.diastolic) },
    { label: 'Heart rate', ...fmt(latestVitals?.pulse, 'beats/min'), flag: flags.pulse },
    { label: 'R. rate', ...fmt(latestVitals?.respiratoryRate, 'breaths/min'), flag: flags.respiratoryRate },
    { label: 'SpO2', ...fmt(latestVitals?.oxygenSaturation, '%'), flag: flags.oxygenSaturation },
    { label: 'Temp', ...fmt(latestVitals?.temperature, '°C'), flag: flags.temperature },
    { label: 'Weight', ...fmt(latestVitals?.weight, 'kg') },
    { label: 'Height', ...fmt(latestVitals?.height, 'cm') },
    { label: 'BMI', ...fmt(bmi, 'kg/m²') },
  ];

  // One line in the head for what the cells add up to — and for the one
  // finding that belongs to no cell: an infant whose AGE alone is a criterion.
  const flagged = cells.filter(cell => cell.flag);
  const ageFlag = flags.patientAge;
  const topLevel = [...flagged.map(cell => cell.flag!), ...(ageFlag ? [ageFlag] : [])]
    .reduce<VitalDisplayLevel | null>((top, flag) => (!top || LEVEL_RANK[flag.level] > LEVEL_RANK[top] ? flag.level : top), null);
  const alertText = topLevel === 'critical' ? 'Critical readings'
    : topLevel === 'high_risk' ? 'High-risk readings'
    : topLevel === 'abnormal' ? 'Outside normal range' : '';
  const alertReasons = [ageFlag?.message, ...flagged.map(cell => cell.flag!.message)].filter(Boolean).join(' ');

  return (
    <div className="tamam-vitals-band">
      <div className="tamam-vitals-head">
        <span className="tamam-vitals-title">Vitals and biometrics</span>
        {latestRecordDate && <span className="tamam-vitals-timestamp">{formatDateTime(latestRecordDate)}</span>}
        {isStale && <span className="tamam-vitals-fresh-pill">These vitals are {freshnessLabel}</span>}
        {topLevel && (
          <span className="tamam-vitals-alert" data-level={topLevel} role="status" title={alertReasons}>
            <AlertTriangle aria-hidden /> {alertText}
            {flagged.length > 0 && <b>{flagged.length}</b>}
          </span>
        )}
        <button type="button" className="tamam-vitals-link" onClick={onViewVitalsHistory}><History aria-hidden /> Vitals history</button>
        <span className="tamam-vitals-info" title="Latest recorded vital signs for this patient">
          <Info />
        </span>
        <span className="tamam-vitals-spacer" />
        {/* The arrow used to double as the permission cue; the button now says
            so directly by being disabled when vitals cannot be recorded. */}
        <button
          type="button"
          className="tamam-vitals-record-link"
          onClick={onRecordVitals}
          disabled={!canRecordVitals}
          title={canRecordVitals ? undefined : 'Requires vitals-recording permission'}
        >
          <Activity aria-hidden /> Record vitals
        </button>
      </div>
      <div className="tamam-vitals-grid">
        {cells.map(cell => (
          <div
            className="tamam-vitals-cell"
            key={cell.label}
            data-flag={cell.flag?.level}
            title={cell.flag?.message}
          >
            <div className="tamam-vitals-label">{cell.label}</div>
            <div className="tamam-vitals-value">
              {cell.value}
              {cell.unit && <span className="tamam-vitals-unit">{cell.unit}</span>}
              {cell.flag && (
                <span className="tamam-vitals-arrow" aria-hidden>{arrowFor(cell.flag)}</span>
              )}
            </div>
            {/* The tint and arrow are for the eye; this is the same finding for
                a screen reader, which gets neither. */}
            {cell.flag && <span className="tamam-vitals-sr">{cell.flag.message}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
