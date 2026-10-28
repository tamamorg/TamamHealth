'use client';

import { Pill, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { medications } from '@/lib/data/formulary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { stopsClickPropagation } from '@/lib/a11y';
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
      <Modal variant="slider" onClose={onClose}>
        <div className="modal-content card-elevated p-6 max-w-lg w-full" {...stopsClickPropagation}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="icon-box-sm">
                <Pill className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              </div>
              <h3 className="text-base font-semibold">{t('pharmacy.receiveStock')}</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <hr className="section-divider" />
          <div className="data-row-divider-sm">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.medication')}</label>
              <input
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.quantity')}</label>
                <input type="number" step="1" min={1} value={stockForm.stockLevel || ''} onChange={e => setStockForm({ ...stockForm, stockLevel: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.unit')}</label>
                <Select value={stockForm.unit} onChange={e => setStockForm({ ...stockForm, unit: e.target.value })}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.reorderLevel')}</label>
                <input type="number" step="1" min={0} value={stockForm.reorderLevel} onChange={e => setStockForm({ ...stockForm, reorderLevel: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.batchNumber')}</label>
                <input type="text" value={stockForm.batchNumber} onChange={e => setStockForm({ ...stockForm, batchNumber: e.target.value })} placeholder={t('pharmacy.optional')} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.expiryDate')}</label>
              <input type="date" value={stockForm.expiryDate} onChange={e => setStockForm({ ...stockForm, expiryDate: e.target.value })} />
            </div>
          </div>
          <hr className="section-divider" />
          <div className="flex gap-2 mt-2">
            <button onClick={onClose} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
            <button onClick={onSave} className="btn btn-primary flex-1">{t('pharmacy.saveStockReceipt')}</button>
          </div>
        </div>
      </Modal>
  );
}
