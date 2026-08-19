import Link from 'next/link';
import type { Patient } from '@/data/mock';
import { avatarTint, initials, patientDisplayName, shortenPersonName } from '@/lib/patient-utils';

/** Minimal shape needed to render a patient's name. */
export type PatientNameLike = Pick<Patient, 'firstName' | 'surname'> & {
  middleName?: string;
  gender?: string;
  photoUrl?: string;
};

/**
 * Canonical patient identity label: the patient's full name. Use this
 * EVERYWHERE a patient is listed so the style is identical across the app
 * (queues, tables, cards, feeds, pickers).
 *
 * Pass either a `patient` object OR a plain `name` string (for queues/records
 * that only carry the name).
 *
 * When `patientId` is provided, the name renders as a link to that patient's
 * record (`/patients/{id}`) so a patient is clickable everywhere they appear.
 * Omit `patientId` (e.g. demo rows with no real record) to render plain text.
 */
export default function PatientName({
  patient,
  name,
  patientId,
  size,
  showAvatar = false,
  secondaryText,
  nameClassName = 'text-sm',
  className = '',
}: {
  patient?: PatientNameLike;
  name?: string;
  /** When set, the name links to `/patients/{patientId}`. */
  patientId?: string;
  gender?: string;
  size?: number;
  showAvatar?: boolean;
  secondaryText?: string;
  nameClassName?: string;
  className?: string;
}) {
  // Two names everywhere a patient is LISTED — first and surname. The chart
  // (and printed documents) keep the full legal name; this component is the
  // list identity, so the rule lives here once for every consumer.
  const displayName = patient ? patientDisplayName(patient) : (shortenPersonName(name) || 'Unknown');
  const avatarSize = size || 28;
  const nameLink = patientId ? (
    <Link
      href={`/patients/${patientId}`}
      onClick={(e) => e.stopPropagation()}
      className={`font-semibold truncate hover:underline ${nameClassName}`}
      style={{ color: 'var(--text-primary)' }}
    >
      {displayName}
    </Link>
  ) : (
    <span className={`font-semibold truncate ${nameClassName}`} style={{ color: 'var(--text-primary)' }}>
      {displayName}
    </span>
  );
  return (
    <span className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      {showAvatar && (
        patient?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={patient.photoUrl}
            alt={initials(displayName)}
            className="ehr-patient-icon flex-shrink-0 object-cover"
            style={{ width: avatarSize, height: avatarSize }}
          />
        ) : (
          <span
            className="ehr-patient-icon flex-shrink-0"
            style={{ ...avatarTint(displayName), width: avatarSize, height: avatarSize, fontSize: Math.max(9, Math.round(avatarSize * 0.3)) }}
            aria-hidden="true"
          >
            {initials(displayName)}
          </span>
        )
      )}
      {showAvatar ? (
        <span className="flex min-w-0 flex-col items-start">
          {nameLink}
          {secondaryText && (
            <span className="mt-0.5 truncate text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {secondaryText}
            </span>
          )}
        </span>
      ) : nameLink}
    </span>
  );
}
