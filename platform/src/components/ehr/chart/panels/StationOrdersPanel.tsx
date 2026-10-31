'use client';

/**
 * Station order forms — the chart workspace a lab technician or pharmacist
 * works in (`lab-orders`, `dispense`), the way a doctor writes a note beside
 * the record and a radiographer reports in Imaging report.
 *
 * The panel lists the patient's orders for the station, open ones first, each
 * with where it stands. Picking one opens the station's existing six-step
 * workflow for it — the bench (LabWorkflowPanel) or the counter
 * (PharmacyWorkflowPanel) — in the same workspace, with a way back to the list.
 * A dashboard link that names an order (`?form=…&focus=<id>`) opens straight
 * onto it; a patient with exactly one open order opens onto that one.
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, Plus } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { isOutsidePharmacyOrder, pharmacyStage, pharmacyStageGroup } from '@/lib/pharmacy-workflow';
import { formatRxSig } from '@/lib/format-utils';
import { EhrPatientOrderList } from '@/components/ehr/EhrPatientOrders';
import LabWorkflowPanel from '@/components/lab/workflow/LabWorkflowPanel';
import LabIntakeSlider from '@/components/lab/order/LabIntakeSlider';
import { benchActionLabel } from '@/components/lab/workflow/lab-workflow-types';
import { effectiveOrderStatus } from '@/lib/services/lab-service';
import PharmacyWorkflowPanel from '@/components/pharmacy/workflow/PharmacyWorkflowPanel';
import { counterActions } from '@/components/pharmacy/workflow/pharmacy-workflow-types';
import { hasSafetyWarning } from '@/lib/pharmacy/rx-safety';
import type { PatientDoc } from '@/lib/db-types';

interface StationOrdersPanelProps {
  patient: PatientDoc;
  /** The order a dashboard link named, if any. */
  focusId?: string;
}

const LAB_STAGE_RANK: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

function BackToList({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="labord-btn labord-btn--ghost" style={{ marginBottom: 10 }} onClick={onClick}>
      <ArrowLeft className="w-4 h-4" aria-hidden /> {label}
    </button>
  );
}

export function LabOrdersPanel({ patient, focusId }: StationOrdersPanelProps) {
  const { t } = useTranslation();
  const { canEnterLabResults } = usePermissions();
  const { results } = useLabResults(patient._id);
  const tests = useMemo(
    () => results
      .filter(r => r.patientId === patient._id && !isImagingStudy(r))
      .sort((a, b) => (LAB_STAGE_RANK[a.status] ?? 3) - (LAB_STAGE_RANK[b.status] ?? 3)
        || (b.orderedAt || '').localeCompare(a.orderedAt || '')),
    [results, patient._id],
  );
  const open = tests.filter(r => r.status !== 'completed');
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [intakeOpen, setIntakeOpen] = useState(false);
  // Until the technician picks (or goes back to the list), the panel opens on
  // the order the link named, or the patient's only open test.
  const selectedId = picked !== undefined ? picked : (focusId || (open.length === 1 ? open[0]._id : null));
  const selected = selectedId ? tests.find(r => r._id === selectedId) : undefined;

  if (selected) {
    return (
      <div className="tamam-drawer-workspace station-orders">
        <div className="station-orders__body">
          {tests.length > 1 && <BackToList label={t('labFlow.backToResults')} onClick={() => setPicked(null)} />}
          <LabWorkflowPanel order={selected} canWork={canEnterLabResults} onClose={() => setPicked(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="tamam-drawer-workspace station-orders">
      <div className="station-orders__body">
        {canEnterLabResults && (
          <button type="button" className="labord-btn" style={{ marginBottom: 10 }} onClick={() => setIntakeOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden /> {t('labIntake.title')}
          </button>
        )}
        {tests.length === 0 ? (
          <p className="station-orders__empty">{t('basket.noLabOrders')}</p>
        ) : (
          <EhrPatientOrderList
            label={t('visits.labs')}
            orders={tests.map(r => ({
              id: r._id,
              title: r.testName,
              detail: [r.specimen, r.accessionNumber].filter(Boolean).join(' · '),
              note: r.status === 'completed' ? `${r.result}${r.unit ? ` ${r.unit}` : ''}` : r.clinicalNotes,
              // Named for the next step, as on the dashboard.
              actions: (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicked(r._id)}>
                  {t(benchActionLabel(effectiveOrderStatus(r)))}
                </button>
              ),
            }))}
          />
        )}
      </div>
      {intakeOpen && (
        <LabIntakeSlider
          presetPatientId={patient._id}
          onClose={() => setIntakeOpen(false)}
          onPlaced={orderId => { setIntakeOpen(false); setPicked(orderId); }}
        />
      )}
    </div>
  );
}

export function DispensePanel({ patient, focusId }: StationOrdersPanelProps) {
  const { t } = useTranslation();
  const { canDispense } = usePermissions();
  const { prescriptions } = usePrescriptions(patient._id);
  const scripts = useMemo(
    () => (prescriptions || [])
      .filter(rx => rx.patientId === patient._id && !isOutsidePharmacyOrder(rx))
      .sort((a, b) => Number(pharmacyStageGroup(pharmacyStage(a)) === 'finished') - Number(pharmacyStageGroup(pharmacyStage(b)) === 'finished')
        || (b.createdAt || '').localeCompare(a.createdAt || '')),
    [prescriptions, patient._id],
  );
  const open = scripts.filter(rx => rx.status !== 'discontinued' && pharmacyStageGroup(pharmacyStage(rx)) !== 'finished');
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selectedId = picked !== undefined ? picked : (focusId || (open.length === 1 ? open[0]._id : null));
  const selected = selectedId ? scripts.find(rx => rx._id === selectedId) : undefined;
  // What the safety review checks the script against: the patient's other
  // active medicines, never the script itself.
  const activeMedications = useMemo(
    () => scripts.filter(rx => rx._id !== selectedId && rx.status !== 'discontinued').map(rx => rx.medication).filter(Boolean),
    [scripts, selectedId],
  );

  if (selected) {
    return (
      <div className="tamam-drawer-workspace station-orders">
        <div className="station-orders__body">
          {scripts.length > 1 && <BackToList label={t('rxFlow.backToMedications')} onClick={() => setPicked(null)} />}
          <PharmacyWorkflowPanel rx={selected} canWork={canDispense} activeMedications={activeMedications} onClose={() => setPicked(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="tamam-drawer-workspace station-orders">
      <div className="station-orders__body">
        {scripts.length === 0 ? (
          <p className="station-orders__empty">{t('basket.noDrugOrders')}</p>
        ) : (
          <EhrPatientOrderList
            label={t('tab.prescriptions')}
            orders={scripts.map(rx => {
              const warned = hasSafetyWarning(rx);
              return {
                id: rx._id,
                title: rx.medication,
                detail: formatRxSig(rx),
                note: warned ? t('pharmacyHome.safetyReview') : (rx.pharmacyInstructions || rx.indication),
                // Named for the next step, as on the dashboard.
                actions: (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicked(rx._id)}>
                    {counterActions(rx.orderStatus || 'prescribed', t)[0]?.label ?? t('dashboard.open')}
                  </button>
                ),
              };
            })}
          />
        )}
      </div>
    </div>
  );
}
