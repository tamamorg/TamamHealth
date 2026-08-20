'use client';

import { useRowCollapse } from '@/components/ehr/EhrCareDashboard';
import AppointmentEditModal from '@/components/appointments/AppointmentEditModal';

/**
 * The inline appointment editor, wired to close its own row on save.
 *
 * The rows are built in a `useMemo`, where `useRowCollapse()` cannot be
 * called — so the hook lives here, in a component that renders inside the
 * expanded row and therefore sees the context. Without it these editors were
 * passed `onClose={() => undefined}`: saving showed its toast and left the
 * panel sitting open.
 */
export function RowAppointmentEditor({
  appointment,
  appointments,
  patient,
}: {
  appointment: React.ComponentProps<typeof AppointmentEditModal>['appointment'];
  appointments: React.ComponentProps<typeof AppointmentEditModal>['appointments'];
  patient: React.ComponentProps<typeof AppointmentEditModal>['patient'];
}) {
  const collapse = useRowCollapse();
  return (
    <AppointmentEditModal
      inline
      // The row's own status pill is the picker (see EhrCareDashboard's status
      // control): without this the expanded row offered the same ladder twice.
      statusInRow
      appointment={appointment}
      appointments={appointments}
      patient={patient}
      onClose={collapse}
    />
  );
}
