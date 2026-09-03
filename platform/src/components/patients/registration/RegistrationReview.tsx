'use client';

/**
 * The registration read-back — a step, not a section of the form.
 *
 * Review used to sit at the bottom of the scrolling form from the moment the
 * page opened, so the clerk scrolled past a summary of fields they had not
 * filled yet ("DOB: ~ years / Gender:" before a name had been typed). It now
 * replaces the form once every required field is answered.
 *
 * It reads back EVERY field rather than a digest, grouped under the heading it
 * was filled in under, because this is the moment the record is checked against
 * the person standing at the desk. A field left blank shows an em dash instead
 * of vanishing — "not recorded" is itself worth seeing before committing.
 *
 * Presentational: the caller supplies the groups (see `buildReviewGroups`) and
 * handles Edit, so nothing here knows about form state.
 */

import type { ReactNode } from 'react';
import type { ReviewGroup } from './review-groups';

export interface RegistrationReviewProps {
  /** Section heading for the step, e.g. `t('patientNew.stepReview')`. */
  title: string;
  /** Eyebrow above the name, e.g. `t('patientNew.finalCheck')`. */
  eyebrow: string;
  /** The patient's assembled name, or a fallback heading when it is empty. */
  heading: string;
  photoUrl: string | null;
  photoAlt: string;
  groups: ReviewGroup[];
  /** Label for each group's edit affordance, e.g. `t('action.edit')`. */
  editLabel: string;
  /** Jump back to the form at that section. */
  onEdit: (sectionIndex: number) => void;
  /**
   * Rendered above the read-back — the duplicate-record warning. It sits here
   * rather than at the top of the step because the clerk should see who they
   * are about to create before being told someone like them already exists.
   */
  notice?: ReactNode;
}

export default function RegistrationReview({
  title, eyebrow, heading, photoUrl, photoAlt, groups, editLabel, onEdit, notice,
}: RegistrationReviewProps) {
  return (
    <section className="registration-section tamam-reg-section tamam-reg-review" id="reg-review">
      <header className="tamam-reg-sectionhead">
        <h2>{title}</h2>
      </header>

      <div className="registration-review-heading">
        <div className="tamam-reg-reviewavatar">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={photoAlt} />
          ) : (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
          )}
        </div>
        <div>
          <p>{eyebrow}</p>
          <h3>{heading}</h3>
        </div>
      </div>

      {notice}

      <div className="tamam-reg-reviewgroups">
        {groups.map(group => (
          <section key={group.section} className="tamam-reg-reviewgroup">
            <header>
              <h4>{group.title}</h4>
              <button type="button" onClick={() => onEdit(group.section)}>
                {editLabel}
              </button>
            </header>
            <dl>
              {group.rows.map(([label, value]) => (
                <div key={label} className={value ? undefined : 'is-empty'}>
                  <dt>{label}</dt>
                  <dd>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
