'use client';

/**
 * FormSlider — the one shape for a record-entry or edit form.
 *
 * Every "Add …", "Record …" and "Edit …" form opens as the right-hand O3
 * workspace the patient chart's Record vitals uses: it docks under the page's
 * Back bar, squeezes the page beside it, and carries the grey header band
 * (title, optional expand, close) and the full-width Cancel / primary footer.
 *
 * Before this, each module hand-rolled the band, the close button and the
 * footer inside a bare `<Modal variant="slider">` and relied on structural CSS
 * to make the result look related. This component owns that chrome, so a form
 * only supplies its title, fields and actions:
 *
 *   <FormSlider
 *     title={t('pharmacy.receiveStock')}
 *     subtitle={item.name}
 *     onClose={close}
 *     busy={saving}
 *     footer={<>
 *       <button type="button" className="btn btn-secondary" onClick={close}>{t('common.cancel')}</button>
 *       <button type="submit" form={formId} className="btn btn-primary">{t('common.save')}</button>
 *     </>}
 *   >
 *     <form id={formId} onSubmit={save}>…fields…</form>
 *   </FormSlider>
 *
 * Buttons go secondary first, primary last. A submit button outside the
 * `<form>` reaches it through `form={formId}`.
 */

import { useId, type ReactNode } from 'react';
import Modal, { type DialogSize } from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader, type DialogTone } from './Dialog';

export interface FormSliderProps {
  title: ReactNode;
  /** One quiet line under the title: whose record, which item. */
  subtitle?: ReactNode;
  onClose: () => void;
  /** Promote to the full page; omit when no page can carry the job. */
  onExpand?: () => void;
  /** The action buttons, secondary first, primary last. */
  footer?: ReactNode;
  /** A short muted sentence at the footer's leading edge. */
  footerNote?: ReactNode;
  /** A save in flight: the panel stays visible under a wash and is inert. */
  busy?: boolean;
  busyLabel?: string;
  /** Panel width in px; prefer `size`. Default 480, the chart forms' width. */
  width?: number;
  size?: DialogSize;
  tone?: DialogTone;
  /** No body gutter — for a table or list that rules its own edges. */
  flush?: boolean;
  /** Extra class on the panel surface. */
  className?: string;
  disableBackdropClose?: boolean;
  children: ReactNode;
}

export default function FormSlider({
  title,
  subtitle,
  onClose,
  onExpand,
  footer,
  footerNote,
  busy = false,
  busyLabel,
  width = 480,
  size,
  tone,
  flush = false,
  className,
  disableBackdropClose,
  children,
}: FormSliderProps) {
  const titleId = useId();
  const descId = useId();
  // A close while a save is in flight would drop the result on the floor.
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal
      variant="slider"
      onClose={close}
      width={width}
      size={size}
      className={className}
      labelledBy={titleId}
      describedBy={subtitle ? descId : undefined}
      disableBackdropClose={disableBackdropClose}
    >
      <DialogFrame busy={busy} busyLabel={busyLabel}>
        <DialogHeader
          titleId={titleId}
          title={title}
          description={subtitle}
          descriptionId={descId}
          tone={tone}
          onClose={close}
          onExpand={onExpand}
        />
        <DialogBody flush={flush}>{children}</DialogBody>
        {footer && <DialogFooter note={footerNote}>{footer}</DialogFooter>}
      </DialogFrame>
    </Modal>
  );
}
