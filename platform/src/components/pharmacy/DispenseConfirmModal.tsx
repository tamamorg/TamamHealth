'use client';

import { AlertOctagon } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
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
  return (
      <Modal onClose={onClose}>
        <div className="modal-panel modal-panel--sm">
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pharmacy.dispenseModalTitle')}</h3>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {t('pharmacy.dispenseModalHandOver')} <strong>{dispenseTarget.qty} {dispenseTarget.inv.unit}</strong> {t('pharmacy.dispenseModalOf')} <strong>{dispenseTarget.inv.medicationName}</strong> {t('pharmacy.dispenseModalTo')} {dispenseTarget.rx.patientName}.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={counsellingConfirmed} onChange={event => setCounsellingConfirmed(event.target.checked)} />
            <span>I explained the dose, timing, important side effects, storage, and when to return.</span>
          </label>
          {(dispenseTarget.inv.controlledSchedule || dispenseTarget.inv.requiresWitness) && <>
            <label>{t('pharmacy.dispenseModalWitness')}</label>
            <Select value={witnessId} onChange={e => setWitnessId(e.target.value)}>
              <option value="">Select witness…</option>
              {users.filter(u => u._id !== currentUserId && u.isActive !== false).map(u => (
                <option key={u._id} value={u._id}>{u.name} — {u.role}</option>
              ))}
            </Select>
          </>}
          <div className="flex gap-2 mt-5">
            <button className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary flex-1" onClick={onConfirm} disabled={!counsellingConfirmed || (Boolean(dispenseTarget.inv.controlledSchedule || dispenseTarget.inv.requiresWitness) && !witnessId)}>Counsel &amp; dispense</button>
          </div>
        </div>
      </Modal>
  );
}
