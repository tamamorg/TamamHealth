'use client';

import FormSlider from '@/components/overlay/FormSlider';
import FormField from '@/components/overlay/FormField';
import Select from '@/components/Select';
import { medications } from '@/lib/data/formulary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { UNITS } from './pharmacy-helpers';

export interface StockInForm {
  medicationName: string;
  category: string;
  stockLevel: number;
  unit: string;
  reorderLevel: number;
  batchNumber: string;
  expiryDate: string;
}

interface StockInModalProps {
  stockForm: StockInForm;
  setStockForm: (form: StockInForm) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function StockInModal({ stockForm, setStockForm, onClose, onSave }: StockInModalProps) {
  const { t } = useTranslation();
  return (
    <FormSlider
      title={t('pharmacy.receiveStock')}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="btn btn-secondary">{t('action.cancel')}</button>
        <button type="button" onClick={onSave} className="btn btn-primary">{t('pharmacy.saveStockReceipt')}</button>
      </>}
    >
      <div className="space-y-4">
        <FormField label={t('pharmacy.medication')} required>
          {control => (
            <>
              <input
                {...control}
                list="medication-list"
                type="text"
                value={stockForm.medicationName}
                onChange={e => {
                  const med = medications.find(m => m.name === e.target.value);
                  setStockForm({ ...stockForm, medicationName: e.target.value, category: med?.category || stockForm.category });
                }}
                placeholder={t('pharmacy.medicationPlaceholder')}
              />
              <datalist id="medication-list">
                {medications.map(m => <option key={m.name} value={m.name}>{m.category}</option>)}
              </datalist>
            </>
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('pharmacy.quantity')} required>
            {control => <input {...control} type="number" step="1" min={1} value={stockForm.stockLevel || ''} onChange={e => setStockForm({ ...stockForm, stockLevel: parseInt(e.target.value) || 0 })} />}
          </FormField>
          <FormField label={t('pharmacy.unit')}>
            {control => (
              <Select {...control} value={stockForm.unit} onChange={e => setStockForm({ ...stockForm, unit: e.target.value })}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
            )}
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('pharmacy.reorderLevel')}>
            {control => <input {...control} type="number" step="1" min={0} value={stockForm.reorderLevel} onChange={e => setStockForm({ ...stockForm, reorderLevel: parseInt(e.target.value) || 0 })} />}
          </FormField>
          <FormField label={t('pharmacy.batchNumber')} optional>
            {control => <input {...control} type="text" value={stockForm.batchNumber} onChange={e => setStockForm({ ...stockForm, batchNumber: e.target.value })} />}
          </FormField>
        </div>
        <FormField label={t('pharmacy.expiryDate')}>
          {control => <input {...control} type="date" value={stockForm.expiryDate} onChange={e => setStockForm({ ...stockForm, expiryDate: e.target.value })} />}
        </FormField>
      </div>
    </FormSlider>
  );
}
