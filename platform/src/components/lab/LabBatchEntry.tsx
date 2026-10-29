'use client';

/**
 * Batch result entry: a whole run of one test filled in a single pass.
 * Single results are entered in the chart's bench workflow (the lab form);
 * this is the one job the chart cannot do, so it stays a station action,
 * opened from the lab dashboard's header.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePatients } from '@/lib/hooks/usePatients';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import FormSlider from '@/components/overlay/FormSlider';
import { useToast } from '@/components/Toast';
import { Loader2, X, Save, Table } from '@/components/icons/lucide';
import PatientName from '@/components/PatientName';
import Select from '@/components/Select';
import {
  flagLabResult as flagResult,
  getLabReferenceRange as getRefRange,
  criticalBoundsInEntryUnit,
} from '@/lib/services/lab-critical-flag';

const ACCENT = 'var(--accent-primary)';

const FLAG_COLORS = {
  NORMAL: { bg: 'rgba(79, 199, 155,0.12)', color: 'var(--color-success)', border: 'rgba(79, 199, 155,0.25)' },
  ABNORMAL: { bg: 'rgba(255, 210, 166,0.12)', color: 'var(--color-warning)', border: 'rgba(255, 210, 166,0.25)' },
  CRITICAL: { bg: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger)', border: 'rgba(224, 49, 39,0.25)' },
};

interface BatchEntry {
  orderId: string;
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  specimen: string;
  resultValue: string;
  flag: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | '';
}

export default function LabBatchEntry({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { results, update } = useLabResults();
  const { patients } = usePatients();
  const patientById = useMemo(() => new Map(patients.map(patient => [patient._id, patient])), [patients]);
  const patientForLab = (patientId?: string) => (patientId ? patientById.get(patientId) : undefined);
  const [batchTestType, setBatchTestType] = useState('');
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  // Every lab order on the bench, whatever the worklist shows.
  const allPendingOrders = useMemo(
    () => results.filter(r => !isImagingStudy(r) && (r.status === 'pending' || r.status === 'in_progress')),
    [results],
  );

  // Unique test types for batch mode
  const pendingTestTypes = useMemo(() => {
    const types = new Set(allPendingOrders.map(o => o.testName));
    return Array.from(types).sort();
  }, [allPendingOrders]);

  // Batch mode: populate entries when test type changes
  useEffect(() => {
    if (batchTestType && true) {
      const orders = allPendingOrders.filter(o => o.testName === batchTestType);
      setBatchEntries(orders.map(o => ({
        orderId: o._id,
        patientId: o.patientId,
        patientName: o.patientName,
        hospitalNumber: o.hospitalNumber,
        specimen: o.specimen,
        resultValue: '',
        flag: '',
      })));
    }
  }, [batchTestType, allPendingOrders]);




  // --- Handlers ---

  const handleBatchSave = async () => {
    const filled = batchEntries.filter(e => e.resultValue.trim() !== '');
    if (filled.length === 0) return;
    setBatchSaving(true);
    try {
      for (const entry of filled) {
        const order = allPendingOrders.find(o => o._id === entry.orderId);
        if (!order) continue;
        const flags = flagResult(order.testName, entry.resultValue);
        const ref = getRefRange(order.testName);
        await update(order._id, {
          status: 'completed' as const,
          result: entry.resultValue,
          unit: ref?.unit || order.unit,
          referenceRange: ref?.referenceStr || order.referenceRange,
          abnormal: flags.abnormal,
          critical: flags.critical,
          completedAt: new Date().toISOString(),
        });
      }
      setBatchTestType('');
      setBatchEntries([]);
    } catch (err) {
      // A result that did not save must not look saved: the entries stay on
      // screen so nothing typed is lost, and the tech is told.
      console.error('Failed to batch save:', err);
      showToast(t('radiology.updateFailed'), 'error');
    } finally {
      setBatchSaving(false);
    }
  };

  // Drop a patient row from the current batch-entry draft before saving. Only
  // removes it from this in-progress batch; the order itself is untouched.
  const handleRemoveBatchEntry = (orderId: string) => {
    setBatchEntries(prev => prev.filter(e => e.orderId !== orderId));
  };

  const handleBatchEntryChange = (orderId: string, value: string) => {
    setBatchEntries(prev => prev.map(e => {
      if (e.orderId !== orderId) return e;
      const order = allPendingOrders.find(o => o._id === orderId);
      const flagRes = order && value ? flagResult(order.testName, value) : null;
      return { ...e, resultValue: value, flag: flagRes ? flagRes.flag : '' };
    }));
  };

  return (
    <FormSlider
      title={t('lab.batchEntry')}
      width={672}
      onClose={onClose}
      footer={<>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
          >
            {t('action.cancel')}
          </button>

          {(
            <button
              onClick={handleBatchSave}
              disabled={batchEntries.filter(e => e.resultValue.trim() !== '').length === 0 || batchSaving}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: batchEntries.some(e => e.resultValue.trim()) ? ACCENT : 'var(--border-light)',
                color: batchEntries.some(e => e.resultValue.trim()) ? '#fff' : 'var(--text-muted)',
              }}
            >
              {batchSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {t('lab.saveAll', { count: batchEntries.filter(e => e.resultValue.trim() !== '').length })}
            </button>
          )}
      </>}
    >
      <div className="space-y-4">
        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {(
            /* ===== Batch Entry Mode ===== */
            <div className="space-y-4">
              {/* Test Type Selection */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                  {t('lab.selectTestType')}
                </label>
                <Select
                  value={batchTestType}
                  onChange={e => setBatchTestType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-[12px] outline-none transition-all"
                  style={{
                    background: 'var(--overlay-subtle)',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="">{t('lab.selectTestTypeOption')}</option>
                  {pendingTestTypes.map(tt => {
                    const count = allPendingOrders.filter(o => o.testName === tt).length;
                    return (
                      <option key={tt} value={tt}>{t('lab.testTypePending', { test: tt, count })}</option>
                    );
                  })}
                </Select>
              </div>

              {/* Reference range for selected test */}
              {batchTestType && (() => {
                const ref = getRefRange(batchTestType);
                const crit = ref ? criticalBoundsInEntryUnit(ref) : {};
                return ref ? (
                  <div className="p-2.5 rounded-xl" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
                    <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
                      {t('lab.reference')}: {ref.referenceStr}
                      {crit.low !== undefined && ` | ${t('lab.criticalLabel')}: ≤${crit.low}`}
                      {crit.high !== undefined && ` | ${t('lab.criticalLabel')}: ≥${crit.high}`}
                    </p>
                  </div>
                ) : null;
              })()}

              {/* Batch Table */}
              {batchTestType ? (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
                  <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth: 520 }}>
                    <thead className="appointment-table-head">
                      <tr style={{ background: 'var(--overlay-subtle)' }}>
                        <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.patient')}</th>
                        <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.specimen')}</th>
                        <th className="text-start px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.result')}</th>
                        <th className="text-center px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('lab.flag')}</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchEntries.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8">
                            <div className="flex flex-col items-center justify-center text-center">
                              <Table className="w-8 h-8 mb-2" style={{ color: 'var(--text-muted)', opacity: 0.15 }} />
                              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('lab.noPendingForType')}</p>
                            </div>
                          </td>
                        </tr>
                      ) : batchEntries.map((entry) => {
                        const ref = getRefRange(batchTestType);
                        return (
                          <tr key={entry.orderId} style={{ borderTop: '1px solid var(--border-light)' }}>
                            <td className="px-3 py-2">
                              <PatientName
                                patient={patientForLab(entry.patientId)}
                                patientId={entry.patientId}
                                name={entry.patientName}
                                showAvatar
                                size={40}
                                secondaryText={entry.hospitalNumber || 'ID not recorded'}
                                nameClassName="text-[11px] font-medium"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{entry.specimen}</span>
                            </td>
                            <td className="px-3 py-2">
                              {ref?.qualitative ? (
                                <Select
                                  value={entry.resultValue}
                                  onChange={e => handleBatchEntryChange(entry.orderId, e.target.value)}
                                  className="w-full px-2 py-1 rounded-lg text-[11px] outline-none"
                                  style={{
                                    background: 'var(--overlay-subtle)',
                                    border: '1px solid var(--border-light)',
                                    color: 'var(--text-primary)',
                                  }}
                                >
                                  <option value="">--</option>
                                  {ref.qualitative.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </Select>
                              ) : (
                                <input
                                  type="number"
                                  step="any"
                                  value={entry.resultValue}
                                  onChange={e => handleBatchEntryChange(entry.orderId, e.target.value)}
                                  placeholder={t('lab.valuePlaceholder')}
                                  className="w-full px-2 py-1 rounded-lg text-[11px] outline-none"
                                  style={{
                                    background: 'var(--overlay-subtle)',
                                    border: '1px solid var(--border-light)',
                                    color: 'var(--text-primary)',
                                  }}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {entry.flag ? (
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
                                  background: FLAG_COLORS[entry.flag as keyof typeof FLAG_COLORS].bg,
                                  color: FLAG_COLORS[entry.flag as keyof typeof FLAG_COLORS].color,
                                }}>{entry.flag}</span>
                              ) : (
                                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>--</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-end">
                              <button
                                onClick={() => handleRemoveBatchEntry(entry.orderId)}
                                title={t('action.remove')}
                                aria-label={t('action.remove')}
                                className="p-1 rounded-md transition-all hover:opacity-80"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Modal Footer */}
      </div>
    </FormSlider>
  );
}
