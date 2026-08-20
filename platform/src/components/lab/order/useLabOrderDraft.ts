'use client';

/**
 * The Create Lab Order draft: state, per-step validation, and the single
 * submit path.
 *
 * All the order-placing side effects live here rather than in the lab page —
 * open the desk encounter, write one LabResultDoc per test, bill the tests,
 * write the audit line — so the wizard's step components stay presentational
 * and the same flow can be mounted from anywhere (lab queue today, patient
 * chart next) without copying 130 lines of submit logic with it.
 */

import { useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useApp } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientAge } from '@/lib/patient-utils';
import { aoeSchedule } from './lab-order-aoe';
import {
  aoeKey,
  emptyLabOrderDraft,
  type LabOrderDraft,
  type LabOrderReceipt,
  type LabOrderStepKey,
  type OrderIndication,
  type OrderedTest,
} from './lab-order-types';

export function useLabOrderDraft(options: { presetPatientId?: string } = {}) {
  const { currentUser } = useApp();
  const { patients } = usePatients();
  const [draft, setDraft] = useState<LabOrderDraft>(() => ({
    ...emptyLabOrderDraft(currentUser?.name || ''),
    patientId: options.presetPatientId || '',
  }));
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<LabOrderReceipt | null>(null);

  const patient = useMemo(
    () => patients.find(p => p._id === draft.patientId) || null,
    [patients, draft.patientId],
  );

  const patientContext = useMemo(() => ({
    sex: patient?.gender,
    age: patient ? (patientAge(patient) ?? undefined) : undefined,
  }), [patient]);

  /** The AOE questions the current test selection actually asks. */
  const schedule = useMemo(
    () => aoeSchedule(draft.tests, patientContext),
    [draft.tests, patientContext],
  );

  const patch = useCallback((changes: Partial<LabOrderDraft>) => {
    setDraft(prev => ({ ...prev, ...changes }));
  }, []);

  const toggleTest = useCallback((test: OrderedTest) => {
    setDraft(prev => prev.tests.some(t => t.name === test.name)
      ? { ...prev, tests: prev.tests.filter(t => t.name !== test.name) }
      : { ...prev, tests: [...prev.tests, test] });
  }, []);

  const removeTest = useCallback((name: string) => {
    setDraft(prev => ({ ...prev, tests: prev.tests.filter(t => t.name !== name) }));
  }, []);

  const addIndication = useCallback((indication: OrderIndication) => {
    setDraft(prev => prev.indications.some(i => i.code === indication.code)
      ? prev
      : { ...prev, indications: [...prev.indications, indication] });
  }, []);

  const removeIndication = useCallback((code: string) => {
    setDraft(prev => ({ ...prev, indications: prev.indications.filter(i => i.code !== code) }));
  }, []);

  const setAoe = useCallback((testName: string, questionId: string, value: string) => {
    setDraft(prev => ({ ...prev, aoe: { ...prev.aoe, [aoeKey(testName, questionId)]: value } }));
  }, []);

  /**
   * Which required AOEs are still blank. Also what the Clinical step highlights
   * in red, so "* required" means the same thing to the form and to Next.
   */
  const missingAoe = useMemo(() => {
    const missing: { testName: string; questionId: string; label: string }[] = [];
    for (const { test, questions } of schedule) {
      for (const question of questions) {
        if (!question.required) continue;
        if ((draft.aoe[aoeKey(test.name, question.id)] || '').trim()) continue;
        missing.push({ testName: test.name, questionId: question.id, label: question.label });
      }
    }
    return missing;
  }, [schedule, draft.aoe]);

  /** Why a step cannot be left yet — empty means it is satisfied. */
  const blockersFor = useCallback((step: LabOrderStepKey): string[] => {
    switch (step) {
      case 'patient':
        return draft.patientId ? [] : ['labOrder.errPatient'];
      case 'tests':
        return draft.tests.length ? [] : ['labOrder.errTests'];
      case 'clinical':
        return missingAoe.length ? ['labOrder.errAoe'] : [];
      case 'diagnosis':
        return draft.indications.length ? [] : ['labOrder.errDiagnosis'];
      default:
        return [];
    }
  }, [draft.patientId, draft.tests.length, draft.indications.length, missingAoe.length]);

  /** Everything up to and including `step` is satisfied. */
  const isComplete = useCallback(
    (step: LabOrderStepKey) => blockersFor(step).length === 0,
    [blockersFor],
  );

  /**
   * Place the order: one LabResultDoc per test, all sharing an order group id,
   * hung off a desk encounter so the tests are billable and attributable.
   * Returns the receipt the Complete step renders as a requisition.
   */
  const submit = useCallback(async (): Promise<LabOrderReceipt> => {
    if (!patient) throw new Error('labOrder.errPatient');
    if (!draft.tests.length) throw new Error('labOrder.errTests');
    setSubmitting(true);
    try {
      const hospitalId = currentUser?.hospitalId || patient.registrationHospital;
      const patientName = `${patient.firstName} ${patient.surname}`;
      const orderGroupId = `req-${uuidv4()}`;
      const placedAt = new Date().toISOString();

      // Anchor the order to the patient's CURRENT visit at this facility —
      // reusing an open encounter (and pausing it at `awaiting_labs` when
      // that's a legal move) instead of spawning a parallel desk encounter for
      // a patient who is mid-consultation. A true walk-in with no open visit
      // still gets a minimal desk encounter so the tests are billable and
      // attributable (KAN-72). Best-effort — an unbilled test still beats a
      // clinician who cannot order one.
      let deskEncounterId: string | undefined;
      try {
        const { ensureLabOrderEncounter } = await import('@/lib/services/encounter-service');
        const { isImagingStudy } = await import('@/lib/clinical-flow/lab-catalog');
        const encounter = await ensureLabOrderEncounter({
          patientId: patient._id,
          patientName,
          hospitalNumber: patient.hospitalNumber,
          hospitalId: hospitalId || '',
          hospitalName: currentUser?.hospitalName,
          orgId: currentUser?.orgId,
          clinicianId: currentUser?._id,
          clinicianName: draft.orderedByName || currentUser?.name,
          actorId: currentUser?._id,
          placedAt,
          // An all-imaging requisition parks the visit at awaiting_imaging so
          // the radiology queue and the visit state tell the same story.
          to: draft.tests.length > 0
            && draft.tests.every(t => isImagingStudy({ specimen: t.specimen, testName: t.name }))
            ? 'awaiting_imaging'
            : 'awaiting_labs',
        });
        deskEncounterId = encounter._id;
      } catch (err) {
        console.warn('[lab-order] could not open a desk encounter for this order:', err);
      }

      const { createLabResult } = await import('@/lib/services/lab-service');
      const { isImagingStudy: isImaging } = await import('@/lib/clinical-flow/lab-catalog');
      const createdIds: string[] = [];
      const accessionNumbers: string[] = [];

      for (const test of draft.tests) {
        // Only this test's AOE answers travel with this test's document.
        const answers = (schedule.find(entry => entry.test.name === test.name)?.questions || [])
          .map(question => ({
            question: question.label,
            answer: draft.aoe[aoeKey(test.name, question.id)] || '',
          }))
          .filter(entry => entry.answer.trim().length > 0);

        const created = await createLabResult({
          patientId: patient._id,
          patientName,
          hospitalNumber: patient.hospitalNumber,
          encounterId: deskEncounterId,
          testName: test.name,
          specimen: test.specimen,
          tier: test.tier,
          status: draft.priority === 'stat' ? 'in_progress' : 'pending',
          result: '',
          unit: '',
          referenceRange: '',
          abnormal: false,
          // `critical` describes the RESULT VALUE, not the order priority —
          // nothing has come back yet, so it cannot be critical (KAN-75).
          critical: false,
          orderedBy: draft.orderedByName || currentUser?.name || 'Lab',
          // The id is what the critical-result task keys on — the name above
          // is display-only. Stamped only when the order is placed as oneself;
          // an order entered on another clinician's behalf keeps just the name
          // and is resolved against the directory at task-raise time.
          orderedById: !draft.orderedByName || draft.orderedByName === currentUser?.name
            ? currentUser?._id
            : undefined,
          // ISO, not a locale string: every consumer parses through
          // new Date(), and the chart's Orders/Results sections sort
          // lexicographically — a locale "08/08/2026…" sorted below every
          // ISO "2026-…" regardless of date.
          orderedAt: placedAt,
          // Modality discriminator — without it every CT scan renders as a
          // "Lab order" in the chart.
          orderKind: isImaging({ specimen: test.specimen, testName: test.name }) ? 'imaging' : 'lab',
          completedAt: '',
          hospitalId,
          hospitalName: currentUser?.hospitalName,
          orgId: currentUser?.orgId,
          clinicalNotes: draft.notes || undefined,
          priority: draft.priority,
          processing: draft.processing,
          collectionTiming: draft.collectionTiming,
          scheduledCollectionAt: draft.collectionTiming === 'future' ? draft.scheduledCollectionAt : undefined,
          fasting: draft.fasting,
          indications: draft.indications.length ? draft.indications : undefined,
          aoeAnswers: answers.length ? answers : undefined,
          orderGroupId,
        });
        createdIds.push(created._id);
        if (created.accessionNumber) accessionNumbers.push(created.accessionNumber);
      }

      // Bill the tests against that encounter. Price-driven and best-effort:
      // lines with no catalogued price are skipped and no bill is created when
      // the org hasn't priced anything — the same contract the consultation
      // path uses.
      if (deskEncounterId) {
        try {
          const { chargeForServices } = await import('@/lib/services/fee-schedule-service');
          await chargeForServices(
            {
              patientId: patient._id,
              patientName,
              hospitalNumber: patient.hospitalNumber,
              facilityId: hospitalId,
              facilityName: currentUser?.hospitalName || '',
              facilityLevel: 'clinic',
              state: patient.state || '',
              county: patient.county,
              orgId: currentUser?.orgId,
              encounterId: deskEncounterId,
              generatedBy: currentUser?._id || 'system',
              generatedByName: currentUser?.name || 'Lab desk',
              scope: { orgId: currentUser?.orgId, hospitalId, role: currentUser?.role || 'lab_tech' },
            },
            draft.tests.map((test, i) => ({
              category: 'laboratory' as const,
              serviceCode: test.name,
              description: test.name,
              referenceId: createdIds[i],
              referenceType: 'lab_result',
            })),
          );
        } catch (err) {
          console.warn('[lab-order] could not bill desk lab order (tests were ordered):', err);
        }
      }

      // Anything attached to the requisition is filed on the chart, tagged with
      // the accession so the bench and the chart point at the same paperwork.
      // Best-effort: a failed upload must not lose the order behind it.
      if (draft.documents.length) {
        try {
          const { addPatientDocument } = await import('@/lib/services/patient-document-service');
          for (const file of draft.documents) {
            await addPatientDocument({
              patientId: patient._id,
              title: file.description?.trim() || file.name,
              category: draft.kind === 'imaging' ? 'radiology' : 'lab_report',
              fileName: file.name,
              mimeType: file.mimeType,
              base64Data: file.base64Data,
              sizeBytes: file.sizeBytes,
              note: `Attached to order ${accessionNumbers[0] || orderGroupId}`,
              uploadedById: currentUser?._id,
              uploadedByName: draft.orderedByName || currentUser?.name,
              hospitalId,
              orgId: currentUser?.orgId,
            });
          }
        } catch (err) {
          console.warn('[lab-order] could not file an attached document (the order was placed):', err);
        }
      }

      const { logAudit } = await import('@/lib/services/audit-service');
      await logAudit('LAB_ORDER_CREATED', currentUser?._id, currentUser?.username,
        `Ordered ${draft.tests.length} test(s) for ${patientName}: ${draft.tests.map(t => t.name).join(', ')}`,
      ).catch(() => {});

      const done: LabOrderReceipt = { orderGroupId, accessionNumbers, createdIds, encounterId: deskEncounterId, placedAt };
      setReceipt(done);
      return done;
    } finally {
      setSubmitting(false);
    }
  }, [currentUser, draft, patient, schedule]);

  const reset = useCallback(() => {
    setDraft({ ...emptyLabOrderDraft(currentUser?.name || ''), patientId: options.presetPatientId || '' });
    setReceipt(null);
  }, [currentUser?.name, options.presetPatientId]);

  return {
    draft,
    patch,
    patient,
    patients,
    patientContext,
    schedule,
    missingAoe,
    blockersFor,
    isComplete,
    toggleTest,
    removeTest,
    addIndication,
    removeIndication,
    setAoe,
    submit,
    submitting,
    receipt,
    reset,
  };
}

export type LabOrderController = ReturnType<typeof useLabOrderDraft>;
