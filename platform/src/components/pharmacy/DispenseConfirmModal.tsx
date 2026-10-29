'use client';

import { AlertOctagon } from '@/components/icons/lucide';
import { useId } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PharmacyInventoryDoc, PrescriptionDoc, UserDoc } from '@/lib/db-types';

export interface DispenseTarget {
  rx: PrescriptionDoc;
  inv: PharmacyInventoryDoc;
  qty: number;
}

interface DispenseConfirmModalProps {
  dispenseTarget: DispenseTarget;
  counsellingConfirmed: boolean;
  setCounsellingConfirmed: (confirmed: boolean) => void;
  witnessId: string;
  setWitnessId: (id: string) => void;
  users: UserDoc[];
  currentUserId?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DispenseConfirmModal({ dispenseTarget, counsellingConfirmed, setCounsellingConfirmed, witnessId, setWitnessId, users, currentUserId, onClose, onConfirm }: DispenseConfirmModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();
  const needsWitness = Boolean(dispenseTarget.inv.controlledSchedule || dispenseTarget.inv.requiresWitness);
  return (
    <Modal onClose={onClose} size="sm" labelledBy={titleId} describedBy={descId}>
      <DialogFrame>
        <DialogHeader
          titleId={titleId}
          title={t('pharmacy.dispenseModalTitle')}
          descriptionId={descId}
          description={<>
            {t('pharmacy.dispenseModalHandOver')} <strong>{dispenseTarget.qty} {dispenseTarget.inv.unit}</strong> {t('pharmacy.dispenseModalOf')} <strong>{dispenseTarget.inv.medicationName}</strong> {t('pharmacy.dispenseModalTo')} {dispenseTarget.rx.patientName}.
          </>}
          icon={<AlertOctagon />}
          tone="warning"
          onClose={onClose}
        />
        <DialogBody>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={counsellingConfirmed} onChange={event => setCounsellingConfirmed(event.target.checked)} />
            <span>I explained the dose, timing, important side effects, storage, and when to return.</span>
          </label>
          {needsWitness && (
            <FormField label={t('pharmacy.dispenseModalWitness')} required className="mt-4">
              {control => (
                <Select {...control} value={witnessId} onChange={e => setWitnessId(e.target.value)}>
                  <option value="">Select witness…</option>
                  {users.filter(u => u._id !== currentUserId && u.isActive !== false).map(u => (
                    <option key={u._id} value={u._id}>{u.name} — {u.role}</option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
        </DialogBody>
        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!counsellingConfirmed || (needsWitness && !witnessId)}>Counsel &amp; dispense</button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
