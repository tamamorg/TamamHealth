'use client';

/**
 * The portal sign-in slip, shown the moment a patient is registered.
 *
 * Registration used to end at a toast, and the portal account was a separate
 * errand: open the chart, find the Demographics tab, enrol, copy a code. In
 * practice that meant patients left the desk without one. The account is now
 * written with the patient (see `createPatient`'s `portalInvite`), and this is
 * the hand-over — what the clerk prints or reads out before the next person
 * steps up.
 *
 * The code exists only here: the patient document holds its hash. Closing the
 * dialog is the last time anyone can see it, which is why Print is the primary
 * action and Done is not.
 */

import { useId, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import InlineBanner from '@/components/overlay/InlineBanner';
import { Check, Copy, Printer, Smartphone } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { PORTAL_ACTIVATE_PATH } from '@/modules/identity/client';
import {
  buildPortalSlipText, portalSlipDate, printPortalSlip,
  type PortalSlip, type PortalSlipLabels,
} from '@/lib/patient-portal-slip';
import './portal-slip.css';

/** The slip's labels and steps, in the reader's language. */
export function usePortalSlipLabels(): PortalSlipLabels {
  const { t } = useTranslation();
  return useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      documentLabel: t('pslip.documentLabel'),
      hospitalNumber: t('pslip.hospitalNumber'),
      username: t('pac.username'),
      activationCode: t('pac.activationCode'),
      validUntil: t('pslip.validUntil'),
      stepsTitle: t('pslip.stepsTitle'),
      steps: [
        t('pslip.step1', { url: `${origin}${PORTAL_ACTIVATE_PATH}` }),
        t('pslip.step2'),
        t('pslip.step3'),
      ],
      footer: t('pslip.printFooter'),
    };
  }, [t]);
}

export default function PortalSlipDialog({ slip, onClose }: { slip: PortalSlip; onClose: () => void }) {
  const { t } = useTranslation();
  const labels = usePortalSlipLabels();
  const titleId = useId();
  const descId = useId();
  const [copied, setCopied] = useState(false);
  // Read once: the registration that produced this slip has not synced if the
  // device was offline when it was written, and the code cannot be redeemed
  // until it has.
  const [offline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildPortalSlipText(slip, labels));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the slip is on screen */ }
  };

  return (
    <Modal onClose={onClose} size="md" labelledBy={titleId} describedBy={descId}>
      <DialogFrame>
        <DialogHeader
          titleId={titleId}
          descriptionId={descId}
          title={t('pslip.title')}
          description={t('pslip.description', { name: slip.patientName })}
          icon={<Smartphone className="w-4 h-4" aria-hidden="true" />}
          onClose={onClose}
        />
        <DialogBody>
          <div className="pslip-stack">
            <dl className="pslip-card">
              {slip.hospitalNumber && (
                <>
                  <dt>{labels.hospitalNumber}</dt>
                  <dd>{slip.hospitalNumber}</dd>
                </>
              )}
              <dt>{labels.username}</dt>
              <dd>{slip.username}</dd>
              <dt>{labels.activationCode}</dt>
              <dd className="pslip-code">{slip.activationCode}</dd>
              <dt>{labels.validUntil}</dt>
              <dd>{portalSlipDate(slip.expiresAt)}</dd>
            </dl>
            <div>
              <p className="pslip-steps-title">{labels.stepsTitle}</p>
              <ol className="pslip-steps">
                {labels.steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            </div>
            {offline && <InlineBanner tone="warning" compact>{t('pslip.offlineNote')}</InlineBanner>}
          </div>
        </DialogBody>
        <DialogFooter note={t('pslip.footNote')}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('pac.done')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
            {copied
              ? <><Check className="w-3.5 h-3.5" aria-hidden="true" /> {t('pac.copied')}</>
              : <><Copy className="w-3.5 h-3.5" aria-hidden="true" /> {t('pac.copySlip')}</>}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => printPortalSlip(slip, labels)}>
            <Printer className="w-3.5 h-3.5" aria-hidden="true" /> {t('pslip.print')}
          </button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
