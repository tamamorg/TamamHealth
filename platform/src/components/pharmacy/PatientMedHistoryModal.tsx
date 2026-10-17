'use client';

import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import TableCols from '@/components/TableCols';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { pharmacyStage, pharmacyStageLabel } from '@/lib/pharmacy-workflow';
import type { PatientDoc, PrescriptionDoc } from '@/lib/db-types';
import { prescriptionSig } from './pharmacy-helpers';


interface PatientMedHistoryModalProps {
  activePatient: PatientDoc;
  activeRxs: PrescriptionDoc[];
  onClose: () => void;
  onViewAll: () => void;
}

export default function PatientMedHistoryModal({ activePatient, activeRxs, onClose, onViewAll }: PatientMedHistoryModalProps) {
  const { t } = useTranslation();
  return (
    <Modal onClose={onClose} width={720} labelledBy="pharmacy-patient-med-history-title">
      <div className="modal-content card-elevated w-full overflow-hidden" style={{ maxHeight: 'calc(100vh - 48px)' }}>
        <div className="flex items-start justify-between gap-4 p-5" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="min-w-0">
            <h3 id="pharmacy-patient-med-history-title" className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {[activePatient.firstName, activePatient.middleName, activePatient.surname].filter(Boolean).join(' ')}
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {activePatient.hospitalNumber} · {t('pharmacy.prescriptionsOnRecord', { count: activeRxs.length })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="btn btn-secondary btn-sm" onClick={onViewAll}>{t('pharmacy.viewAll')}</button>
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label={t('action.close')}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto" style={{ maxHeight: 'min(62vh, 520px)' }}>
          <table className="data-table" style={{ minWidth: 640, tableLayout: 'fixed' }}>
            <TableCols widths={[1.9, 1.1, 1.3, 0.8, 0.9]} />
            <thead className="appointment-table-head">
              <tr>
                <th>{t('pharmacy.medication')}</th>
                <th>{t('pharmacy.dosage')}</th>
                <th>{t('pharmacy.prescribedBy')}</th>
                <th>{t('pharmacy.time')}</th>
                <th>{t('pharmacy.statusLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {activeRxs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 px-5 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {t('pharmacy.noPrescriptionsFound')}
                  </td>
                </tr>
              ) : activeRxs.map(rx => {
                  const stage = pharmacyStage(rx);
                  return (
                    <tr key={rx._id}>
                      <td className="font-semibold text-sm">{rx.medication}</td>
                      <td className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{prescriptionSig(rx)}</td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{rx.prescribedBy}</td>
                      <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{rx.createdAt ? new Date(rx.createdAt).toLocaleDateString('en-GB') : '—'}</td>
                      <td>
                        <span className={`badge text-[10px] ${stage === 'dispensed' || stage === 'counseled' || stage === 'complete' ? 'badge-normal' : 'badge-warning'}`}>
                          {pharmacyStageLabel(stage)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
