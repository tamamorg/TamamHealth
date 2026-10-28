'use client';

/**
 * ChartHeader — the sticky Tamam O3-style patient header. Stage 1: visual
 * shell only. The triage badge / pregnancy pill are still owned by the page
 * (they carry their own popup state) and are passed in as rendered nodes so
 * that logic isn't duplicated or destabilized here.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon as DuotoneIcon } from '@/components/icons';
import { Stethoscope } from '@/components/icons/lucide';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { isNoAllergySentinel } from '@/lib/clinical-roles';
import { patientFullName, patientInitials, patientAgeLabel } from '@/lib/patient-utils';
import { formatDobOmrs } from '@/lib/date-utils';
import { formatMoney } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import { dismissBackdrop } from '@/lib/a11y';
import { orderBannerAllergies, type BannerAllergy } from './allergy-order';
import './chart-frame.css';
import './chart-tables.css';


interface ChartHeaderProps {
  patient: PatientDoc;
  pregnancyPill?: ReactNode;
  patientBalance: number;
  onCollectPayment: () => void;
  onMessage: () => void;
  onPrint: () => void;
  onPatientEd: () => void;
  /** Open the end-of-visit summary the patient takes home (print or text). */
  onVisitSummary?: () => void;
  onNote: () => void;
  onScripts: () => void;
  onOrders: () => void;
  onExchange: () => void;
  onEdit: () => void;
  /** Open the Start a visit workspace. Absent for roles that cannot check a
   *  patient in, so the menu never offers a visit they cannot open. */
  onStartVisit?: () => void;
  /** @deprecated No sticky-note model exists; the menu item was removed. */
  onStickyNote?: () => void;
  onAssignProvider?: () => void;
  /** End the standing care-team assignment — the exit for an assigned patient
   *  who left and never came back. Lives here in the chart's actions menu, not
   *  on the dashboard worklist rows: closing accountability for a patient is a
   *  decision made looking at their record, not in passing from a queue. The
   *  page owns the confirm-with-reason dialog and the write. */
  onEndAssignment?: () => void;
  /** Toggle the record's deceased status. The header renders the right verb
   *  for the current state — "Mark patient deceased" on a living record,
   *  "Mark patient alive" on one already marked — mirroring the O3 actions
   *  menu; the page owns the confirm dialog and the write. */
  onToggleDeceased?: () => void;
  /** Open the Allergies section. The banner names the allergens; the section
   *  carries severity, reaction and comments. */
  onShowAllergies?: () => void;
}

/** Active allergies for the banner, from the same source AllergiesSection and
 *  AllergyList read: `structuredAllergies` when the patient has been migrated,
 *  the legacy string list otherwise (no grading, so criticality is unknown).
 *  `undefined` means the record has never been assessed, which is NOT the same
 *  claim as "no known allergies" — the banner says so rather than implying the
 *  patient is safe. */
function activeAllergies(patient: PatientDoc): BannerAllergy[] | undefined {
  if (patient.structuredAllergies !== undefined) {
    return patient.structuredAllergies
      .filter(a => a.status === 'active')
      .map(a => ({ substance: a.substance, criticality: a.criticality }));
  }
  if (!patient.allergies) return undefined;
  return patient.allergies
    .filter(a => a && !isNoAllergySentinel(a))
    .map(substance => ({ substance }));
}

/** The banner's allergy line. Three states, deliberately distinct: allergies
 *  on record, an assessment that found none, and no assessment at all. Severe
 *  and ungraded allergies lead in bold; beyond the first three the rest fold
 *  into "+N more" (never hiding a severe/ungraded one). */
function AllergyBanner({ allergies, onShow }: { allergies?: BannerAllergy[]; onShow?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const has = !!allergies && allergies.length > 0;
  const { ordered, visibleCount } = orderBannerAllergies(allergies ?? []);
  const shown = expanded ? ordered : ordered.slice(0, visibleCount);
  const hidden = ordered.length - shown.length;

  const cls = [
    'tamam-allergy-banner',
    has ? 'tamam-allergy-banner--alert' : allergies === undefined ? 'tamam-allergy-banner--unknown' : '',
    onShow ? 'tamam-allergy-banner--link' : '',
  ].filter(Boolean).join(' ');

  const list = has ? (
    <span className="tamam-allergy-value">
      {shown.map((a, i) => (
        <span key={`${a.substance}-${i}`} className={a.highConcern ? 'tamam-allergy-item tamam-allergy-item--severe' : 'tamam-allergy-item'}>
          {a.substance}{i < shown.length - 1 ? ', ' : ''}
        </span>
      ))}
    </span>
  ) : (
    <span className="tamam-allergy-value">{allergies === undefined ? 'Not recorded' : 'No known allergies'}</span>
  );

  const lead = (
    <>
      <DuotoneIcon name={has ? 'alert' : 'shield'} size={14} />
      <span className="tamam-allergy-label">Allergies</span>
      {list}
    </>
  );

  // The "+N more" control is a sibling of the link button, never nested in it.
  return (
    <div className={cls}>
      {onShow ? (
        <button type="button" className="tamam-allergy-open" onClick={onShow}>{lead}</button>
      ) : lead}
      {has && ordered.length > visibleCount && (
        <button
          type="button"
          className="tamam-allergy-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Show less' : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

export default function ChartHeader({
  patient, pregnancyPill, patientBalance,
  onCollectPayment, onMessage, onPrint, onPatientEd, onVisitSummary, onExchange, onEdit, onStartVisit, onAssignProvider,
  onShowAllergies, onEndAssignment, onToggleDeceased,
}: ChartHeaderProps) {
  // Secondary actions live behind one ⋯ menu — the header previously stacked
  // up to 11 buttons in two rows, several of them duplicating the right-rail
  // workspace panels under different names.
  const [menuOpen, setMenuOpen] = useState(false);

  // Only surface the actions this role actually uses — e.g. a registration
  // clerk never writes clinical notes or prescriptions, so those buttons are
  // dropped rather than dead weight on the card.
  const {
    canSendMessages, canViewClinical, canManageReferrals, canRegisterPatients,
  } = usePermissions();
  const allergies = activeAllergies(patient);

  const initials = patientInitials(patient);
  const photoUrl = (patient as { photoUrl?: string }).photoUrl;
  const genderSymbol = patient.gender === 'Male' ? '♂' : patient.gender === 'Female' ? '♀' : null;
  const genderClass = patient.gender === 'Male' ? 'male' : patient.gender === 'Female' ? 'female' : '';
  const patientIdDisplay = patient.hospitalNumber || patient.geocodeId || '—';

  return (
    <div className="tamam-header">
      {/* No tint plate here: the chart's surfaces are white, so the disc is an
          outline and the initials carry the identification cue on their own.
          `avatarTint` still colours avatars in the lists, where a wall of rows
          needs the extra separation. */}
      <div className="tamam-avatar" aria-hidden>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" />
        ) : (
          initials
        )}
      </div>

      <div className="tamam-header-body">
        <div className="tamam-header-name-row">
          <h1 className="tamam-header-name">{patientFullName(patient)}</h1>
          {/* Death is a chart-critical fact — right beside the name, before
              anything else on the row, the way the O3 banner tags it. */}
          {patient.isDeceased && (
            <span className="tamam-chip tamam-chip--deceased">
              Deceased{patient.deceasedDate ? ` · ${formatDobOmrs(patient.deceasedDate)}` : ''}
            </span>
          )}
          {genderSymbol && (
            <span className={`tamam-gender ${genderClass}`}>
              <span className="tamam-gender-symbol" aria-hidden>{genderSymbol}</span>
              {patient.gender}
            </span>
          )}
          {pregnancyPill}
          {/* Top line, beside the name: allergies are the first thing read
              about a patient and the one item here that changes what is safe
              to prescribe. */}
          <AllergyBanner allergies={allergies} onShow={onShowAllergies} />
        </div>
        <div className="tamam-header-meta">
          {patientAgeLabel(patient)} &middot; {formatDobOmrs(patient.dateOfBirth)} &middot; Facility ID: {patientIdDisplay}
        </div>

        {/* Contact line — always on. It is two short fields, not enough to be
            worth a collapse control. */}
        <div className="tamam-header-details">
          <span>Phone: <strong>{patient.phone || '—'}</strong></span>
          <span>Location: <strong>{patient.state || '—'}{patient.county ? `, ${patient.county}` : ''}</strong></span>
        </div>
      </div>

      {/* Right column, stacked and right-aligned like the O3 banner: the
          actions on the first line, the balance chip beneath them on its own —
          it is a click target of the same kind (collect payment), so it belongs
          with the actions rather than in the identity chips beside the name. */}
      {/* `no-print` sits on the action cluster, not the column, so the balance
          below still prints with the chart. */}
      <div className="tamam-header-aside">
      <div className="tamam-header-actions no-print">

        {/* The banner carries no form buttons (O3): notes open from Clinical
            forms, prescribing and lab orders from the Order basket — both in
            the chart's right rail — and everything else sits under More. */}

        {/* Everything else behind one overflow menu. */}
        <div className="tamam-header-overflow">
          <button
            type="button"
            className="tamam-header-actions-btn"
            onClick={() => setMenuOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Actions"
            title="Actions"
          >
            <DuotoneIcon name="moreVertical" size={15} aria-hidden /> Actions
            <DuotoneIcon name="chevronDown" size={12} className="tamam-header-caret" aria-hidden />
          </button>
          {menuOpen && (
            <>
              <div className="tamam-header-overflow-backdrop" {...dismissBackdrop(() => setMenuOpen(false))} />
              <div className="tamam-actions-menu" role="menu">
                {canManageReferrals && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onExchange(); }}>
                    <DuotoneIcon name="arrowRightLeft" size={15} /> Refer patient
                  </button>
                )}
                {onStartVisit && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onStartVisit(); }}>
                    <DuotoneIcon name="calendar" size={15} /> Add visit
                  </button>
                )}
                {canSendMessages && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onMessage(); }}>
                    <DuotoneIcon name="message" size={15} /> Message patient
                  </button>
                )}
                {canViewClinical && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onPatientEd(); }}>
                    <DuotoneIcon name="fileText" size={15} /> Patient education
                  </button>
                )}
                {canViewClinical && onVisitSummary && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onVisitSummary(); }}>
                    <DuotoneIcon name="fileText" size={15} /> Visit summary
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onPrint(); }}>
                  <DuotoneIcon name="printer" size={15} /> Print chart
                </button>
                {onAssignProvider && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAssignProvider(); }}>
                    <Stethoscope className="w-3.5 h-3.5" /> {patient.assignedDoctor ? 'Reassign provider' : 'Assign provider'}
                  </button>
                )}
                {onEndAssignment && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEndAssignment(); }}>
                    <DuotoneIcon name="userX" size={15} /> End assignment
                  </button>
                )}
                {canRegisterPatients && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }}>
                    <DuotoneIcon name="edit" size={15} /> Edit details
                  </button>
                )}
                {/* One slot, two verbs: the O3 actions menu offers "Mark
                    patient deceased" on a living record and "Mark patient
                    alive" on a deceased one — never both. */}
                {onToggleDeceased && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onToggleDeceased(); }}>
                    <DuotoneIcon name="heart" size={15} /> {patient.isDeceased ? 'Mark patient alive' : 'Mark patient deceased'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

        <button
          type="button"
          className={patientBalance > 0 ? 'tamam-header-balance tamam-header-balance--due' : 'tamam-header-balance'}
          onClick={onCollectPayment}
        >
          <DuotoneIcon name="dollarSign" size={13} />
          <span className="tamam-allergy-label">Balance</span>
          {/* A negative balance is money the facility owes the patient (an
              overpayment, or a paid charge since reversed) — "-3,000 due"
              said the opposite. */}
          <span>{patientBalance < 0 ? `${formatMoney(Math.abs(patientBalance))} credit` : `${formatMoney(patientBalance)} due`}</span>
        </button>
      </div>
    </div>
  );
}
