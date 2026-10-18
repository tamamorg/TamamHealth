/**
 * Overview vitals tiles: value, status tone from the platform's own vitals
 * flagging (no thresholds here), and the change since the previous visit.
 */
import { assessVitalsForDisplay, type VitalDisplayFlag } from '@/lib/clinical/vitals';

export interface VitalDef { key: string; label: string; unit: string }
/** `neutral`: not assessed (weight, height, or a value the flagging could not
 *  read) — the tile makes no range claim at all. */
export type VitalTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** The vitals assessVitalsForDisplay actually judges. */
const ASSESSED = new Set(['temperature', 'heartRate', 'respiratoryRate', 'oxygenSaturation', 'bloodPressure']);
export interface VitalTile {
  key: string;
  label: string;
  unit: string;
  value: string;
  tone: VitalTone;
  note?: string;
  /** "up 0.4", "down 2", "same" vs the previous visit, when both are numeric. */
  delta?: { dir: 'up' | 'down' | 'same'; amount: string };
}

type Raw = Record<string, string | number | undefined>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

export function ageInYears(dob: string | undefined, now = new Date()): number | undefined {
  if (!dob) return undefined;
  const d = new Date(`${dob.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a -= 1;
  return a >= 0 ? a : undefined;
}

export function buildVitalTiles(vitals: Raw, prev: Raw, defs: VitalDef[], age?: number): VitalTile[] {
  const bp = String(vitals.bloodPressure ?? '').match(/(\d+)\s*\/\s*(\d+)/);
  const flags = assessVitalsForDisplay({
    temperature: vitals.temperature,
    pulse: vitals.heartRate,
    respiratoryRate: vitals.respiratoryRate,
    oxygenSaturation: vitals.oxygenSaturation,
    ...(bp ? { systolic: bp[1], diastolic: bp[2] } : {}),
  }, age);
  const flagFor = (key: string): VitalDisplayFlag | undefined => {
    if (key === 'heartRate') return flags.pulse;
    if (key === 'bloodPressure') {
      const a = flags.systolic, b = flags.diastolic;
      return a && b ? (a.level === 'critical' ? a : b.level === 'critical' ? b : a) : a || b;
    }
    return (flags as Record<string, VitalDisplayFlag | undefined>)[key];
  };

  // null too: CouchDB keeps explicit nulls, which rendered as the text "null".
  return defs.filter(d => vitals[d.key] !== undefined && vitals[d.key] !== null && vitals[d.key] !== '').map(d => {
    const f = flagFor(d.key);
    const assessable = ASSESSED.has(d.key)
      && (d.key === 'bloodPressure' ? Boolean(bp) : num(vitals[d.key]) !== null);
    // "In normal range" is a clinical claim: only make it for a vital the
    // flagging judged and found nothing in.
    const tone: VitalTone = f ? (f.level === 'abnormal' ? 'warn' : 'bad') : assessable ? 'ok' : 'neutral';
    let delta: VitalTile['delta'];
    const cur = num(vitals[d.key]);
    const old = num(prev[d.key]);
    if (cur !== null && old !== null && d.key !== 'bloodPressure') {
      const diff = Math.round((cur - old) * 10) / 10;
      delta = { dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', amount: String(Math.abs(diff)) };
    }
    return { key: d.key, label: d.label, unit: d.unit, value: String(vitals[d.key]), tone, note: f?.message, delta };
  });
}
