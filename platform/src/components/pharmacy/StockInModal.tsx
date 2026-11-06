'use client';

import FormSlider from '@/components/overlay/FormSlider';
import FormField from '@/components/overlay/FormField';
import Select from '@/components/Select';
import { medications, isControlledMedicine } from '@/lib/data/formulary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { UNITS } from './pharmacy-helpers';
import NumberInput from '@/components/forms/NumberInput';

export type StockControlledSchedule = '' | 'II' | 'III' | 'IV' | 'V';

export interface StockInForm {
  medicationName: string;
  category: string;
  stockLevel: number;
  unit: string;
  reorderLevel: number;
  batchNumber: string;
  expiryDate: string;
  /** Narcotic/psychotropic schedule. Set it (or stock a recognised controlled
   *  medicine) and a second-person witness is required to dispense the batch. */
  controlledSchedule: StockControlledSchedule;
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
            {control => <NumberInput {...control} step="1" min={1} value={stockForm.stockLevel || ''} onChange={e => setStockForm({ ...stockForm, stockLevel: parseInt(e.target.value) || 0 })} />}
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
            {control => <NumberInput {...control} step="1" min={0} value={stockForm.reorderLevel} onChange={e => setStockForm({ ...stockForm, reorderLevel: parseInt(e.target.value) || 0 })} />}
          </FormField>
          <FormField label={t('pharmacy.batchNumber')} optional>
            {control => <input {...control} type="text" value={stockForm.batchNumber} onChange={e => setStockForm({ ...stockForm, batchNumber: e.target.value })} />}
          </FormField>
        </div>
        <FormField label={t('pharmacy.expiryDate')}>
          {control => <input {...control} type="date" value={stockForm.expiryDate} onChange={e => setStockForm({ ...stockForm, expiryDate: e.target.value })} />}
        </FormField>
        <FormField label={t('pharmacy.controlledSchedule')} optional>
          {control => (
            <Select {...control} value={stockForm.controlledSchedule} onChange={e => setStockForm({ ...stockForm, controlledSchedule: e.target.value as StockControlledSchedule })}>
              <option value="">{t('pharmacy.controlledScheduleNone')}</option>
              <option value="II">{t('pharmacy.controlledScheduleII')}</option>
              <option value="III">{t('pharmacy.controlledScheduleIII')}</option>
              <option value="IV">{t('pharmacy.controlledScheduleIV')}</option>
              <option value="V">{t('pharmacy.controlledScheduleV')}</option>
            </Select>
          )}
        </FormField>
        {isControlledMedicine(stockForm.medicationName) && !stockForm.controlledSchedule && (
          <p className="text-xs" style={{ color: 'var(--color-warning-text)' }}>
            {t('pharmacy.controlledUnscheduledWarning')}
          </p>
        )}
      </div>
    </FormSlider>
  );
}
