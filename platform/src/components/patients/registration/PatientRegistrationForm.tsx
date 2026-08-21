'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from '@/components/icons/lucide';
import { type CapturedFingerprint } from '@/components/FingerprintCapture';
import PhotoCaptureModal from '@/components/patients/PhotoCaptureModal';
import { usePatients } from '@/lib/hooks/usePatients';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { safeReturnTo } from '@/lib/navigation/return-to';
import {
  dropPatientRegistrationDraft,
  loadPatientRegistrationDraft,
  savePatientRegistrationDraft,
  type PatientRegistrationDraft,
} from '@/lib/patient-registration-draft';
import { enrollFingerprint } from '@/lib/services/fingerprint-service';
import { isValidPhone, isValidEmail, isValidNationalId } from '@/lib/field-formats';
import { isPathAllowed } from '@/lib/role-routes';
import RegistrationJumpNav from './RegistrationJumpNav';
import RegistrationReview from './RegistrationReview';
import { buildReviewGroups } from './review-groups';
import { buildPatientDoc } from './build-patient-doc';
import DemographicsSection from './sections/DemographicsSection';
import BiometricsSection from './sections/BiometricsSection';
import ContactSection, { geocodeIdFor } from './sections/ContactSection';
import NextOfKinSection from './sections/NextOfKinSection';
import CoverageSection from './sections/CoverageSection';
import { useRoleFlag, useRoleChoice } from '@/lib/settings/useRoleSetting';
import {
  EMPTY_REGISTRATION_FORM, MAX_ADDITIONAL_NOK,
  type AdditionalNok, type CoverageType, type RegistrationTextField,
} from './registration-form';
import {
  SECTION_ANCHORS, REVIEW_SECTION, VALIDATED_SECTIONS,
  DEMOGRAPHICS_SECTION, CONTACT_SECTION, NEXTOFKIN_SECTION,
  scrollParentOf, sectionRequirementProgress,
} from './registration-progress';

interface PatientRegistrationFormProps {
  embedded?: boolean;
  onCancel?: () => void;
  onRegistered?: () => void;
  draftId?: string;
  returnTo?: string;
  onDraftChange?: (draft: PatientRegistrationDraft) => void;
}

export function PatientRegistrationForm({
  embedded = false,
  onCancel,
  onRegistered,
  draftId,
  returnTo,
  onDraftChange,
}: PatientRegistrationFormProps) {
  const { t } = useTranslation();
  // Section names, in SECTION_ANCHORS order — Biometrics second, under
  // Demographics. Memoized because the review read-back derives from it, and
  // a fresh array each render would rebuild that on every keystroke.
  const sectionLabels = useMemo(() => [
    t('patientNew.stepDemographics'), t('patientNew.stepBiometrics'),
    t('patientNew.stepContactLocation'), t('patientNew.stepNextOfKin'),
    t('patientNew.stepPaymentCoverage'), t('patientNew.stepReview'),
  ], [t]);

  const router = useRouter();
  const { create: createPatient } = usePatients();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // "Register & check in" hands off to the appointments page's walk-in dialog.
  // Roles that can register a patient but cannot book (lab, pharmacy, records,
  // nutrition, radiology) would only land on Access Restricted, so they don't
  // get the button.
  const canCheckIn = isPathAllowed(currentUser?.role || '', '/appointments');
  /**
   * A user with no facility of their own — a platform super_admin, an org_admin
   * between postings — has to say which facility they are registering at. The
   * facility is what resolves the patient's organisation, and a patient with no
   * organisation is not saved: the server's tenant validator refuses the
   * document, and `filterByScope` hides it from every colleague who would go
   * looking for it. It used to be taken as `hospitalId || ''` and never asked.
   */
  const facilityRequired = !currentUser?.hospitalId;
  const { hospitals } = useHospitals();
  const facilities = useMemo(
    () => hospitals.map(h => ({ id: h._id, name: h.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [hospitals],
  );

  const [form, setForm] = useState({ ...EMPTY_REGISTRATION_FORM });
  const [additionalNok, setAdditionalNok] = useState<AdditionalNok[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  /** Sections whose fields failed the last submit — flagged in the nav. */
  const [errorSections, setErrorSections] = useState<Set<number>>(new Set());
  const [submitIntent, setSubmitIntent] = useState<'profile' | 'check-in' | null>(null);
  // Fingerprint templates captured during registration (consent-gated inside
  // the component). Persisted AFTER the patient doc exists, in handleSubmit.
  const [fingerprints, setFingerprints] = useState<CapturedFingerprint[]>([]);
  const [patientPhotoUrl, setPatientPhotoUrl] = useState<string | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  /**
   * Review is a step, not a section. It used to sit at the bottom of the
   * scrolling form from the moment the page opened, so the clerk scrolled past
   * a summary of fields they had not filled yet. It now replaces the form once
   * everything required is answered, and reads back every field.
  */
  const [reviewMode, setReviewMode] = useState(false);
  // Which section the clerk is currently looking at — a different question
  // from how much is done, and the one the nav marks.
  const [activeSection, setActiveSection] = useState(DEMOGRAPHICS_SECTION);
  const [draftHydrated, setDraftHydrated] = useState(!draftId);

  useEffect(() => {
    if (!draftId) return;

    let active = true;
    void loadPatientRegistrationDraft(draftId).then(draft => {
      if (!active) return;
      if (draft) {
        setForm(draft.form);
        setAdditionalNok(draft.additionalNok);
        setFingerprints(draft.fingerprints);
        setPatientPhotoUrl(draft.patientPhotoUrl);
        setReviewMode(draft.reviewMode);
        if (draft.reviewMode) setActiveSection(REVIEW_SECTION);
      } else {
        showToast(t('patientNew.toastDraftLoadFailed'), 'error');
      }
      setDraftHydrated(true);
    });

    return () => { active = false; };
  }, [draftId, showToast, t]);

  const currentDraft = useMemo<PatientRegistrationDraft>(() => ({
    version: 1,
    form,
    additionalNok,
    fingerprints,
    patientPhotoUrl,
    reviewMode,
  }), [form, additionalNok, fingerprints, patientPhotoUrl, reviewMode]);

  useEffect(() => {
    if (!draftHydrated) return;
    onDraftChange?.(currentDraft);
  }, [currentDraft, draftHydrated, onDraftChange]);

  // Once expanded, keep the encrypted hand-off current so a refresh does not
  // restore the older modal snapshot. Never write the initial empty state over
  // a draft while its asynchronous decryption is still in flight.
  useEffect(() => {
    if (!draftId || !draftHydrated) return;
    const timer = window.setTimeout(() => {
      void savePatientRegistrationDraft(draftId, currentDraft);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentDraft, draftHydrated, draftId]);

  const clearError = (key: string) => {
    if (!errors[key]) return;
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const update = (field: RegistrationTextField, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    clearError(field);
  };

  const addNokEntry = () => setAdditionalNok(rs => (
    rs.length < MAX_ADDITIONAL_NOK ? [...rs, { name: '', relationship: '', phone: '', address: '' }] : rs
  ));
  const updateNokEntry = (i: number, patch: Partial<AdditionalNok>) => {
    setAdditionalNok(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    if ('phone' in patch) clearError(`additionalNok.${i}.phone`);
  };
  const removeNokEntry = (i: number) => setAdditionalNok(rs => rs.filter((_, j) => j !== i));

  const updateCoverageType = (value: CoverageType) => {
    setForm(prev => ({
      ...prev,
      payorCoverageType: value,
      payorProgram: value === 'program' ? prev.payorProgram : '',
      payorNgo: value === 'ngo' ? prev.payorNgo : '',
      payorExemptionReason: value === 'exemption' ? prev.payorExemptionReason : '',
      payorExemptionOther: value === 'exemption' ? prev.payorExemptionOther : '',
    }));
  };

  const updateExemptionReason = (value: string) => {
    setForm(prev => ({
      ...prev,
      payorExemptionReason: value,
      payorExemptionOther: value === 'Other' ? prev.payorExemptionOther : '',
    }));
  };

  // ── Nav progress ─────────────────────────────────────────────────────
  // What each section still needs, mirroring `validateSection` exactly — the
  // nav must count the same things the Register button refuses to submit
  // without, or it promises a section is finished and the submit bounces off
  // it. Sections with nothing required report a total of 0 and read as
  // optional rather than as permanently unfinished.
  const sectionProgress = useMemo(
    () => sectionRequirementProgress(form, { facilityRequired }),
    [form, facilityRequired],
  );
  const requiredDone = sectionProgress.reduce((sum, s) => sum + s.done, 0);
  const requiredTotal = sectionProgress.reduce((sum, s) => sum + s.total, 0);

  useEffect(() => {
    const sections = SECTION_ANCHORS
      .map(anchor => document.getElementById(`reg-${anchor}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // A narrow band near the top of the viewport is "current". Without it every
    // section on screen counts and the marker sits on whichever happens to be
    // last in the callback.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const firstVisible = SECTION_ANCHORS.findIndex(a => visible.has(`reg-${a}`));
      if (firstVisible >= 0) setActiveSection(firstVisible);
      // Observe against whatever actually scrolls. This form is also embedded
      // in the front desk's registration dialog, where the page never scrolls
      // and the modal body does — measured against the viewport there, no
      // section ever entered the band and the marker stayed stuck on the first.
    }, { root: scrollParentOf(sections[0]), rootMargin: '-12% 0px -72% 0px' });

    sections.forEach(el => observer.observe(el));
    return () => observer.disconnect();
    // Re-bound when review opens or closes: the sections unmount behind the
    // review page, so an observer set up once would come back holding six
    // detached nodes and the marker would stop following the scroll.
  }, [reviewMode]);

  const geocodeId = geocodeIdFor(form.bomaCode, form.householdNumber);

  const reviewGroups = useMemo(() => buildReviewGroups(sectionLabels, {
    form,
    additionalNok,
    fingerprintCount: fingerprints.length,
    geocodeId,
    // Named, not the raw id — the read-back is what the clerk confirms, and
    // "hosp-004" is not a facility anyone recognises.
    registrationFacilityName: facilityRequired
      ? facilities.find(f => f.id === form.registrationFacility)?.name
      : undefined,
  }, t), [sectionLabels, form, additionalNok, fingerprints, geocodeId, facilityRequired, facilities, t]);

  /** The errors one section is carrying, keyed by form field. */
  // Registration desk settings (design 11, "Registration"). Read live so a
  // change in Settings applies to the very next patient, not the next reload.
  const requirePhone = useRoleFlag('reg.phone', true);
  const requireGeocode = useRoleFlag('reg.geocode', false);
  const warnDuplicates = useRoleFlag('reg.duplicates', true);

  const validateSection = (section: number): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (section === DEMOGRAPHICS_SECTION) {
      if (facilityRequired && !form.registrationFacility) {
        errs.registrationFacility = t('patientNew.errRegistrationFacilityRequired');
      }
      if (!form.firstName.trim()) errs.firstName = t('patientNew.errFirstNameRequired');
      if (!form.surname.trim()) errs.surname = t('patientNew.errSurnameRequired');
      if (!form.gender) errs.gender = t('patientNew.errGenderRequired');
      if (!form.dateOfBirth && !form.estimatedAge) errs.dateOfBirth = t('patientNew.errDobRequired');
      if (form.estimatedAge) {
        const age = parseInt(form.estimatedAge, 10);
        if (isNaN(age) || age < 0 || age > 150) errs.estimatedAge = t('patientNew.errAgeRange');
      }
      if (!form.primaryLanguage) errs.primaryLanguage = t('patientNew.errPrimaryLanguageRequired');
    } else if (section === CONTACT_SECTION) {
      if (requireGeocode && !form.householdNumber.trim()) {
        errs.householdNumber = t('patientNew.errGeocodeRequired');
      }
      if (!form.state) errs.state = t('patientNew.errStateRequired');
      if (form.state && !form.county) errs.county = t('patientNew.errCountyRequired');
      // Phone is optional by default — the validators return true for empty,
      // so this only flags something typed wrong. The desk's "Require phone
      // number" setting (`reg.phone`) makes it mandatory, which is what that
      // row has always claimed to do.
      if (requirePhone && !form.phone.trim()) errs.phone = t('patientNew.errPhoneRequired');
      else if (!isValidPhone(form.phone)) errs.phone = t('validation.errPhone');
      if (!isValidPhone(form.altPhone)) errs.altPhone = t('validation.errPhone');
      if (!isValidPhone(form.whatsapp)) errs.whatsapp = t('validation.errPhone');
      if (!isValidEmail(form.email)) errs.email = t('validation.errEmail');
      if (!isValidNationalId(form.nationalId)) errs.nationalId = t('validation.errNationalId');
    } else if (section === NEXTOFKIN_SECTION) {
      if (!form.nokName.trim()) errs.nokName = t('patientNew.errNokNameRequired');
      if (!form.nokRelationship) errs.nokRelationship = t('patientNew.errRelationshipRequired');
      if (!form.nokPhone.trim()) errs.nokPhone = t('patientNew.errNokPhoneRequired');
      else if (!isValidPhone(form.nokPhone)) errs.nokPhone = t('validation.errPhone');
      additionalNok.forEach((nok, index) => {
        if (nok.phone && !isValidPhone(nok.phone)) {
          errs[`additionalNok.${index}.phone`] = t('validation.errPhone');
        }
      });
    }
    return errs;
  };

  /**
   * Validate every section. On failure this also does the surfacing — flags the
   * offending sections in the nav, leaves the form visible and scrolls to the
   * first field that needs attention — and returns false.
   *
   * Shared by Review and Register: the two entry points must agree on what
   * "finished" means, or Review would wave through a form Register then
   * refuses.
   */
  const validateAll = (): boolean => {
    // Kept as [sectionIndex, errors] pairs rather than a bare array. The
    // sections that validate are not 0,1,2 — Biometrics sits at 1 and requires
    // nothing — so a position in this list is not a section index, and
    // treating it as one flagged the wrong section and scrolled to the wrong
    // anchor.
    const perSection = VALIDATED_SECTIONS.map(section => [section, validateSection(section)] as const);
    const allErrors = Object.assign({}, ...perSection.map(([, errs]) => errs));
    if (Object.keys(allErrors).length === 0) {
      setErrorSections(new Set());
      return true;
    }
    setErrors(allErrors);
    const failed = perSection.filter(([, errs]) => Object.keys(errs).length > 0);
    setErrorSections(new Set(failed.map(([section]) => section)));
    // A failure found from the review page has to put the form back on screen,
    // otherwise the scroll below targets a section that is not rendered.
    setReviewMode(false);
    showToast(t('patientNew.toastFillRequired'), 'error');
    const [firstSection, firstErrors] = failed[0];
    const firstField = Object.keys(firstErrors)[0];
    // Deferred a frame: when we have just come back from review the form is
    // still being mounted, and scrollIntoView on a detached node does nothing.
    requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-field="${firstField}"]`) ??
        document.getElementById(`reg-${SECTION_ANCHORS[firstSection]}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return false;
  };

  /** Nav click: leave review (if in it) and jump to that section. */
  const goToSection = (i: number) => {
    setActiveSection(i);
    const scrollToSection = () => document.getElementById(`reg-${SECTION_ANCHORS[i]}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!reviewMode) {
      scrollToSection();
      return;
    }
    setReviewMode(false);
    requestAnimationFrame(scrollToSection);
  };

  /** The nav's Review step: only opens once the form would actually submit. */
  const openReview = () => {
    if (!validateAll()) return;
    setErrors({});
    setReviewMode(true);
    setActiveSection(REVIEW_SECTION);
    // Whichever container scrolls — the page, or the front desk dialog's body.
    const scroller = scrollParentOf(document.getElementById(`reg-${SECTION_ANCHORS[0]}`));
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancel = async () => {
    if (draftId) await dropPatientRegistrationDraft(draftId);
    if (onCancel) {
      onCancel();
      return;
    }
    router.push(safeReturnTo(returnTo, '/patients'));
  };

  const handleSubmit = async (nextAction: 'profile' | 'check-in' = 'profile') => {
    if (!validateAll()) return;

    setSubmitting(true);
    setSubmitIntent(nextAction);
    try {
      const result = await createPatient(buildPatientDoc({
        form,
        additionalNok,
        geocodeId,
        photoUrl: patientPhotoUrl,
        hospitalId: currentUser?.hospitalId || form.registrationFacility,
        registeredBy: currentUser?.name || currentUser?.username || '',
        nowIso: new Date().toISOString(),
      }));

      // Persist fingerprint enrollments now that the patient _id exists.
      // Best-effort: a biometric failure must never roll back registration.
      if (fingerprints.length > 0 && result?._id) {
        // Consent must be attributable to a real staff member — no anonymous
        // fallback. Without an identified user we skip enrollment entirely.
        const consentRecordedBy = currentUser?.name || currentUser?.username;
        try {
          if (!consentRecordedBy) throw new Error('no authenticated user to record consent');
          for (const fp of fingerprints) {
            await enrollFingerprint({
              patientId: result._id,
              patientName: `${form.firstName.trim()} ${form.surname.trim()}`,
              finger: fp.finger,
              template: fp.template,
              format: fp.format,
              quality: fp.quality,
              driver: fp.driver,
              consentRecordedBy,
              enrolledBy: currentUser?.username,
              hospitalId: currentUser?.hospitalId,
              orgId: result.orgId,
            });
          }
        } catch (fpErr) {
          console.error('Fingerprint enrollment failed:', fpErr);
          showToast(t('fingerprint.enrollFailed'), 'error');
        }
      }

      showToast(
        `${t('patientNew.toastRegistered', { firstName: form.firstName, surname: form.surname })}`
        + `${result?.hospitalNumber ? t('patientNew.hospitalNumberSuffix', { number: result.hospitalNumber }) : ''}`,
        'success',
      );
      if (draftId) await dropPatientRegistrationDraft(draftId);
      if (onRegistered) {
        onRegistered();
      } else if (nextAction === 'check-in' && result?._id) {
        // The standalone Check-In module is retired — a patient is checked in
        // from an appointment. Someone registered at the window has none, so
        // this hands off to the walk-in dialog, which books today's slot
        // already checked in.
        router.push(`/appointments?walkIn=${result._id}`);
      } else {
        router.push('/patients');
      }
    } catch (err) {
      console.error('Failed to register patient:', err);
      if (err instanceof Error && 'fields' in err) {
        const validationErr = err as Error & { fields: Record<string, string> };
        // The service keys its errors by the field on the patient DOCUMENT.
        // Every one of those matches a form field except the registering
        // facility, which the document calls `registrationHospital` — left
        // unmapped, its message would render against no field and the scroll
        // to the offending input would find nothing.
        const { registrationHospital, ...rest } = validationErr.fields;
        setErrors({
          ...rest,
          ...(registrationHospital ? { registrationFacility: registrationHospital } : {}),
        });
        showToast(t('patientNew.toastValidationFailed', { errors: Object.values(validationErr.fields).join(', ') }), 'error');
      } else {
        showToast(t('patientNew.toastRegisterFailed'), 'error');
      }
    } finally {
      setSubmitting(false);
      setSubmitIntent(null);
    }
  };

  const sectionProps = { form, errors, update };

  /** Title, note and grey slab shared by every section on the page. */
  const renderSection = (index: number, anchor: string, children: React.ReactNode) => (
    <section className="registration-section omrs-reg-section" id={`reg-${anchor}`}>
      <header className="omrs-reg-sectionhead">
        <h2>{index + 1}. {sectionLabels[index]}</h2>
        {/* Only where there is something to mark: Biometrics and Payment
            Coverage require nothing, so the note would point at asterisks that
            are not there. */}
        {sectionProgress[index].total > 0 && <p>{t('patientNew.requiredFieldsNote')}</p>}
      </header>
      <div className="omrs-reg-fields">{children}</div>
    </section>
  );

  return (
    <>
      <main className={`page-container page-enter patient-registration-page${embedded ? ' patient-registration-page--embedded' : ''}`}>
        {!embedded && (
          <div className="patient-registration-toolbar">
            <button onClick={() => void handleCancel()} className="patient-registration-back">
              <ArrowLeft className="w-4 h-4" /> {t('patientNew.backToPatients')}
            </button>
          </div>
        )}

        <div className="omrs-reg">
          {/* Left rail: the form's table of contents and its two actions. */}
          <aside className="omrs-reg-rail" aria-label={t('patientNew.registrationProgressAriaLabel')}>
            <h1 className="omrs-reg-title">{t('patientNew.topBarTitle')}</h1>
            {/* Said once, here, instead of under every section heading. */}
            <p className="omrs-reg-railnote">{t('patientNew.requiredFieldsNote')}</p>
            <p className="omrs-reg-jump">{t('patientNew.jumpTo')}</p>
            <RegistrationJumpNav
              sectionLabels={sectionLabels}
              sectionProgress={sectionProgress}
              reviewLocked={requiredDone < requiredTotal}
              activeSection={activeSection}
              errorSections={errorSections}
              onSelectSection={goToSection}
              onOpenReview={openReview}
              optionalLabel={t('patientNew.optionalLabel')}
            />
            <div className="omrs-reg-railactions">
              {/* Filling and committing are different moments, so they get
                  different buttons. While the form is open the primary action
                  is Review; the registering actions only appear on the
                  read-back, where the clerk can see what they will commit. */}
              {!reviewMode ? (
                <button type="button" onClick={openReview} disabled={submitting} className="btn btn-primary">
                  {t('patientNew.stepReview')}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => handleSubmit('profile')} disabled={submitting} className="btn btn-primary">
                    {submitting && submitIntent === 'profile' ? t('patientNew.saving') : t('patientNew.registerPatient')}
                  </button>
                  {!onRegistered && canCheckIn && (
                    <button type="button" onClick={() => handleSubmit('check-in')} disabled={submitting} className="btn btn-secondary">
                      {submitting && submitIntent === 'check-in' ? t('patientNew.saving') : t('patientNew.registerAndCheckIn')}
                    </button>
                  )}
                  <button type="button" onClick={() => goToSection(DEMOGRAPHICS_SECTION)} disabled={submitting} className="btn btn-secondary">
                    {t('action.back')}
                  </button>
                </>
              )}
              <button type="button" onClick={handleCancel} className="omrs-reg-cancel">
                {t('patientNew.cancel')}
              </button>
            </div>
          </aside>

          <div className="patient-registration-shell omrs-reg-form">
            <div className="patient-registration-card-body">
              {/* The form's sections, or the read-back that replaces them —
                  never both, so the clerk never scrolls through a summary of
                  fields they have not filled yet. */}
              {!reviewMode && (
                <>
                  {renderSection(DEMOGRAPHICS_SECTION, 'demographics', (
                    <DemographicsSection {...sectionProps}
                      facilities={facilities} facilityRequired={facilityRequired} />
                  ))}
                  {/* Biometrics sits directly under Demographics: the photo and
                      prints are taken while the patient is still being
                      identified, not after their address has been typed. */}
                  {renderSection(1, 'biometrics', (
                    <BiometricsSection
                      photoUrl={patientPhotoUrl}
                      onEditPhoto={() => setShowPhotoModal(true)}
                      onClearPhoto={() => setPatientPhotoUrl(null)}
                      fingerprints={fingerprints}
                      onFingerprintsChange={setFingerprints}
                    />
                  ))}
                  {renderSection(CONTACT_SECTION, 'contact', (
                    <ContactSection {...sectionProps} />
                  ))}
                  {renderSection(NEXTOFKIN_SECTION, 'nextofkin', (
                    <NextOfKinSection
                      {...sectionProps}
                      additionalNok={additionalNok}
                      onAddNok={addNokEntry}
                      onUpdateNok={updateNokEntry}
                      onRemoveNok={removeNokEntry}
                    />
                  ))}
                  {renderSection(4, 'coverage', (
                    <CoverageSection
                      {...sectionProps}
                      onCoverageTypeChange={updateCoverageType}
                      onExemptionReasonChange={updateExemptionReason}
                    />
                  ))}
                </>
              )}

              {reviewMode && (
                <RegistrationReview
                  title={sectionLabels[REVIEW_SECTION]}
                  eyebrow={t('patientNew.finalCheck')}
                  heading={[form.firstName, form.middleName, form.surname].filter(Boolean).join(' ') || t('patientNew.reviewHeading')}
                  photoUrl={patientPhotoUrl}
                  photoAlt={t('patientNew.photoAlt')}
                  groups={reviewGroups}
                  editLabel={t('action.edit')}
                  onEdit={goToSection}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      {showPhotoModal && (
        <PhotoCaptureModal
          onCapture={setPatientPhotoUrl}
          onClose={() => setShowPhotoModal(false)}
        />
      )}
    </>
  );
}
