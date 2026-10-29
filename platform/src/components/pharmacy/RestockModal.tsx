'use client';

import FormSlider from '@/components/overlay/FormSlider';
import FormField from '@/components/overlay/FormField';
import { useTranslation } from '@/lib/i18n/useTranslation';

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
    <FormSlider
      title={t('pharmacy.receiveStock')}
      subtitle={restockTarget.name}
      onClose={onClose}
      footerNote={t('pharmacy.leaveBlankKeepExisting')}
      footer={<>
        <button type="button" onClick={onClose} className="btn btn-secondary">{t('action.cancel')}</button>
        <button type="button" onClick={onSave} className="btn btn-primary">{t('pharmacy.addToStock')}</button>
      </>}
    >
      <div className="space-y-4">
        <FormField label={t('pharmacy.quantityReceived', { unit: restockTarget.unit })} required>
          {control => (
            <input
              {...control}
              type="number" step="any"
              min={1}
              autoFocus
              value={restockForm.qty || ''}
              onChange={e => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) || 0 })}
              placeholder="0"
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('pharmacy.batchNo')}>
            {control => (
              <input
                {...control}
                type="text"
                value={restockForm.batchNumber}
                onChange={e => setRestockForm({ ...restockForm, batchNumber: e.target.value })}
                placeholder={t('pharmacy.autoGenerate')}
              />
            )}
          </FormField>
          <FormField label={t('pharmacy.expiryDate')}>
            {control => (
              <input
                {...control}
                type="date"
                value={restockForm.expiryDate}
                onChange={e => setRestockForm({ ...restockForm, expiryDate: e.target.value })}
              />
            )}
          </FormField>
        </div>
      </div>
    </FormSlider>
  );
}
