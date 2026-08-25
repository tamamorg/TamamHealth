'use client';

/**
 * Create Lab Order — the whole flow, mounted in one modal.
 *
 * Phase 1 is the compact Create Order dialog; phase 2 is the six-step
 * requisition wizard. One draft (`useLabOrderDraft`) spans both, so continuing
 * carries everything forward and nothing is written until the wizard's Review
 * step commits.
 *
 * The caller supplies only `onClose` and `onPlaced` — patients, catalogue,
 * user and persistence are resolved inside, so this can be dropped into the
 * lab queue, a patient chart, or a consultation without extra wiring.
 */

import { useState } from 'react';
import Modal from '@/components/Modal';
import LabOrderCreateDialog from './LabOrderCreateDialog';
import LabOrderWizard from './LabOrderWizard';
import { useLabOrderDraft } from './useLabOrderDraft';
import './lab-order.css';

export default function LabOrderModal({
  onClose,
  onPlaced,
  presetPatientId,
}: {
  onClose: () => void;
  /** Called once the orders exist — refresh the queue here. */
  onPlaced: () => void;
  /** Skip patient lookup when the flow is opened from a chart. */
  presetPatientId?: string;
}) {
  const controller = useLabOrderDraft({ presetPatientId });
  const [phase, setPhase] = useState<'dialog' | 'wizard'>('dialog');
  // Opened from a chart, the patient is context rather than a choice, so the
  // picker shows it read-only instead of offering to swap charts mid-order.
  const lockPatient = !!presetPatientId;

  // While submitting, a stray backdrop click must not orphan the draft
  // mid-write; Esc/backdrop are re-enabled as soon as the write settles.
  const requestClose = () => { if (!controller.submitting) onClose(); };

  return (
    <Modal
      onClose={requestClose}
      // The dialog is a centred sheet; the wizard is a workspace. The wizard is
      // wide enough for the rail plus a full requisition column, but not the
      // whole screen — stretched to 1560 the two-field cards read as bands of
      // whitespace with a control stranded at each end.
      width={phase === 'dialog' ? 760 : 1320}
      align="center"
      // Sit below the app's top rail rather than covering it, so the clinician
      // keeps their bearings — which facility, which patient, what else is
      // waiting — while the order is being written.
      topOffset="var(--app-overlay-top-inset, 0px)"
      disableBackdropClose={controller.submitting}
    >
      {phase === 'dialog' ? (
        <LabOrderCreateDialog
          controller={controller}
          onCancel={requestClose}
          onContinue={() => setPhase('wizard')}
          lockPatient={lockPatient}
        />
      ) : (
        <LabOrderWizard
          controller={controller}
          onClose={requestClose}
          onPlaced={onPlaced}
          lockPatient={lockPatient}
        />
      )}
    </Modal>
  );
}
