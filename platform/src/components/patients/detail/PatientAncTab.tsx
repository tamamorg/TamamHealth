'use client';

/**
 * Antenatal care, in the patient chart: the mother's ANC visits (oldest
 * first, the WHO contact order), their risk, and the birth plan from the
 * latest visit. The /anc register is the list of mothers; opening one lands
 * here, so a mother's pregnancy is read in her own record, beside her
 * vitals, labs and medicines, rather than in a side panel of the register.
 */
import { useState } from 'react';
import ChartSection from '@/components/ehr/chart/ChartSection';
import Badge, { type BadgeTone } from '@/components/Badge';
import RowActionsMenu from '@/components/RowActionsMenu';
import AncVisitEditor from '@/components/anc/AncVisitEditor';
import { ClipboardList } from '@/components/icons/lucide';
import { FOCUSED_ROW_STYLE } from '@/components/ehr/chart/sections/rowFocus';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ANCVisitDoc } from '@/lib/db-types';

const RISK_TONE: Record<ANCVisitDoc['riskLevel'], BadgeTone> = { low: 'info', moderate: 'warning', high: 'danger' };

export default function PatientAncTab({ visits, canEdit, onRegister, focusId, onChanged }: {
  visits: ANCVisitDoc[];
  canEdit: boolean;
  /** Opens the ANC register's form for this mother; omitted when not allowed. */
  onRegister?: () => void;
  focusId?: string;
  /** After an edit, so the chart re-reads the visits. */
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<ANCVisitDoc | null>(null);
  const ordered = [...visits].sort((a, b) => a.visitNumber - b.visitNumber || a.visitDate.localeCompare(b.visitDate));
  const latest = ordered[ordered.length - 1];
  const riskLabel = (r: ANCVisitDoc['riskLevel']) => t(r === 'high' ? 'ancChart.riskHigh' : r === 'moderate' ? 'ancChart.riskModerate' : 'ancChart.riskLow');

  return (
    <div className="space-y-4">
      <ChartSection title={t('ancChart.title')} addLabel={t('ancChart.register')} onAdd={onRegister}>
        <table className="tamam-table">
          <thead>
            <tr>
              <th>{t('ancChart.visit')}</th>
              <th>{t('ancChart.visitDate')}</th>
              <th>{t('ancChart.ga')}</th>
              <th>{t('ancChart.bp')}</th>
              <th>{t('ancChart.weight')}</th>
              <th>{t('ancChart.hb')}</th>
              <th>{t('ancChart.fhr')}</th>
              <th>{t('ancChart.risk')}</th>
              <th>{t('chart.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ cursor: 'default', background: 'transparent' }}>
                  <div className="tamam-empty-state">
                    <ClipboardList />
                    <p>{t('ancChart.empty')}</p>
                  </div>
                </td>
              </tr>
            )}
            {ordered.map(v => (
              <tr key={v._id} id={`anc-row-${v._id}`} style={v._id === focusId ? FOCUSED_ROW_STYLE : undefined}>
                <td><strong>{t('ancChart.visitN', { n: v.visitNumber })}</strong>
                  {v.notes && <div className="appointment-card-provider"><span>{v.notes}</span></div>}
                  {(v.riskFactors?.length ?? 0) > 0 && (
                    <div className="appointment-card-provider"><span>{(v.riskFactors || []).map(rf => rf.replace(/_/g, ' ')).join(' · ')}</span></div>
                  )}
                </td>
                <td>{v.visitDate}</td>
                <td className="tamam-num">{t('ancChart.weeks', { n: v.gestationalAge })}</td>
                <td className="tamam-num">{v.bloodPressure || '—'}</td>
                <td className="tamam-num">{v.weight ? `${v.weight} kg` : '—'}</td>
                <td className="tamam-num">{v.hemoglobin ? `${v.hemoglobin} g/dL` : '—'}</td>
                <td className="tamam-num">{v.fetalHeartRate ? `${v.fetalHeartRate} bpm` : '—'}</td>
                <td><Badge tone={RISK_TONE[v.riskLevel] || 'info'}>{riskLabel(v.riskLevel)}</Badge></td>
                <td>
                  {canEdit && (
                    <RowActionsMenu
                      ariaLabel={t('ancChart.rowActions')}
                      actions={[{ key: 'edit', label: t('action.edit'), onClick: () => setEditing(v) }]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartSection>

      {latest && (
        <ChartSection title={t('ancChart.birthPlan')}>
          <table className="tamam-table">
            <thead>
              <tr>
                <th>{t('ancChart.deliveryFacility')}</th>
                <th>{t('ancChart.transport')}</th>
                <th>{t('ancChart.bloodDonor')}</th>
                <th>{t('ancChart.nextVisit')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{latest.birthPlan?.facility || '—'}</td>
                <td>{latest.birthPlan?.transport || '—'}</td>
                <td>{latest.birthPlan?.bloodDonor || '—'}</td>
                <td><strong>{latest.nextVisitDate || '—'}</strong></td>
              </tr>
            </tbody>
          </table>
        </ChartSection>
      )}

      {editing && <AncVisitEditor visit={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </div>
  );
}
