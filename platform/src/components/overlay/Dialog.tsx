'use client';

/**
 * The dialog kit — head, body, foot, section, split — for anything rendered
 * inside `Modal`.
 *
 * Before this, 94 files opened a `Modal` and 58 of them hand-rolled the
 * header, the close button and the footer, each at its own padding, its own
 * title size and its own button order; a structural CSS rule then painted
 * whichever `div:first-child` it could recognise as a solid blue band. The
 * result was a family of popups that were related by accident.
 *
 * This kit makes the shape explicit and the styling shared:
 *
 *   <Modal onClose={close} size="lg" labelledBy={titleId} describedBy={descId}>
 *     <DialogFrame busy={saving}>
 *       <DialogHeader titleId={titleId} title="Create order" description="…" onClose={close} />
 *       <DialogBody>…</DialogBody>
 *       <DialogFooter note={t('labOrder.nothingPlacedYet')}>
 *         <button className="btn btn-secondary" onClick={close}>Cancel</button>
 *         <button className="btn btn-primary">Continue</button>
 *       </DialogFooter>
 *     </DialogFrame>
 *   </Modal>
 *
 * The head is plain by default — title in the accent ink over a hairline,
 * which is the reference EHRs' language and reads calmer than a band on
 * every popup. `tone="brand"` keeps the solid platform-blue band for the
 * provisioning family that already wears it; `tone="danger"` puts a red
 * edge on a dialog that destroys something. Every head carries
 * `modal-no-headband`, which opts it out of the structural band rule.
 *
 * All copy arrives as props (translated by the caller); the only strings
 * this file owns are the accessible names of its own controls.
 */

import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Maximize2, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export type DialogTone = 'plain' | 'brand' | 'danger' | 'warning';

export function DialogFrame({ children, className = '', busy = false, busyLabel }: {
  children: ReactNode;
  className?: string;
  /** A save in flight: the dialog stays visible under a wash with a spinner,
   *  and its controls are inert until it clears. */
  busy?: boolean;
  busyLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    // `modal-no-headband` on the frame as well as the head: the structural
    // band rule in globals.css also matches `[role="dialog"] > div:first-child`
    // when it holds an h2 and no form control — exactly a confirm — and would
    // paint the whole frame in the accent with white ink.
    <div className={`tm-dialog modal-no-headband${className ? ` ${className}` : ''}`} aria-busy={busy || undefined}>
      {children}
      {busy && (
        <div className="tm-dialog__busy tm-motion tm-motion--fade" role="status">
          <span className="tm-dialog__busy-card tm-elevated">
            <span className="tm-spinner tm-motion" aria-hidden="true" />
            {busyLabel || t('overlay.working')}
          </span>
        </div>
      )}
    </div>
  );
}

export function DialogHeader({
  title,
  titleId,
  description,
  descriptionId,
  icon,
  tone = 'plain',
  onClose,
  onExpand,
  onBack,
  closeLabel,
  expandLabel,
  backLabel,
  actions,
  className = '',
}: {
  title: ReactNode;
  /** Pass the same id to `Modal`'s `labelledBy`. */
  titleId: string;
  description?: ReactNode;
  /** Pass the same id to `Modal`'s `describedBy`. */
  descriptionId?: string;
  /** A glyph in a tinted plate before the title — for a confirm, the tone. */
  icon?: ReactNode;
  tone?: DialogTone;
  onClose: () => void;
  /** Promote to the full page (see PopupHeader for when to omit). */
  onExpand?: () => void;
  /** A step back inside a multi-step dialog. */
  onBack?: () => void;
  closeLabel?: string;
  expandLabel?: string;
  backLabel?: string;
  /** Extra controls placed before expand/close. */
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const iconTone = tone === 'danger' ? ' tm-dialog__icon--danger' : tone === 'warning' ? ' tm-dialog__icon--warning' : '';
  return (
    <header className={`tm-dialog__head tm-dialog__head--${tone} modal-no-headband${className ? ` ${className}` : ''}`}>
      {onBack && (
        <button type="button" className="tm-dialog__ctl" onClick={onBack} aria-label={backLabel || t('overlay.back')}>
          <ArrowLeft aria-hidden="true" />
        </button>
      )}
      {icon && <span className={`tm-dialog__icon${iconTone}`} aria-hidden="true">{icon}</span>}
      <div className="tm-dialog__copy">
        <h2 id={titleId} className="tm-dialog__title">{title}</h2>
        {description && <p id={descriptionId} className="tm-dialog__desc">{description}</p>}
      </div>
      <div className="tm-dialog__controls">
        {actions}
        {onExpand && (
          <button
            type="button"
            className="tm-dialog__ctl"
            onClick={onExpand}
            aria-label={expandLabel || t('overlay.expand')}
            data-action="popup-expand"
          >
            <Maximize2 aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="tm-dialog__ctl"
          onClick={onClose}
          aria-label={closeLabel || t('overlay.close')}
          data-action="popup-close"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export function DialogBody({ children, flush = false, tight = false, className = '', id }: {
  children: ReactNode;
  /** No gutter — for a table or list that rules its own edges. */
  flush?: boolean;
  /** Shorter vertical padding for a one-question dialog. */
  tight?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`tm-dialog__body${flush ? ' tm-dialog__body--flush' : ''}${tight ? ' tm-dialog__body--tight' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}

export function DialogFooter({ children, start, note, className = '' }: {
  /** The action buttons, secondary first, primary last (the eye finishes
   *  at the trailing edge, so the primary sits there). */
  children: ReactNode;
  /** Leading-edge content: a tertiary action, a status line. */
  start?: ReactNode;
  /** A short muted sentence at the leading edge ("Nothing is placed yet"). */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <footer className={`tm-dialog__foot${className ? ` ${className}` : ''}`}>
      {(start || note) && (
        <div className="tm-dialog__foot-start">
          {start}
          {note && <span className="tm-dialog__foot-note">{note}</span>}
        </div>
      )}
      {children}
    </footer>
  );
}

/** A titled group inside a dialog body; collapsible when it says so. */
export function DialogSection({
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = true,
  open,
  onToggle,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Controlled open state; omit to let the section keep its own. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const bodyId = useId();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = collapsible ? (open ?? ownOpen) : true;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOwnOpen(next);
    onToggle?.(next);
  };
  const head = (
    <>
      <span className="tm-dialog__section-copy">
        {title}
        {subtitle && <span className="tm-dialog__section-sub">{subtitle}</span>}
      </span>
      {collapsible && <ChevronDown className="tm-dialog__section-chevron" aria-hidden="true" />}
    </>
  );
  return (
    <section className={`tm-dialog__section${className ? ` ${className}` : ''}`} data-open={isOpen ? 'true' : 'false'}>
      {collapsible ? (
        <button
          type="button"
          className="tm-dialog__section-head"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          aria-label={typeof title === 'string' ? `${title}. ${isOpen ? t('overlay.collapse') : t('overlay.expandSection')}` : undefined}
        >
          {head}
        </button>
      ) : (
        <div className="tm-dialog__section-head">{head}</div>
      )}
      <div id={bodyId} className="tm-dialog__section-body" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/** Two panes side by side: `DialogMain` for the work, `DialogAside` for context. */
export function DialogSplit({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tm-dialog__split${className ? ` ${className}` : ''}`}>{children}</div>;
}
export function DialogMain({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tm-dialog__main${className ? ` ${className}` : ''}`}>{children}</div>;
}
export function DialogAside({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <aside className={`tm-dialog__aside${className ? ` ${className}` : ''}`} aria-label={label}>{children}</aside>;
}
