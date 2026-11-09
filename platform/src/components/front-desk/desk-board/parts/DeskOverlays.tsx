'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import Link from 'next/link';
import { isPathAllowed } from '@/lib/role-routes';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { AppointmentDoc, AppointmentStatus, EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';
import { formatCompactDateTime, formatClockTime } from '@/lib/format-utils';
import { patientDisplayName } from '@/lib/patient-utils';
import AssignDoctorModal, { type AssignDoctorTarget } from '@/components/AssignDoctorModal';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import AppointmentEditModal from '@/components/appointments/AppointmentEditModal';
import { PatientRegistrationForm } from '@/components/patients/registration/PatientRegistrationForm';
import { useTranslation } from '@/lib/i18n/useTranslation';
import BookAppointmentModal from '@/components/appointments/BookAppointmentModal';
import Select from '@/components/Select';
import { RESCHEDULE_SLOTS, formatDayMonthYear, staleOpenVisits, type CheckoutTarget } from '@/lib/front-desk-utils';
import { encounterVisitState } from '@/lib/clinical-flow/visit-state';
import CheckoutModal from '@/components/front-desk/CheckoutModal';
import CheckInModal from '@/components/front-desk/CheckInModal';
import CheckInSlider from '@/components/appointments/CheckInSlider';
import FormSlider from '@/components/overlay/FormSlider';
import StatusChangeSlider from '@/components/appointments/StatusChangeSlider';
import AppointmentRequestsPanel from '@/components/front-desk/AppointmentRequestsPanel';
import { type PatientRegistrationDraft } from '@/lib/patient-registration-draft';
import type { Dispatch, SetStateAction, ComponentProps } from 'react';
import type { DeskCancelTarget, DeskStatusTarget } from '../desk-types';
import type { PendingSyncDoc } from '../desk-metrics';

type SD<T> = Dispatch<SetStateAction<T>>;

export interface DeskOverlaysProps {
  bookingOpen: boolean;
  setBookingOpen: SD<boolean>;
  boardDate: string;
  bookingPatientId: string | undefined;
  setBookingPatientId: SD<string | undefined>;
  closeoutOpen: boolean;
  setCloseoutOpen: SD<boolean>;
  staleVisits: ReturnType<typeof staleOpenVisits>;
  closeStaleVisitAsLwbs: (encounter: EncounterDoc) => Promise<void>;
  router: ReturnType<typeof useRouter>;
  t: ReturnType<typeof useTranslation>['t'];
  requestsOpen: boolean;
  setRequestsOpen: SD<boolean>;
  appointments: AppointmentDoc[];
  today: string;
  currentUser: NonNullable<ReturnType<typeof useAuth>['currentUser']>;
  setEditAppointment: SD<AppointmentDoc | null>;
  updateAppointmentStatus: ReturnType<typeof useAppointments>['updateStatus'];
  unbookedOpen: boolean;
  setUnbookedOpen: SD<boolean>;
  assignedUnbooked: PatientDoc[];
  pendingSyncOpen: boolean;
  setPendingSyncOpen: SD<boolean>;
  pendingSyncDocs: PendingSyncDoc[];
  deniedReasonById: Map<string, string>;
  runSyncNow: () => Promise<void>;
  syncNowBusy: boolean;
  editAppointment: AppointmentDoc | null;
  patients: PatientDoc[];
  assignTarget: AssignDoctorTarget | null;
  setAssignTarget: SD<AssignDoctorTarget | null>;
  checkoutTarget: CheckoutTarget | null;
  setCheckoutTarget: SD<CheckoutTarget | null>;
  handleCompleteCheckout: ComponentProps<typeof CheckoutModal>['onComplete'];
  canUseRoute: (href: string) => boolean;
  registerOpen: boolean;
  setRegisterOpen: SD<boolean>;
  openFullRegistration: () => Promise<void>;
  captureRegistrationDraft: (draft: PatientRegistrationDraft) => void;
  setPanelView: (next: 'all' | 'appointments' | 'pending' | 'queue' | 'registered') => void;
  rescheduleTarget: AppointmentDoc | null;
  setRescheduleTarget: SD<AppointmentDoc | null>;
  reschedSaving: boolean;
  rescheduleDate: string;
  setRescheduleDate: SD<string>;
  rescheduleTime: string;
  setRescheduleTime: SD<string>;
  submitReschedule: () => Promise<void>;
  noShowTarget: AppointmentDoc | null;
  setNoShowTarget: SD<AppointmentDoc | null>;
  handleNoShow: (appt: AppointmentDoc) => Promise<void>;
  cancelTarget: DeskCancelTarget | null;
  setCancelTarget: SD<DeskCancelTarget | null>;
  handleCancelAppointment: () => Promise<void>;
  cancelReason: string;
  setCancelReason: SD<string>;
  checkInTarget: AppointmentDoc | null;
  setCheckInTarget: SD<AppointmentDoc | null>;
  checkInNew: boolean;
  statusTarget: DeskStatusTarget | null;
  setStatusTarget: SD<DeskStatusTarget | null>;
  applyAppointmentStatus: (appt: AppointmentDoc, status: AppointmentStatus, mirrorTriage?: TriageDoc) => Promise<void>;
  handleWalkInStatusChange: (triage: TriageDoc, status: AppointmentStatus, silent?: boolean) => Promise<void>;
  handleUndoCheckIn: (appt: AppointmentDoc) => Promise<void>;
}

/**
 * Every modal / slider the front-desk board can open. Moved verbatim from the
 * bottom of page.tsx; all state stays in FrontDeskBoard and arrives as props.
 */
export default function DeskOverlays({
  bookingOpen, setBookingOpen, boardDate, bookingPatientId, setBookingPatientId, closeoutOpen, setCloseoutOpen, staleVisits, closeStaleVisitAsLwbs, router, t, requestsOpen, setRequestsOpen, appointments, today, currentUser, setEditAppointment, updateAppointmentStatus, unbookedOpen, setUnbookedOpen, assignedUnbooked, pendingSyncOpen, setPendingSyncOpen, pendingSyncDocs, deniedReasonById, runSyncNow, syncNowBusy, editAppointment, patients, assignTarget, setAssignTarget, checkoutTarget, setCheckoutTarget, handleCompleteCheckout, canUseRoute, registerOpen, setRegisterOpen, openFullRegistration, captureRegistrationDraft, setPanelView, rescheduleTarget, setRescheduleTarget, reschedSaving, rescheduleDate, setRescheduleDate, rescheduleTime, setRescheduleTime, submitReschedule, noShowTarget, setNoShowTarget, handleNoShow, cancelTarget, setCancelTarget, handleCancelAppointment, cancelReason, setCancelReason, checkInTarget, setCheckInTarget, checkInNew, statusTarget, setStatusTarget, applyAppointmentStatus, handleWalkInStatusChange, handleUndoCheckIn
}: DeskOverlaysProps) {
  return (
    <>
        {bookingOpen && (
          <BookAppointmentModal
            defaultDate={boardDate}
            defaultPatientId={bookingPatientId}
            onClose={() => { setBookingOpen(false); setBookingPatientId(undefined); }}
          />
        )}

        {closeoutOpen && (
          <Modal onClose={() => setCloseoutOpen(false)} width={560} labelledBy="fd-closeout-title">
            <DialogFrame>
              <DialogHeader titleId="fd-closeout-title" title={t('ui.needsCloseOut')} description={t('ui.openVisitsFromAPrevious')} onClose={() => setCloseoutOpen(false)} />
              <DialogBody className="space-y-4">
              {staleVisits.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('ui.nothingWaitingEveryOpenVisit')}</p>
              )}
              {staleVisits.map(({ encounter, lastMovedAt, canCloseAsLwbs }) => (
                <div key={encounter._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {encounter.patientName || encounter.patientId}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {encounterVisitState(encounter.status).label || encounter.status} {t('ui.lastMovement')} {formatCompactDateTime(lastMovedAt)}
                    </p>
                  </div>
                  {canCloseAsLwbs ? (
                    <button
                      type="button"
                      onClick={() => void closeStaleVisitAsLwbs(encounter)}
                      style={{ padding: '6px 12px', borderRadius: 0, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--color-danger-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {t('ui.closeAsLwbs')}
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('ui.needsCheckout')}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setCloseoutOpen(false); router.push(`/patients/${encounter.patientId}`); }}
                    style={{ padding: '6px 12px', borderRadius: 0, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--accent-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {t('appointments.openChart')}
                  </button>
                </div>
              ))}
              </DialogBody>
            </DialogFrame>
          </Modal>
        )}

        {requestsOpen && (
          <AppointmentRequestsPanel
            appointments={appointments}
            today={today}
            facilityId={currentUser?.hospitalId}
            onClose={() => setRequestsOpen(false)}
            onEdit={appt => { setRequestsOpen(false); setEditAppointment(appt); }}
            updateStatus={updateAppointmentStatus}
          />
        )}

        {unbookedOpen && (
          <Modal onClose={() => setUnbookedOpen(false)} width={560} labelledBy="fd-unbooked-title">
            <DialogFrame>
              <DialogHeader titleId="fd-unbooked-title" title={t('frontDesk.assignedUnbooked')} description={t('frontDesk.assignedUnbookedBody')} onClose={() => setUnbookedOpen(false)} />
              <DialogBody className="space-y-4">
              {assignedUnbooked.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('frontDesk.assignedUnbookedEmpty')}</p>
              )}
              {assignedUnbooked.map(p => (
                <div key={p._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{patientDisplayName(p)}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {p.assignedDoctorName || ''}{p.assignedAt ? ` · ${formatCompactDateTime(p.assignedAt)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setUnbookedOpen(false); setBookingPatientId(p._id); setBookingOpen(true); }}
                    style={{ padding: '6px 12px', borderRadius: 0, border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {t('frontDesk.bookThisPatient')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setUnbookedOpen(false); router.push(`/patients/${p._id}`); }}
                    style={{ padding: '6px 12px', borderRadius: 0, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--accent-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {t('frontDesk.openChart')}
                  </button>
                </div>
              ))}
              </DialogBody>
            </DialogFrame>
          </Modal>
        )}

        {pendingSyncOpen && (
          <Modal onClose={() => setPendingSyncOpen(false)} width={600} labelledBy="fd-pending-sync-title">
            <DialogFrame>
              <DialogHeader titleId="fd-pending-sync-title" title={t('sync.docPendingLabel')} description={t('frontDesk.pendingSyncBody')} onClose={() => setPendingSyncOpen(false)} />
              <DialogBody className="space-y-4">
              {pendingSyncDocs.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('frontDesk.pendingSyncEmpty')}</p>
              )}
              {pendingSyncDocs.map(doc => {
                const refused = deniedReasonById.get(doc.id) || (doc.status === 'failed' ? doc.error : undefined);
                return (
                  <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {doc.name || doc.id}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                        {t(`frontDesk.syncKind.${doc.kind}`)} · {t(`frontDesk.syncStatus.${doc.status}`)}
                        {doc.at ? ` · ${formatCompactDateTime(doc.at)}` : ''}
                      </p>
                      {(refused || (doc.status === 'conflict' && doc.error)) && (
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-danger-text)' }}>
                          {refused ? t('frontDesk.syncRefused', { reason: refused }) : doc.error}
                        </p>
                      )}
                      {doc.status === 'conflict' && (
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                          {t('frontDesk.syncConflictHint')}
                          {currentUser && isPathAllowed(currentUser.role, '/admin/conflicts') && (
                            <> <Link href="/admin/conflicts" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{t('frontDesk.syncConflictResolve')}</Link></>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              </DialogBody>
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => { void runSyncNow(); }}
                  disabled={syncNowBusy}
                  aria-busy={syncNowBusy}
                  style={{ padding: '6px 12px', borderRadius: 0, border: '1px solid var(--border-medium)', background: 'var(--bg-card)', color: 'var(--accent-text)', fontSize: 12, fontWeight: 600, cursor: syncNowBusy ? 'progress' : 'pointer', opacity: syncNowBusy ? 0.7 : 1 }}
                >
                  {syncNowBusy ? t('frontDesk.syncNowRunning') : t('frontDesk.syncNow')}
                </button>
              </DialogFooter>
            </DialogFrame>
          </Modal>
        )}

        {editAppointment && (
          <AppointmentEditModal
            appointment={editAppointment}
            appointments={appointments}
            patient={patients.find(p => p._id === editAppointment.patientId)}
            onClose={() => setEditAppointment(null)}
          />
        )}

        {assignTarget && (
          <AssignDoctorModal
            target={assignTarget}
            onClose={() => setAssignTarget(null)}
          />
        )}

        {checkoutTarget && (
          <CheckoutModal
            target={checkoutTarget}
            onClose={() => setCheckoutTarget(null)}
            onComplete={handleCompleteCheckout}
            canCollectPayment={canUseRoute('/payments')}
            canRecordDebt={canUseRoute('/payments') || currentUser?.role === 'front_desk'}
            onCollectPayment={(pid) => {
              router.push(`/payments?patientId=${pid}`);
            }}
          />
        )}

        {registerOpen && (
          <Modal variant="slider" onClose={() => setRegisterOpen(false)} width={1180} disableBackdropClose labelledBy="patient-registration-dialog-title">
            <DialogFrame>
              <DialogHeader
                titleId="patient-registration-dialog-title"
                title={t('frontDesk.registerNewPatient')}
                onClose={() => setRegisterOpen(false)}
                onExpand={openFullRegistration}
              />
              <DialogBody flush>
              <div className="ehr-checkin-dialog-body fd-reg-slider">
                <PatientRegistrationForm
                  embedded
                  onDraftChange={captureRegistrationDraft}
                  onCancel={() => setRegisterOpen(false)}
                  onRegistered={() => {
                    setRegisterOpen(false);
                    setPanelView('registered');
                    router.refresh();
                  }}
                  // Register AND check in, from the desk that does both. The
                  // walk-in dialog books today's visit already checked in and
                  // opens the encounter triage and rooming join, then returns
                  // the clerk here — the same hand-off the full-page form has
                  // always made, which a dialog could not reach.
                  onCheckIn={(patientId) => {
                    setRegisterOpen(false);
                    router.push(`/appointments?walkIn=${patientId}`);
                  }}
                />
              </div>
              </DialogBody>
            </DialogFrame>
          </Modal>
        )}

        {rescheduleTarget && (
          <Modal onClose={() => !reschedSaving && setRescheduleTarget(null)} width={420} labelledBy="reschedule-dialog-title">
            <DialogFrame>
              <DialogHeader titleId="reschedule-dialog-title" title={t('ui.rescheduleAppointment')} description={<>{rescheduleTarget.patientName} {t('ui.currently')} {formatDayMonthYear(rescheduleTarget.appointmentDate)} {formatClockTime(rescheduleTarget.appointmentTime)}</>} onClose={() => !reschedSaving && setRescheduleTarget(null)} />
              <DialogBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>{t('ui.newDate')}</label>
                  <input type="date" value={rescheduleDate} min={today} onChange={e => setRescheduleDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>{t('ui.newTime')}</label>
                  <Select value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)}>
                    {RESCHEDULE_SLOTS.map(slot => <option key={slot} value={slot}>{formatClockTime(slot)}</option>)}
                  </Select>
                </div>
              </div>
              </DialogBody>
              <DialogFooter>
                <button type="button" className="btn btn-secondary" onClick={() => setRescheduleTarget(null)} disabled={reschedSaving}>
                  {t('action.cancel')}
                </button>
                <button type="button" className="btn btn-primary" onClick={submitReschedule} disabled={reschedSaving || !rescheduleDate || !rescheduleTime}>
                  {reschedSaving ? 'Saving…' : 'Reschedule'}
                </button>
              </DialogFooter>
            </DialogFrame>
          </Modal>
        )}

        {noShowTarget && (
          <FormSlider
            title={t('ui.markAsNoShow')}
            subtitle={`${noShowTarget.patientName} · ${formatClockTime(noShowTarget.appointmentTime)}`}
            width={440}
            onClose={() => setNoShowTarget(null)}
            footer={<>
              <button type="button" className="btn btn-secondary" onClick={() => setNoShowTarget(null)}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={() => handleNoShow(noShowTarget)}>{t('ui.markNoShow')}</button>
            </>}
          >
            <p className="status-slider-body">Check the waiting room first; this removes them from today&apos;s arrivals.</p>
          </FormSlider>
        )}

        {cancelTarget && (
          <FormSlider
            title={t('ui.cancelThisAppointment')}
            subtitle={`${cancelTarget.appt.patientName} · ${formatClockTime(cancelTarget.appt.appointmentTime)}`}
            width={440}
            onClose={() => setCancelTarget(null)}
            footer={<>
              <button type="button" className="btn btn-secondary" onClick={() => setCancelTarget(null)}>{t('appointments.goBack')}</button>
              <button type="button" className="btn btn-danger-solid" onClick={() => void handleCancelAppointment()}>
                {t('ui.cancelAppointment')}
              </button>
            </>}
          >
              <p className="status-slider-body">The booking stays on record under Finished; you can undo from the notification or reopen it later.</p>
              <label className="block text-xs font-semibold mt-4 mb-1" style={{ color: 'var(--text-secondary)' }} htmlFor="front-desk-cancel-reason">
                {t('screenings.declineReason')}
              </label>
              <textarea
                id="front-desk-cancel-reason"
                value={cancelReason}
                onChange={event => setCancelReason(event.target.value)}
                rows={2}
                placeholder={t('ui.eGPatientCalledTo')}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 0, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
          </FormSlider>
        )}

        {checkInTarget && checkInNew && (
          <CheckInSlider
            appointment={checkInTarget}
            hospitalNumber={patients.find(p => p._id === checkInTarget.patientId)?.hospitalNumber}
            onClose={() => setCheckInTarget(null)}
          />
        )}

        {statusTarget && (
          <StatusChangeSlider
            patientName={statusTarget.appt?.patientName || statusTarget.triage?.patientName || ''}
            appointmentTime={statusTarget.appt?.appointmentTime}
            from={statusTarget.appt?.status ?? statusTarget.triage?.visitStatus}
            to={statusTarget.status}
            onClose={() => setStatusTarget(null)}
            onConfirm={() => (statusTarget.appt
              ? applyAppointmentStatus(statusTarget.appt, statusTarget.status, statusTarget.triage)
              : statusTarget.triage ? handleWalkInStatusChange(statusTarget.triage, statusTarget.status) : undefined)}
          />
        )}

        {checkInTarget && !checkInNew && (
          <CheckInModal
            appt={checkInTarget}
            onClose={() => setCheckInTarget(null)}
            onUndoCheckIn={handleUndoCheckIn}
            onViewPatient={(pid) => router.push(`/patients/${pid}`)}
          />
        )}
    </>
  );
}
