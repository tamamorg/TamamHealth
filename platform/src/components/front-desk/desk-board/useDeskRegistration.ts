import { useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { createPatientRegistrationDraftId, savePatientRegistrationDraft, type PatientRegistrationDraft } from '@/lib/patient-registration-draft';

export function useDeskRegistration({ router, searchParams, showToast, t }: {
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
  showToast: ReturnType<typeof useToast>['showToast'];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [registerOpen, setRegisterOpen] = useState(false);
  const registrationDraftRef = useRef<PatientRegistrationDraft | null>(null);

  const captureRegistrationDraft = useCallback((draft: PatientRegistrationDraft) => {
    registrationDraftRef.current = draft;
  }, []);

  const openFullRegistration = useCallback(async () => {
    const draft = registrationDraftRef.current;
    if (!draft) return;
    const draftId = createPatientRegistrationDraftId();
    const saved = await savePatientRegistrationDraft(draftId, draft);
    if (!saved) {
      showToast(t('patientNew.toastDraftSaveFailed'), 'error');
      return;
    }
    const returnTo = `/dashboard/front-desk${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`;
    setRegisterOpen(false);
    router.push(`/patients/new?draft=${encodeURIComponent(draftId)}&returnTo=${encodeURIComponent(returnTo)}`);
  }, [router, searchParams, showToast, t]);
  return { registerOpen, setRegisterOpen, captureRegistrationDraft, openFullRegistration };
}
