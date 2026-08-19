/**
 * Route wrapper only.
 *
 * The registration form itself is a shared feature, not a page: the front
 * desk renders the same component inside its "Register new patient" dialog.
 * It used to live in this file and be imported as
 * `from '@/app/(dashboard)/patients/new/page'`, which made one route's page
 * module a dependency of another route — so this route now owns nothing but
 * the URL.
 */
import { PatientRegistrationForm } from '@/components/patients/registration/PatientRegistrationForm';
import { safeReturnTo } from '@/lib/navigation/return-to';

interface NewPatientPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewPatientPage({ searchParams }: NewPatientPageProps) {
  const params = await searchParams;
  const draftId = typeof params.draft === 'string' ? params.draft : undefined;
  const returnTo = safeReturnTo(
    typeof params.returnTo === 'string' ? params.returnTo : undefined,
    '/patients',
  );

  return <PatientRegistrationForm draftId={draftId} returnTo={returnTo} />;
}
