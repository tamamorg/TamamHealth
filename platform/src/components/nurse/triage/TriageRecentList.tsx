'use client';

import { chartFormHref } from '@/components/ehr/chart/panels/role-form-access';
import { Clock, Eye, ClipboardList, CheckCircle2, LogIn, Send, LogOut, AlertTriangle, X } from '@/components/icons/lucide';
import { ACCENT } from '../shared';
import ListSearch from '../ListSearch';
import RowActionsMenu, { type RowAction } from '@/components/referrals/RowActionsMenu';
import { initials, shortenPersonName } from '@/lib/patient-utils';
import { modeOfArrivalLabel } from './triage-helpers';
import { waitLabel } from '@/components/ehr/EhrVisitPopup';
import type { TriageFormState } from './useTriageForm';

export function TriageRecentList({ f }: { f: TriageFormState }) {
  const { t, router, triagePhotoById, historySearch, setHistorySearch, nowMs, showCompletedToday, setShowCompletedToday, loadTriageForEdit, setTriageStatus, markLeftWithoutBeingSeen, escalateToEmergency, scopedHistory, displayedTriageRows, lockedPatientId } = f;
  return (
    <>
      {!lockedPatientId && <div data-tour="triage-recent" className="lg:flex-[1] card-elevated overflow-hidden flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: ACCENT }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {lockedPatientId ? 'Triage history' : t('nurse.recentTriages')}
            </h3>
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('nurse.total', { count: scopedHistory.length })}</span>
        </div>
        <div className="px-3 py-2.5 flex items-center gap-2 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <ListSearch value={historySearch} onChange={setHistorySearch} placeholder={t('nurse.searchPatientPlaceholder')} />
          {/* A queue by default (still-active triages only); this is the
              opt-in to also see who was admitted/discharged/referred/left
              today, without the list defaulting to a lifetime log. */}
          <label className="flex items-center gap-1 text-[9px] font-semibold flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showCompletedToday} onChange={event => setShowCompletedToday(event.target.checked)} />
            {t('nurse.showCompletedToday')}
          </label>
        </div>
        <div className="p-3 flex-1 overflow-y-auto">
          {displayedTriageRows.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>{t('nurse.noTriages')}</p>
          ) : (
            <div className="ehr-queue-cards ehr-queue-cards--triage">
              <div className="ehr-queue-guide ehr-queue-guide--triage" aria-hidden="true">
                {['Patient', 'Source', 'Wait', 'Action'].map(head => (
                  <span key={head}>{head}</span>
                ))}
              </div>
              {displayedTriageRows.slice(0, 12).map(ti => {
                const minutesAgo = Math.max(0, Math.floor((nowMs - new Date(ti.triagedAt).getTime()) / 60000));
                const actions: RowAction[] = [
                  { key: 'view', label: t('nurse.triageActionView'), icon: <Eye />, onClick: () => router.push(`/patients/${ti.patientId}?tab=vitals`) },
                  { key: 'edit', label: t('action.edit'), icon: <ClipboardList />, onClick: () => loadTriageForEdit(ti) },
                ];
                if (ti.status !== 'seen' && ti.status !== 'discharged' && ti.status !== 'admitted') {
                  actions.push({ key: 'seen', label: t('nurse.triageActionMarkSeen'), tone: 'success', icon: <CheckCircle2 />, onClick: () => setTriageStatus(ti, 'seen', t('nurse.triageActionMarkSeen')) });
                }
                if (ti.status !== 'admitted') {
                  actions.push({ key: 'admit', label: t('nurse.triageActionAdmit'), icon: <LogIn />, onClick: () => setTriageStatus(ti, 'admitted', t('nurse.triageActionAdmit')) });
                }
                if (ti.status !== 'referred') {
                  actions.push({ key: 'refer', label: t('nurse.triageActionRefer'), icon: <Send />, onClick: () => setTriageStatus(ti, 'referred', t('nurse.triageActionRefer')) });
                }
                if (ti.status !== 'discharged') {
                  actions.push({ key: 'discharge', label: t('nurse.triageActionDischarge'), tone: 'danger', icon: <LogOut />, onClick: () => setTriageStatus(ti, 'discharged', t('nurse.triageActionDischarge')) });
                }
                // Escalation and LWBS act on the visit's encounter, so they
                // are only offered while the patient is still waiting and the
                // triage is linked to one (KAN-100).
                // LWBS also applies once triage is done but no room or provider
                // has freed up — that wait is exactly when patients walk away.
                if ((ti.status === 'pending' || ti.status === 'seen') && ti.encounterId) {
                  if (ti.status === 'pending') actions.push({ key: 'escalate', label: t('nurse.triageActionEscalate'), tone: 'danger', icon: <AlertTriangle />, onClick: () => escalateToEmergency(ti) });
                  actions.push({ key: 'lwbs', label: t('nurse.triageActionLwbs'), icon: <X />, onClick: () => markLeftWithoutBeingSeen(ti) });
                }
                return (
                  <div key={ti._id} className="ehr-queue-card ehr-queue-card--triage" data-triage={ti.priority}>
                    <div className="ehr-queue-patient">
                      <span className="ehr-patient-icon" data-acuity={ti.priority}>
                        {triagePhotoById.get(ti.patientId)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={triagePhotoById.get(ti.patientId)} alt="" className="ehr-patient-icon-photo" />
                          : initials(ti.patientName)}
                      </span>
                      <div className="ehr-queue-patient-text">
                        {/* Clicking a patient in a triage list opens their own
                            triage page — this list is a queue of people to
                            triage, so the name leads to triaging them rather
                            than to the chart. The chart is still one row-menu
                            entry away. On that page itself the name is already
                            the subject, so it is plain text. */}
                        {lockedPatientId ? (
                          <span className="ehr-queue-name">{shortenPersonName(ti.patientName)}</span>
                        ) : (
                          <button type="button" className="ehr-queue-name" onClick={() => router.push(chartFormHref(ti.patientId, 'triage-form'))} title={`Triage ${ti.patientName}`}>
                            {shortenPersonName(ti.patientName)}
                          </button>
                        )}
                        <p>{ti.chiefComplaint || t('nurse.noComplaintRecorded')}</p>
                      </div>
                    </div>

                    <div className="ehr-queue-cell ehr-queue-muted-cell">
                      {modeOfArrivalLabel(ti.modeOfArrival, t)}
                    </div>

                    <div className="ehr-queue-cell ehr-queue-num-col">
                      <div className="ehr-queue-wait">
                        <strong>{new Date(ti.triagedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <small>{waitLabel(minutesAgo)}</small>
                      </div>
                    </div>

                    <div className="ehr-queue-actions">
                      <RowActionsMenu ariaLabel={t('nurse.colActions')} actions={actions} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>}
    </>
  );
}
