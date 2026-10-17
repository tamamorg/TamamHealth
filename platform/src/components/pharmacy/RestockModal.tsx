'use client';

import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { stopsClickPropagation } from '@/lib/a11y';

export interface RestockForm {
  qty: number;
  batchNumber: string;
  expiryDate: string;
}

interface RestockModalProps {
  restockTarget: { id: string; name: string; unit: string };
  restockForm: RestockForm;
  setRestockForm: (form: RestockForm) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function RestockModal({ restockTarget, restockForm, setRestockForm, onClose, onSave }: RestockModalProps) {
  const { t } = useTranslation();
  return (
      <Modal onClose={onClose} width={448}>
        <div className="modal-content card-elevated p-6 w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} {...stopsClickPropagation}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">{t('pharmacy.receiveStock')}</h3>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{restockTarget.name}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('pharmacy.quantityReceived', { unit: restockTarget.unit })} <span style={{ color: 'var(--color-danger-text)' }}>*</span>
              </label>
              <input
                type="number" step="any"
                min={1}
                autoFocus
                value={restockForm.qty || ''}
                onChange={e => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.batchNo')}</label>
                <input
                  type="text"
                  value={restockForm.batchNumber}
                  onChange={e => setRestockForm({ ...restockForm, batchNumber: e.target.value })}
                  placeholder={t('pharmacy.autoGenerate')}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.expiryDate')}</label>
                <input
                  type="date"
                  value={restockForm.expiryDate}
                  onChange={e => setRestockForm({ ...restockForm, expiryDate: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pharmacy.leaveBlankKeepExisting')}
            </p>
          </div>
          <hr className="section-divider" />
          <div className="flex gap-2 mt-2">
            <button onClick={onClose} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
            <button onClick={onSave} className="btn btn-primary flex-1">{t('pharmacy.addToStock')}</button>
          </div>
        </div>
      </Modal>
  );
}
