'use client';

import Modal from '@/components/Modal';
import { DialogBody, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { patientFullName } from '@/lib/patient-utils';
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
    <Modal onClose={onClose} size="lg" labelledBy="pharmacy-patient-med-history-title">
      <DialogFrame>
        <DialogHeader
          titleId="pharmacy-patient-med-history-title"
          title={patientFullName(activePatient)}
          description={<>{activePatient.hospitalNumber} · {t('pharmacy.prescriptionsOnRecord', { count: activeRxs.length })}</>}
          actions={<button type="button" className="btn btn-secondary btn-sm" onClick={onViewAll}>{t('pharmacy.viewAll')}</button>}
          closeLabel={t('action.close')}
          onClose={onClose}
        />
        <DialogBody flush>
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
        </DialogBody>
      </DialogFrame>
    </Modal>
  );
}
