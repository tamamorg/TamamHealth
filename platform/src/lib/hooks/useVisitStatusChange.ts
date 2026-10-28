'use client';

/**
 * The one write path behind every dashboard's visit-status dropdown.
 *
 * Each role dashboard renders its own rows, but a status pick means the same
 * thing wherever it is made: the role decides which rungs are offered
 * (`appointmentStatusOptionsForRole`, the list `updateAppointmentStatus`
 * enforces), an exit asks why before it lands, and the write carries the
 * signed-in user so the status history, the audit row and the visit
 * notifications all name who moved the patient. Keeping it here stops the
 * dashboards drifting apart again — the station boards once had no picker at
 * all, and the clinical board offered rungs the service refused.
 *
 * The change reaches every other screen at the facility through the
 * appointments database's live feed; nothing here needs to broadcast it.
 */

import { useCallback, useMemo } from 'react';
import type { AppointmentStatus } from '../db-types';
import { useAuth } from '../context';
import { useToast } from '@/components/Toast';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useTranslation } from '../i18n/useTranslation';
import { describeError } from '../user-facing-error';
import {
  APPOINTMENT_STATION_ROLES,
  APPOINTMENT_STATUS_I18N_KEYS,
  appointmentStatusNeedsReason,
  canRoleMoveAppointment,
  appointmentStatusOptionsForRole,
  canonicalAppointmentStatus,
} from '../appointment-status';

export interface VisitStatusTarget {
  appointmentId: string;
  patientName?: string;
  status: AppointmentStatus;
}

export interface VisitStatusOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function useVisitStatusChange() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const { t } = useTranslation();

  const choices = useMemo(() => appointmentStatusOptionsForRole(currentUser?.role), [currentUser?.role]);
  const labelFor = useCallback((status: AppointmentStatus) => t(APPOINTMENT_STATUS_I18N_KEYS[status]), [t]);

  /** Dropdown options for a row: the role's rungs, led by the current status
   *  (disabled) when the role cannot set it, so the control reads correctly. */
  const optionsFor = useCallback((status: AppointmentStatus): VisitStatusOption[] => {
    if (choices.length === 0) return [];
    const current = canonicalAppointmentStatus(status);
    // Only the moves this role may make from THIS status — a station sees no
    // picker on a visit that is not checked in, nobody but reception can
    // reopen a cancelled one.
    const allowed = choices.filter(option => option === current || canRoleMoveAppointment(currentUser?.role, status, option));
    if (!allowed.some(option => option !== current)) return [];
    return [
      ...(allowed.includes(current) ? [] : [{ value: current, label: labelFor(status), disabled: true }]),
      ...allowed.map(option => ({ value: option, label: labelFor(option) })),
    ];
  }, [choices, currentUser?.role, labelFor]);

  const change = useCallback(async (target: VisitStatusTarget, next: AppointmentStatus): Promise<boolean> => {
    if (canonicalAppointmentStatus(target.status) === next) return false;
    let reason: string | undefined;
    if (appointmentStatusNeedsReason(next)) {
      const answer = await confirmPrompt({
        title: t('visitStatus.reasonTitle', { status: labelFor(next) }),
        message: target.patientName ? t('visitStatus.reasonMessage', { name: target.patientName }) : undefined,
        confirmLabel: labelFor(next),
        inputLabel: t('visitStatus.reasonLabel'),
        inputRequired: true,
        tone: 'warning',
      });
      if (answer === null) return false;
      reason = answer.trim();
    }
    try {
      const { updateAppointmentStatus, findLinkedEncounterForAppointment } = await import('../services/appointment-service');
      // Completing a visit closes its clinical encounter, which only the
      // clinical team or reception may do while steps are still open. Say so,
      // rather than let the refused write read as "try again".
      if (next === 'completed' && currentUser?.role && APPOINTMENT_STATION_ROLES.includes(currentUser.role)) {
        const linked = await findLinkedEncounterForAppointment(target.appointmentId);
        const { isTerminal } = await import('../clinical-flow/encounter-journey');
        if (linked && !isTerminal(linked.status)) {
          showToast(t('visitStatus.openEncounter', { name: target.patientName || t('visitStatus.patient') }), 'warning');
          return false;
        }
      }
      const updated = await updateAppointmentStatus(target.appointmentId, next, {
        actorId: currentUser?._id,
        actorName: currentUser?.name || currentUser?.username,
        actorRole: currentUser?.role,
        ...(reason ? { note: reason } : {}),
        ...(reason && next === 'cancelled' ? {
          cancelledReason: reason,
          cancelledBy: currentUser?._id,
          cancelledByName: currentUser?.name || currentUser?.username,
        } : {}),
      });
      if (!updated) throw new Error(t('visitStatus.notChanged'));
      showToast(t('visitStatus.changed', { name: target.patientName || t('visitStatus.patient'), status: labelFor(next) }), 'success');
      return true;
    } catch (error) {
      showToast(describeError(error, t('visitStatus.notChanged')), 'error');
      return false;
    }
  }, [confirmPrompt, currentUser, labelFor, showToast, t]);

  return { canChange: choices.length > 0, optionsFor, change, labelFor, groupLabel: t('visitStatus.groupLabel') };
}
