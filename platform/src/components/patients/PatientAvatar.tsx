'use client';

import type { Patient } from '@/data/mock';

// Patient avatar in the shared dashboard style (.ehr-patient-icon): a flat
// rounded square — soft blue-grey fill with blue initials, or the patient's
// photo clipped to the same square. No coverage/presence dots and no
// per-patient colour coding; acuity tinting is passed explicitly via `color`
// (background fill, white text), exactly like the dashboard worklists.

function getInitials(p: { firstName?: string; surname?: string; name?: string }): string {
  if (p.firstName && p.surname) {
    return `${p.firstName[0]}${p.surname[0]}`.toUpperCase();
  }
  if (p.name) {
    const parts = p.name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return '?';
}

interface Props {
  patient: Pick<Patient, 'firstName' | 'surname'> & { payorInfo?: Patient['payorInfo']; photoUrl?: string };
  size?: number;
  /** Explicit fill override (e.g. acuity color in worklists) — white initials on that fill. */
  color?: string;
}

export default function PatientAvatar({ patient, size = 32, color: colorProp }: Props) {
  const initials = getInitials(patient);
  // Same proportions as .ehr-patient-icon (40px → 12px radius, 12px text).
  const borderRadius = Math.round(size * 0.3);
  const fontSize = Math.max(9, Math.round(size * 0.3));

  if (patient.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={patient.photoUrl}
        alt={initials}
        className="flex-shrink-0"
        style={{ width: size, height: size, borderRadius, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      className="flex-shrink-0 flex items-center justify-center select-none"
      style={{
        width: size,
        height: size,
        borderRadius,
        background: colorProp ?? '#E7EDF2',
        color: colorProp ? '#fff' : 'var(--ehr-blue, #144972)',
        fontSize,
        fontWeight: 800,
        letterSpacing: 0.3,
      }}
      aria-label={initials}
    >
      {initials}
    </div>
  );
}

export { getInitials };
