'use client';

/**
 * One labelled field: the label, the control, and the message when it is
 * wrong.
 *
 * This exists because the three were written out by hand at every field, and
 * the hand slipped. Three fields — Estimated Age, County and Relationship —
 * computed a validation error that blocked the submit but rendered no message
 * anywhere, so the form refused to save and said nothing about which field or
 * why. Twelve more (all of Next of Kin and Payment Coverage) had a `<label>`
 * with no `htmlFor` and a control with no `id`, so clicking the label did
 * nothing and a screen reader read the control unnamed.
 *
 * Passing the control as a function of the props it must carry is what makes
 * those unrepresentable: the id, the aria wiring and the error element are
 * derived from `name` and `error` in one place, and a caller cannot forget
 * them because it never writes them.
 *
 *   <RegistrationField name="surname" label={t('patientNew.surname')}
 *                      error={errors.surname} required>
 *     {field => <input {...field} type="text" value={form.surname}
 *                      onChange={e => update('surname', e.target.value)} />}
 *   </RegistrationField>
 *
 * `data-field` carries the FORM KEY, not the DOM id. `validateAll` scrolls to
 * `[data-field="<first errored key>"]`; that attribute had never been rendered
 * on anything, so the lookup always missed and a failed submit dropped the
 * clerk at the top of a section instead of on the field.
 */

import type { ReactNode } from 'react';

/** The props a control must spread to be labelled and announced correctly. */
export interface RegistrationFieldControl {
  id: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
  'aria-describedby'?: string;
}

export interface RegistrationFieldProps {
  /**
   * The form key this field writes to — `surname`, `nokPhone`,
   * `additionalNok.0.phone`. Drives the DOM id, the label association and the
   * `data-field` hook validation scrolls to, so it must match the key
   * `validateSection` puts its error under.
   */
  name: string;
  label: string;
  /** Message for this field from the last validation, if any. */
  error?: string;
  /** Appends the required marker to the label and sets `aria-required`. */
  required?: boolean;
  /** Extra classes on the wrapper (grid spans, spacing). */
  className?: string;
  children: (field: RegistrationFieldControl) => ReactNode;
}

/**
 * The marker for a required field. Lives here rather than inside the
 * translated label strings: half of them used to carry a trailing " *" and
 * half had one appended in JSX, which rendered "Full Name * *" wherever the
 * two met, and leaked an asterisk into the review read-back — where nothing
 * is required and the mark means nothing.
 */
export default function RegistrationField({
  name, label, error, required, className, children,
}: RegistrationFieldProps) {
  // Dots are legal in an id but need escaping in a CSS selector, and the
  // additional-contact keys carry them (`additionalNok.0.phone`).
  const id = `pt-${name.replace(/\./g, '-')}`;
  const errorId = `${id}-error`;
  return (
    <div className={className ? `registration-field ${className}` : 'registration-field'} data-field={name}>
      <label htmlFor={id} className={required ? 'field-required' : undefined}>{label}</label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })}
      {error && (
        <p id={errorId} className="registration-field-error" role="alert">{error}</p>
      )}
    </div>
  );
}
