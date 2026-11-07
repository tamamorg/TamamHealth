'use client';

/**
 * The chart's finished results as documents, all on ReportSheet: a lab report,
 * an imaging report and a dispensing record. Each row's ⋮ offers "View report"
 * (this, in the tab) beside the slider that works the order.
 */

import type { ReactNode } from 'react';
import { ArrowLeft, Printer } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatDateTime, formatRxSig } from '@/lib/format-utils';
import { fallbackAccessionNumber, resultWithUnit } from '@/components/lab/workflow/lab-workflow-types';
import type { LabResultDoc, PrescriptionDoc } from '@/lib/db-types';
import ReportSheet, { ReportDesk, printReportSheet, type ReportTone } from './ReportSheet';
import PendingCorrectionNotice from '@/components/lab/workflow/PendingCorrectionNotice';

const SHEET_ID = 'chart-report-sheet';

/** The value without a unit it already carries ("4.2 g/dL" in a g/dL row). */
function bareValue(value?: string, unit?: string): string {
  const v = (value || '').trim();
  const u = (unit || '').trim();
  if (!v || !u || resultWithUnit(v, u) !== v) return v;
  return v.slice(0, v.length - u.length).trim() || v;
}

const toneOf = (doc: { critical?: boolean; abnormal?: boolean }): ReportTone =>
  doc.critical ? 'critical' : doc.abnormal ? 'abnormal' : 'normal';

export function LabReportSheet({ order }: { order: LabResultDoc }) {
  const { t } = useTranslation();
  const tone = toneOf(order);
  const rows = order.observations?.length
    ? order.observations.map(o => ({
      id: o.id,
      group: o.group && o.group !== o.label ? o.group : undefined,
      cells: [o.label, bareValue(o.value, o.unit), o.unit] as ReactNode[],
    }))
    : [{ id: order._id, tone, cells: [order.testName, bareValue(order.result, order.unit), order.unit, order.referenceRange] as ReactNode[] }];
  const showRange = !order.observations?.length;
  return (
    <>
    {/* Above the sheet, never on it: the printed report carries the filed
        value only, not one still under review. */}
    {order.pendingCorrection && <PendingCorrectionNotice correction={order.pendingCorrection} />}
    <ReportSheet
      id={SHEET_ID}
      documentLabel={t('print.labReport')}
      date={order.completedAt || order.orderedAt}
      flag={order.priority === 'stat' ? t('lab.priorityStat') : undefined}
      facilityName={order.hospitalName}
      notice={order.amended ? (
        <><strong>{t('labFlow.amendedResult')}</strong> {t('labFlow.previousValue')}: {order.amendedFrom || '—'} · {t('labFlow.reason')}: {order.amendmentReason || '—'} · {t('labFlow.amendedBy')}: {order.amendedBy || '—'}</>
      ) : undefined}
      patientTitle={t('print.patientInformation')}
      patient={[
        { label: t('print.patientName'), value: order.patientName },
        { label: t('print.patientId'), value: order.hospitalNumber },
        { label: t('labFlow.accession'), value: fallbackAccessionNumber(order) },
        { label: t('labOrder.orderingProviderLabel'), value: order.orderedBy },
      ]}
      sections={[
        {
          title: t('labFlow.sheetResults'),
          table: {
            columns: [t('labStructured.investigation'), t('labFlow.value'), t('lab.unit'), ...(showRange ? [t('lab.referenceRange')] : [])],
            rows,
            summary: {
              label: t('labFlow.interpretation'),
              value: order.critical ? t('lab.critical') : order.abnormal ? t('lab.abnormal') : t('labFlow.withinRange'),
              tone,
            },
          },
        },
        {
          title: t('labFlow.sheetDetails'),
          fields: [
            { label: t('labFlow.test'), value: order.testName },
            { label: t('lab.specimen'), value: order.specimen },
            { label: t('labFlow.orderedAt'), value: order.orderedAt ? formatDateTime(order.orderedAt) : undefined },
            { label: t('labFlow.reportedAt'), value: order.completedAt ? formatDateTime(order.completedAt) : undefined },
          ],
        },
      ]}
    />
    </>
  );
}

export function ImagingReportSheet({ study }: { study: LabResultDoc }) {
  const { t } = useTranslation();
  return (
    <ReportSheet
      id={SHEET_ID}
      documentLabel={t('report.imagingReport')}
      date={study.reportedAt || study.completedAt || study.orderedAt}
      flag={study.priority === 'stat' ? t('lab.priorityStat') : undefined}
      facilityName={study.hospitalName}
      patientTitle={t('print.patientInformation')}
      patient={[
        { label: t('print.patientName'), value: study.patientName },
        { label: t('print.patientId'), value: study.hospitalNumber },
        { label: t('labFlow.accession'), value: fallbackAccessionNumber(study) },
        { label: t('labOrder.orderingProviderLabel'), value: study.orderedBy },
      ]}
      sections={[
        {
          title: t('report.study'),
          fields: [
            { label: t('labFlow.test'), value: study.testName },
            { label: t('imgFlow.modality'), value: study.modality },
            { label: t('imgFlow.acquiredAt'), value: study.acquiredAt ? formatDateTime(study.acquiredAt) : undefined },
            { label: t('imgFlow.reportedBy'), value: study.reportedBy },
          ],
        },
        { title: t('imgFlow.findings'), text: study.findings },
        { title: t('imgFlow.impression'), text: study.impression || study.result },
      ]}
    />
  );
}

export function DispensingReportSheet({ rx, hospitalNumber }: { rx: PrescriptionDoc; hospitalNumber?: string }) {
  const { t } = useTranslation();
  const batches = rx.dispenseAllocations || [];
  return (
    <ReportSheet
      id={SHEET_ID}
      documentLabel={t('report.dispensingRecord')}
      date={rx.dispensedAt || rx.createdAt}
      facilityName={rx.hospitalName}
      patientTitle={t('print.patientInformation')}
      patient={[
        { label: t('print.patientName'), value: rx.patientName },
        { label: t('print.patientId'), value: hospitalNumber },
        { label: t('rxFlow.prescriber'), value: rx.prescribedBy },
        { label: t('report.prescribedOn'), value: rx.createdAt ? formatDateTime(rx.createdAt) : undefined },
      ]}
      sections={[
        {
          title: t('report.prescription'),
          table: {
            columns: [t('rxFlow.medication'), t('rxFlow.sig'), t('rxFlow.quantity'), t('rxFlow.quantityDispensed')],
            rows: [{
              id: rx._id,
              cells: [rx.medication, formatRxSig(rx), rx.quantityToDispense != null ? String(rx.quantityToDispense) : undefined, rx.quantityDispensed != null ? String(rx.quantityDispensed) : undefined],
            }],
          },
        },
        ...(batches.length ? [{
          title: t('report.batches'),
          table: {
            columns: [t('report.batch'), t('report.expiry'), t('report.quantity')],
            rows: batches.map(b => ({ id: `${b.inventoryId}-${b.batchNumber}`, cells: [b.batchNumber, b.expiryDate, String(b.quantity)] as ReactNode[] })),
          },
        }] : []),
        {
          title: t('report.dispensing'),
          fields: [
            { label: t('rxFlow.dispensedBy'), value: rx.dispensedByName || rx.dispensedBy },
            { label: t('rxFlow.dispensedAt'), value: rx.dispensedAt ? formatDateTime(rx.dispensedAt) : undefined },
            { label: t('report.counselledBy'), value: rx.counselledBy },
            { label: t('report.pharmacyInstructions'), value: rx.pharmacyInstructions },
          ],
        },
      ]}
    />
  );
}

/**
 * A report open in the tab: Back to the list, Print, and the way into the
 * slider that works the order, over the sheet on its desk.
 */
export function ReportView({ backLabel, onBack, openLabel, onOpen, documentLabel, date, children }: {
  backLabel: string;
  onBack: () => void;
  openLabel?: string;
  onOpen?: () => void;
  documentLabel: string;
  date?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rs-view">
      <div className="rs-view-bar">
        <button type="button" className="labord-btn labord-btn--ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" aria-hidden /> {backLabel}
        </button>
        <span className="rs-view-actions">
          {onOpen && openLabel && (
            <button type="button" className="labord-btn" onClick={onOpen}>{openLabel}</button>
          )}
          <button type="button" className="labord-btn" onClick={() => printReportSheet(SHEET_ID, documentLabel, date)}>
            <Printer className="w-3.5 h-3.5" aria-hidden /> {t('action.print')}
          </button>
        </span>
      </div>
      <ReportDesk>{children}</ReportDesk>
    </div>
  );
}

/** Whether a lab or imaging order has a report to show. */
export const hasLabReport = (lab: LabResultDoc) => lab.status === 'completed';
/** Whether a prescription has a dispensing record to show. */
export const hasDispensingRecord = (rx: PrescriptionDoc) => !!rx.dispensedAt || rx.status === 'dispensed';
