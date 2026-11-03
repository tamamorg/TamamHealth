'use client';

/**
 * A finished result as the document it is — lab report, imaging report,
 * dispensing record — laid out the way it prints: facility and document at
 * the top, Patient Information, the results in a ruled table, the details in a
 * ruled field grid. What a clinician reads on screen is what the patient
 * carries away. Every report on the chart is drawn by this one component, so
 * they read as one system.
 *
 * The on-screen heading is hidden on paper, where printElementById draws the
 * shared one (`printReportSheet`).
 */

import { Fragment, type ReactNode } from 'react';
import { getPrintIdentity, printDate } from '@/lib/print-identity';
import { printElementById } from '@/lib/safe-html';
import './report-sheet.css';

export type ReportTone = 'critical' | 'abnormal' | 'normal';

export interface ReportField { label: string; value?: ReactNode }

export interface ReportTable {
  columns: string[];
  rows: { id: string; group?: string; cells: ReactNode[]; tone?: ReportTone }[];
  /** One summary line under the table (a lab's interpretation). */
  summary?: { label: string; value: string; tone?: ReportTone };
}

export type ReportSection =
  | { title: string; fields: ReportField[] }
  | { title: string; table: ReportTable }
  | { title: string; text?: string | null };

export interface ReportSheetProps {
  /** Element id the print button targets. */
  id: string;
  /** The document type, top right ("Lab Report"). */
  documentLabel: string;
  date?: string | null;
  /** A red line under the date (STAT). */
  flag?: string;
  facilityName?: string;
  /** A warning band above the patient block (an amended result). */
  notice?: ReactNode;
  patientTitle: string;
  patient: ReportField[];
  sections: ReportSection[];
}

const shown = (value: ReactNode) => (typeof value === 'string' ? value.trim() : value) || '—';

function Fields({ fields }: { fields: ReportField[] }) {
  return (
    <div className="rs-fields">
      {fields.map(field => (
        <div key={field.label} className="rs-field">
          <span>{field.label}</span>
          <strong>{shown(field.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Table({ table }: { table: ReportTable }) {
  return (
    <>
      <table className="rs-table">
        <thead>
          <tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => {
            // A band over the first row of each group.
            const groupRow = !!row.group && table.rows[index - 1]?.group !== row.group;
            return (
              <Fragment key={row.id}>
                {groupRow && (
                  <tr className="rs-group"><th scope="rowgroup" colSpan={table.columns.length}>{row.group}</th></tr>
                )}
                <tr>
                  {row.cells.map((cell, cellIndex) => (
                    <td
                      // The first cell names the row; the second carries its value and tone.
                      key={cellIndex}
                      className={cellIndex === 0 ? `rs-name${row.group ? ' is-in-group' : ''}` : cellIndex === 1 ? `rs-value${row.tone ? ` is-${row.tone}` : ''}` : undefined}
                    >
                      {shown(cell)}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {table.summary && (
        <p className={`rs-summary${table.summary.tone ? ` is-${table.summary.tone}` : ''}`}>
          <span>{table.summary.label}</span>
          <strong>{table.summary.value}</strong>
        </p>
      )}
    </>
  );
}

export default function ReportSheet({
  id, documentLabel, date, flag, facilityName, notice, patientTitle, patient, sections,
}: ReportSheetProps) {
  const facility = getPrintIdentity()?.facilityName || facilityName || 'TamamHealth';
  return (
    <article id={id} className="rs-sheet">
      <header className="rs-head">
        <div className="rs-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static mark the print heading also uses */}
          <img src="/assets/tamam-icon.svg" alt="" />
          <strong>{facility}</strong>
        </div>
        <div className="rs-identity">
          <strong>{documentLabel}</strong>
          {date && <span>{printDate(date)}</span>}
          {flag && <em>{flag}</em>}
        </div>
      </header>

      {notice && <p className="rs-notice">{notice}</p>}

      <section className="rs-block">
        <h3 className="rs-title">{patientTitle}</h3>
        <Fields fields={patient} />
      </section>

      {sections.map(section => (
        <section key={section.title} className="rs-block">
          <h3 className="rs-title">{section.title}</h3>
          {'fields' in section && <Fields fields={section.fields} />}
          {'table' in section && <Table table={section.table} />}
          {'text' in section && <p className="rs-text">{section.text?.trim() || '—'}</p>}
        </section>
      ))}
    </article>
  );
}

/** Print one sheet with the shared paper heading (facility, document, date). */
export function printReportSheet(id: string, documentLabel: string, date?: string | null) {
  printElementById(id, { label: documentLabel, date: date || undefined });
}

/** The tinted ground a sheet sits on, on screen. */
export function ReportDesk({ children }: { children: ReactNode }) {
  return <div className="rs-desk">{children}</div>;
}
