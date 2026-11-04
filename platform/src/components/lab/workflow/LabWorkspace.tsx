'use client';

/**
 * The chart's Lab tab: the patient's results list, and — once a row is picked
 * or deep-linked from the lab queue — the workflow for that order, in a slider.
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
import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ImagingReportSheet, LabReportSheet, ReportView } from '@/components/reports/clinical-reports';
import LabWorkflowPanel from './LabWorkflowPanel';

export default function LabWorkspace({
  patientId,
  canOrderLabs,
  canWork,
  canWorkImaging,
  onAdd,
  focusId,
  seedResult,
}: {
  patientId: string;
  canOrderLabs: boolean;
  /** Lab-result permission — without it the walkthrough is read-only. */
  canWork: boolean;
  /** The same, for a study: the reading room's, not the bench's. */
  canWorkImaging: boolean;
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
  // A finished result read as its report, in the tab ("View report").
  const [reportId, setReportId] = useState<string | undefined>();
  const report = reportId ? (results || []).find(lab => lab._id === reportId) : undefined;
  const reportIsImaging = !!report && (report.orderKind === 'imaging' || isImagingStudy(report));

  const imaging = !!selected && (selected.orderKind === 'imaging' || isImagingStudy(selected));
  const close = () => setSelectedId(undefined);

  // The list stays in place; the picked order opens beside it as a slider,
  // the way every other chart workspace opens.
  return (
    <>
      {report ? (
        <ReportView
          backLabel={t('labFlow.backToResults')}
          onBack={() => setReportId(undefined)}
          openLabel={t('chart.resultOpenWorkflow')}
          onOpen={() => setSelectedId(report._id)}
          documentLabel={t(reportIsImaging ? 'report.imagingReport' : 'print.labReport')}
          // The paper heading's date is the sheet's own: an imaging report is dated when reported.
          date={(reportIsImaging ? report.reportedAt : undefined) || report.completedAt || report.orderedAt}
        >
          {reportIsImaging ? <ImagingReportSheet study={report} /> : <LabReportSheet order={report} />}
        </ReportView>
      ) : (
        <ResultsSection
          patientId={patientId}
          canOrderLabs={canOrderLabs}
          onAdd={onAdd}
          focusId={focusId}
          onSelect={setSelectedId}
          onViewReport={setReportId}
        />
      )}
      {selected && (
        <FormSlider
          title={selected.testName}
          subtitle={[selected.accessionNumber, selected.specimen].filter(Boolean).join(' · ') || undefined}
          className="tamam-dialog"
          width={560}
          flush
          onClose={close}
        >
          {/* The bench fills the slider and pins its own footer, as on the
              dashboard (LabBenchSlider); the slider header carries the title. */}
          {imaging ? (
            <div className="station-orders__body">
              <RadiologyWorkflowPanel study={selected} canWork={canWorkImaging} onClose={close} />
            </div>
          ) : (
            <LabWorkflowPanel key={selected._id} order={selected} canWork={canWork} seedResult={seedResult} onClose={close} hideTitle />
          )}
        </FormSlider>
      )}
    </>
  );
}
