'use client';

import { Loader2 } from '@/components/icons/lucide';
import Badge, { toneForStatus } from '@/components/Badge';
import { patientInitials, avatarTint } from '@/lib/patient-utils';
import { useMobileShellState } from '@/lib/mobile-shell/use-mobile-shell-state';
import { useClinicalDashboardData } from '@/lib/mobile-shell/use-clinical-dashboard-data';
import { useLabDashboardData } from '@/lib/mobile-shell/use-lab-dashboard-data';
import { usePharmacyDashboardData } from '@/lib/mobile-shell/use-pharmacy-dashboard-data';
import { useFrontDeskDashboardData } from '@/lib/mobile-shell/use-frontdesk-dashboard-data';
import type { MobileDashboardArchetype, MobileLane, MobileDashboardData } from '@/lib/mobile-shell/dashboard-strategy';
import type { AppointmentDoc, LabResultDoc, PrescriptionDoc } from '@/lib/db-types';
import MobileLaneBoard from './MobileLaneBoard';
import MobileOutstandingList from './MobileOutstandingList';

interface MobileDashboardViewProps {
  archetype: MobileDashboardArchetype;
}

function AppointmentCard({ appt, onOpen }: { appt: AppointmentDoc; onOpen: () => void }) {
  const initials = patientInitials({ firstName: appt.patientName.split(' ')[0], surname: appt.patientName.split(' ').slice(-1)[0] });
  return (
    <article className="mobile-appt-card" onClick={onOpen} role="button" tabIndex={0}>
      <strong className="mobile-appt-time">{appt.appointmentTime}</strong>
      <span className="mobile-appt-avatar" style={avatarTint(appt.patientName)}>
        {initials}
      </span>
      <span className="mobile-appt-meta">
        <p className="mobile-appt-name">{appt.patientName}</p>
        <p className="mobile-appt-reason">{appt.reason}</p>
      </span>
      <b className="mobile-appt-dept">{appt.department}</b>
    </article>
  );
}

function SimpleRowCard({ title, subtitle, status, onOpen }: { title: string; subtitle: string; status?: string; onOpen?: () => void }) {
  return (
    <article className="mobile-chart-card mobile-chart-row-card" onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      {status && <Badge tone={toneForStatus(status)} size="sm">{status}</Badge>}
    </article>
  );
}

function DateHeading() {
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="mobile-dashboard-date-row">
      <h2>{todayLabel}</h2>
    </div>
  );
}

function GenericArchetypeDashboard({
  data,
  renderItem,
}: {
  data: MobileDashboardData;
  renderItem: (item: never) => React.ReactNode;
}) {
  const shell = useMobileShellState();

  if (data.loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mobile-dashboard">
      <DateHeading />
      <MobileLaneBoard
        lanes={data.lanes as MobileLane<never>[]}
        activeLane={shell.lane}
        onLaneChange={(key) => shell.setLane(key as typeof shell.lane)}
        renderItem={renderItem}
        emptyLabel="Nothing in this lane"
      />
      <MobileOutstandingList items={data.outstanding} />
    </div>
  );
}

function LabDashboard() {
  const data = useLabDashboardData();
  return (
    <GenericArchetypeDashboard
      data={data}
      renderItem={(r: LabResultDoc) => <SimpleRowCard title={r.patientName} subtitle={r.testName} status={r.status} />}
    />
  );
}

function PharmacyDashboard() {
  const data = usePharmacyDashboardData();
  return (
    <GenericArchetypeDashboard
      data={data}
      renderItem={(rx: PrescriptionDoc) => <SimpleRowCard title={rx.patientName} subtitle={rx.medication} status={rx.orderStatus || rx.status} />}
    />
  );
}

function FrontDeskDashboard() {
  const shell = useMobileShellState();
  const data = useFrontDeskDashboardData();
  return (
    <GenericArchetypeDashboard
      data={data}
      renderItem={(appt: AppointmentDoc) => (
        <AppointmentCard appt={appt} onOpen={() => shell.openChart(appt.patientId)} />
      )}
    />
  );
}

function ClinicalDashboard() {
  const shell = useMobileShellState();
  const data = useClinicalDashboardData();

  if (data.loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mobile-dashboard">
      <div className="mobile-dashboard-date-row">
        <h2>{todayLabel}</h2>
      </div>
      <MobileLaneBoard
        lanes={data.lanes as import('@/lib/mobile-shell/dashboard-strategy').MobileLane<AppointmentDoc>[]}
        activeLane={shell.lane}
        onLaneChange={(key) => shell.setLane(key as typeof shell.lane)}
        renderItem={(appt) => <AppointmentCard appt={appt} onOpen={() => shell.openChart(appt.patientId)} />}
        emptyLabel="Nothing in this lane"
      />
      <MobileOutstandingList items={data.outstanding} />
    </div>
  );
}

export default function MobileDashboardView({ archetype }: MobileDashboardViewProps) {
  if (archetype === 'clinical') return <ClinicalDashboard />;
  if (archetype === 'lab') return <LabDashboard />;
  if (archetype === 'pharmacy') return <PharmacyDashboard />;
  return <FrontDeskDashboard />;
}
