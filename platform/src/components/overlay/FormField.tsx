'use client';

/**
 * Label · control · helper · error, wired together by id.
 *
 * The wiring is what pages kept getting wrong: a hint under a field that no
 * screen reader connected to it, an error painted red with nothing in
 * `aria-invalid`, a required mark that was a colour and not a word. This
 * hands the control the attributes that make the caption, the hint and the
 * error part of the field:
 *
 *   <FormField label="Drug name" required hint="Brand or generic" error={errors.drug}>
 *     {control => <input {...control} value={drug} onChange={…} />}
 *   </FormField>
 *
 * `control` carries `id`, `aria-describedby`, `aria-invalid` and
 * `aria-required`. A plain child (no render function) still gets the label
 * and messages; it just has to wire `id` itself.
 *
 * The caption is sentence case on purpose — see `.tm-field__label`.
 */

import { useId, type ReactNode } from 'react';
import { AlertCircle } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

export default function FormField({
  label,
  id,
  required = false,
  optional = false,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode;
  /** Control id; generated when omitted. */
  id?: string;
  required?: boolean;
  /** Show "optional" after the caption; use on forms where most fields are required. */
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  className?: string;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  // The error replaces the hint on screen, so it replaces it in the
  // description too — a control must never point at an id that is not there.
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };
  return (
    <div className={`tm-field${className ? ` ${className}` : ''}`} data-invalid={error ? 'true' : undefined}>
      <label htmlFor={controlId} className="tm-field__label">
        <span>{label}</span>
        {required && <span className="tm-field__req" aria-label={t('overlay.required')}>*</span>}
        {optional && !required && <span className="tm-field__opt">{t('overlay.optional')}</span>}
      </label>
      <div className="tm-field__control">
        {typeof children === 'function' ? children(control) : children}
      </div>
      {hint && !error && <p id={hintId} className="tm-field__hint">{hint}</p>}
      {error && (
        <p id={errorId} className="tm-field__error" role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
