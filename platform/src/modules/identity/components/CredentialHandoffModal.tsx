'use client';

/**
 * One-time credential hand-off panel, shared by every admin flow that hands a
 * brand-new (or reset) temporary password to an operator: the users roster's
 * "Add user" / "Reset password" actions and the organizations page's
 * "create the first admin" step. Originally lived inline in
 * admin/users/page.tsx; extracted so both flows render byte-identical UI and
 * share behaviour instead of drifting.
 *
 * The password is unrecoverable after this closes (only its hash is stored),
 * so this is deliberately harder to dismiss by accident than a normal modal:
 * `disableBackdropClose` means an outside click does nothing, and the
 * caller must present the credentials — Esc and the explicit "Done" button
 * are the only ways out.
 */

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Check, Copy } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { describeInvitationOutcome } from '@/modules/identity/provisioning/invitation-copy';
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';

export interface CredentialHandoffModalProps {
  /** e.g. "User created", "Password reset", "Administrator created". */
  title: string;
  /** Fallback copy, used when no `invitation` outcome is supplied. */
  description: string;
  username: string;
  password: string;
  /**
   * What happened to the invitation email, straight from `/api/users`.
   *
   * Supplied on a create, absent on a reset. When present it REPLACES
   * `description`, because "share these credentials securely" is misleading
   * for an account whose owner has already been mailed a link — and equally
   * misleading in reverse when the send failed and nobody said so.
   */
  invitation?: InvitationOutcome;
  onClose: () => void;
}

/** The exact text placed on the clipboard by "Copy credentials". Exported so its shape is unit-testable without rendering the modal. */
export function formatCredentialHandoffText(username: string, password: string): string {
  return `Username: ${username}\nTemporary password: ${password}`;
}

export default function CredentialHandoffModal({ title, description, username, password, invitation, onClose }: CredentialHandoffModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = invitation ? describeInvitationOutcome(invitation).message : description;

  return (
    <Modal onClose={onClose} size="sm" labelledBy="handoff-title" describedBy="handoff-copy" disableBackdropClose>
      <DialogFrame>
        <DialogHeader
          titleId="handoff-title"
          title={title}
          descriptionId="handoff-copy"
          description={copy}
          icon={<Check />}
          onClose={onClose}
        />
        <DialogBody tight>
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('credentialHandoff.labelUsername')}</span>
            <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('credentialHandoff.labelTempPassword')}</span>
            <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{password}</span>
          </div>
        </div>
        </DialogBody>
        <DialogFooter>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(formatCredentialHandoffText(username, password));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch { /* clipboard unavailable — user can read the values above */ }
            }}
            type="button"
            className="btn btn-secondary"
          >
            {copied ? <><Check className="w-4 h-4" /> {t('credentialHandoff.copiedButton')}</> : <><Copy className="w-4 h-4" /> {t('credentialHandoff.copyButton')}</>}
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary">
            {t('credentialHandoff.doneButton')}
          </button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
