'use client';

/**
 * The chart's Lab tab: the patient's results list, and — once a row is picked
 * or deep-linked from the lab queue — the workflow for that order.
 *
 * This is where diagnostics work now happens. The queue links here rather than
 * opening a popup, so the technician works with the chart around them: the same
 * patient header, the same allergies and problems a clinician would read.
 *
 * Imaging studies live in this same list, because they are the same order store
 * (`orderKind: 'imaging'`). Picking one opens the reading-room workflow instead
 * of the bench workflow — same six-chevron shell, different six steps, because
 * none of the specimen steps mean anything to a radiographer.
 */

import { useEffect, useState } from 'react';
import ResultsSection from '@/components/ehr/chart/sections/ResultsSection';
import RadiologyWorkflowPanel from '@/components/radiology/workflow/RadiologyWorkflowPanel';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ArrowLeft } from '@/components/icons/lucide';
import LabWorkflowPanel from './LabWorkflowPanel';

export default function LabWorkspace({
  patientId,
  canOrderLabs,
  canWork,
  onAdd,
  focusId,
  seedResult,
}: {
  patientId: string;
  canOrderLabs: boolean;
  /** Lab-result permission — without it the walkthrough is read-only. */
  canWork: boolean;
  onAdd: () => void;
  focusId?: string;
  /** A reading handed over from an analyzer import, pre-filled for review. */
  seedResult?: { value: string; unit: string; referenceRange: string };
}) {
  const { t } = useTranslation();
  const { results } = useLabResults(patientId);
  const [selectedId, setSelectedId] = useState<string | undefined>(focusId);

  // A fresh deep link (?focus=…) overrides whatever was open.
  useEffect(() => { if (focusId) setSelectedId(focusId); }, [focusId]);

  const selected = selectedId ? (results || []).find(lab => lab._id === selectedId) : undefined;

  if (!selected) {
    return (
      <ResultsSection
        patientId={patientId}
        canOrderLabs={canOrderLabs}
        onAdd={onAdd}
        focusId={focusId}
        onSelect={setSelectedId}
      />
    );
  }

  const imaging = selected.orderKind === 'imaging' || isImagingStudy(selected);

  return (
    <div>
      <button
        type="button"
        className="labord-btn labord-btn--ghost"
        style={{ marginBottom: 10 }}
        onClick={() => setSelectedId(undefined)}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> {t('labFlow.backToResults')}
      </button>
      {imaging ? (
        <RadiologyWorkflowPanel
          study={selected}
          canWork={canWork}
          onClose={() => setSelectedId(undefined)}
        />
      ) : (
        <LabWorkflowPanel
          order={selected}
          canWork={canWork}
          seedResult={seedResult}
          onClose={() => setSelectedId(undefined)}
        />
      )}
    </div>
  );
}
