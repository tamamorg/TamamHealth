'use client';

/**
 * ChartHeader — the sticky OpenMRS O3-style patient header. Stage 1: visual
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
import type { PatientDoc } from '@/lib/db-types';
import { dismissBackdrop } from '@/lib/a11y';


interface ChartHeaderProps {
  patient: PatientDoc;
  pregnancyPill?: ReactNode;
  patientBalance: number;
  onCollectPayment: () => void;
  onMessage: () => void;
  onPrint: () => void;
  onPatientEd: () => void;
  onNote: () => void;
  onScripts: () => void;
  onOrders: () => void;
  onExchange: () => void;
  onEdit: () => void;
  onStickyNote: () => void;
  onAssignProvider?: () => void;
  /** Open the Allergies section. The banner names the allergens; the section
   *  carries severity, reaction and comments. */
  onShowAllergies?: () => void;
}

/** Active allergens for the banner, from the same source AllergiesSection and
 *  AllergyList read: `structuredAllergies` when the patient has been migrated,
 *  the legacy string list otherwise. `undefined` means the record has never
 *  been assessed, which is NOT the same claim as "no known allergies" — the
 *  banner says so rather than implying the patient is safe. */
function activeAllergens(patient: PatientDoc): string[] | undefined {
  if (patient.structuredAllergies !== undefined) {
    return patient.structuredAllergies.filter(a => a.status === 'active').map(a => a.substance);
  }
  if (!patient.allergies) return undefined;
  return patient.allergies.filter(a => a && !isNoAllergySentinel(a));
}

/** The banner's allergy line. Three states, deliberately distinct: allergies
 *  on record, an assessment that found none, and no assessment at all. */
function AllergyBanner({ allergens, onShow }: { allergens?: string[]; onShow?: () => void }) {
  const has = !!allergens && allergens.length > 0;

  // Every allergen, not a truncated head with a "+N more" — the one the
  // clinician needs is as likely to be fourth as first, and a count is not
  // something you can check a prescription against.
  const label = has
    ? allergens!.join(', ')
    : allergens === undefined
      ? 'Not recorded'
      : 'No known allergies';

  const cls = [
    'omrs-allergy-banner',
    has ? 'omrs-allergy-banner--alert' : allergens === undefined ? 'omrs-allergy-banner--unknown' : '',
    onShow ? 'omrs-allergy-banner--link' : '',
  ].filter(Boolean).join(' ');

  const body = (
    <>
      <DuotoneIcon name={has ? 'alert' : 'shield'} size={14} />
      <span className="omrs-allergy-label">Allergies</span>
      <span className="omrs-allergy-value">{label}</span>
    </>
  );

  if (!onShow) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={onShow}>
      {body}
    </button>
  );
}

export default function ChartHeader({
  patient, pregnancyPill, patientBalance,
  onCollectPayment, onMessage, onPrint, onPatientEd, onNote, onScripts, onOrders, onExchange, onEdit, onStickyNote, onAssignProvider,
  onShowAllergies,
}: ChartHeaderProps) {
  // Secondary actions live behind one ⋯ menu — the header previously stacked
  // up to 11 buttons in two rows, several of them duplicating the right-rail
  // workspace panels under different names.
  const [menuOpen, setMenuOpen] = useState(false);

  // Only surface the actions this role actually uses — e.g. a registration
  // clerk never writes clinical notes or prescriptions, so those buttons are
  // dropped rather than dead weight on the card.
  const {
    canSendMessages, canViewClinical, canPrescribe, canDispense,
    canOrderLabs, canEnterLabResults, canManageReferrals, canRegisterPatients,
  } = usePermissions();
  const allergens = activeAllergens(patient);

  const initials = patientInitials(patient);
  const photoUrl = (patient as { photoUrl?: string }).photoUrl;
  const genderSymbol = patient.gender === 'Male' ? '♂' : patient.gender === 'Female' ? '♀' : null;
  const genderClass = patient.gender === 'Male' ? 'male' : patient.gender === 'Female' ? 'female' : '';
  const patientIdDisplay = patient.hospitalNumber || patient.geocodeId || '—';

  return (
    <div className="omrs-header">
      {/* No tint plate here: the chart's surfaces are white, so the disc is an
          outline and the initials carry the identification cue on their own.
          `avatarTint` still colours avatars in the lists, where a wall of rows
          needs the extra separation. */}
      <div className="omrs-avatar" aria-hidden>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" />
        ) : (
          initials
        )}
      </div>

      <div className="omrs-header-body">
        <div className="omrs-header-name-row">
          <h1 className="omrs-header-name">{patientFullName(patient)}</h1>
          {genderSymbol && (
            <span className={`omrs-gender ${genderClass}`}>
              <span className="omrs-gender-symbol" aria-hidden>{genderSymbol}</span>
              {patient.gender}
            </span>
          )}
          {pregnancyPill}
          {/* Top line, beside the name: allergies are the first thing read
              about a patient and the one item here that changes what is safe
              to prescribe. */}
          <AllergyBanner allergens={allergens} onShow={onShowAllergies} />
        </div>
        <div className="omrs-header-meta">
          {patientAgeLabel(patient)} &middot; {formatDobOmrs(patient.dateOfBirth)} &middot; Facility ID: {patientIdDisplay}
        </div>

        {/* Contact line — always on. It is two short fields, not enough to be
            worth a collapse control. */}
        <div className="omrs-header-details">
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
      <div className="omrs-header-aside">
      <div className="omrs-header-actions no-print">

        {/* Primary clinical actions — one clear verb each. */}
        {canViewClinical && (
          <button type="button" className="omrs-header-actions-btn" onClick={onNote}><DuotoneIcon name="prescription" size={15} /> + Note</button>
        )}
        {(canPrescribe || canDispense) && (
          <button type="button" className="omrs-header-actions-btn" onClick={onScripts}><DuotoneIcon name="pill" size={15} /> Prescribe</button>
        )}
        {(canOrderLabs || canEnterLabResults) && (
          <button type="button" className="omrs-header-actions-btn" onClick={onOrders}><DuotoneIcon name="flask" size={15} /> Order labs</button>
        )}
        {canManageReferrals && (
          <button type="button" className="omrs-header-actions-btn" onClick={onExchange}><DuotoneIcon name="arrowRightLeft" size={15} /> Refer</button>
        )}

        {/* Everything else behind one overflow menu. */}
        <div className="omrs-header-overflow">
          <button
            type="button"
            className="omrs-header-actions-btn"
            onClick={() => setMenuOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
            title="More actions"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="omrs-header-overflow-backdrop" {...dismissBackdrop(() => setMenuOpen(false))} />
              <div className="omrs-actions-menu" role="menu">
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
                {canViewClinical && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onStickyNote(); }}>
                    <DuotoneIcon name="record" size={15} /> Patient notes
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
                {canRegisterPatients && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }}>
                    <DuotoneIcon name="edit" size={15} /> Edit details
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

        <button
          type="button"
          className={patientBalance > 0 ? 'omrs-header-balance omrs-header-balance--due' : 'omrs-header-balance'}
          onClick={onCollectPayment}
        >
          <DuotoneIcon name="dollarSign" size={13} />
          <span className="omrs-allergy-label">Balance</span>
          <span>${patientBalance.toFixed(2)} due</span>
        </button>
      </div>
    </div>
  );
}
