'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { getDefaultDashboard } from '@/lib/role-routes';

// Role workspaces are large and mutually exclusive. Loading all three before
// the role is known made every nurse download the clinician worklist and every
// doctor download ward/MAR and superintendent analytics code. Keep the tiny
// switch in the route chunk and fetch exactly one workspace.
const ClinicianHomeView = dynamic(() => import('@/components/dashboards/DoctorDashboardPage'));
const NurseHomeView = dynamic(() => import('@/components/dashboards/NurseHomeView'));
const SuperintendentDashboard = dynamic(() => import('@/components/dashboards/SuperintendentDashboard'));
const SUPPORTED_HOME_ROLES = new Set([
  'doctor', 'clinical_officer', 'medical_superintendent', 'clinician',
  'nurse', 'midwife', 'triage_nurse', 'rooming_nurse', 'super_admin',
]);

export default function DashboardPage() {
  const router = useRouter();
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    if (!SUPPORTED_HOME_ROLES.has(currentUser.role)) router.replace(getDefaultDashboard(currentUser.role));
  }, [currentUser, router]);

  if (!currentUser) return null;
  if (currentUser.role === 'medical_superintendent') return <SuperintendentDashboard />;
  if (['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'].includes(currentUser.role)) {
    return <NurseHomeView />;
  }
  if (['doctor', 'clinical_officer', 'clinician', 'super_admin'].includes(currentUser.role)) {
    return <ClinicianHomeView />;
  }
  return null;
}
