'use client';

/**
 * One worklist row per patient.
 *
 * The lab and pharmacy queues listed one row per order, so a patient with three
 * tests read as three patients. `groupRowsByPatient` folds a station's order
 * rows into one row per patient: the row shows the first order plus how many
 * more ("HIV Rapid Test +2"), and its panel lists every order with that order's
 * own status picker and action. A patient with one order keeps their row as it
 * was, minus the field panel that only repeated it.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { statusToneClass, type EhrCareDashboardRow } from './EhrCareDashboard';

/** Items grouped by key, in the order each key first appears — so a queue
 *  already sorted by priority stays sorted by each patient's first order. */
export function groupByPatient<T>(items: readonly T[], patientKey: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = patientKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/** The first order's label plus how many more the patient has. */
export function withOthers(label: string, others: number): string {
  return others > 0 ? `${label} +${others}` : label;
}

export interface EhrPatientOrder {
  id: string;
  title: string;
  detail?: string;
  /** A line under the title: what the order needs next. */
  note?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

export function EhrPatientOrderList({ orders, label }: { orders: EhrPatientOrder[]; label: string }) {
  return (
    <ul className="ehr-order-list" aria-label={label}>
      {orders.map(order => (
        <li key={order.id} className="ehr-order-list__item">
          <div className="ehr-order-list__main">
            {order.title && <strong>{order.title}</strong>}
            {order.detail && <span>{order.detail}</span>}
            {order.note && <p>{order.note}</p>}
          </div>
          {order.status && <div className="ehr-order-list__status">{order.status}</div>}
          {order.actions && <div className="ehr-order-list__actions">{order.actions}</div>}
        </li>
      ))}
    </ul>
  );
}

/** One order's status, as the row would have shown it: the row's own picker
 *  when it had one, otherwise its pill. */
export function EhrOrderStatus({ row, label }: { row: EhrCareDashboardRow; label: string }) {
  const text = row.statusLabel || row.status || '—';
  const pillClass = statusToneClass(row.statusTone);
  if (!row.statusOptions?.length || !row.onStatusChange) {
    return <span className={`appointment-status-pill ${pillClass}`.trim()}>{text}</span>;
  }
  return (
    <span className={`appointment-status-pill appointment-status-pill--select ${pillClass}`.trim()}>
      {text}
      <select
        value={row.statusValue ?? ''}
        aria-label={`Status for ${label}`}
        onChange={event => row.onStatusChange?.(event.target.value)}
      >
        {row.statusOptions.map(option => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </span>
  );
}

const TONE_RANK: Record<NonNullable<EhrCareDashboardRow['statusTone']>, number> = {
  danger: 3, warning: 2, active: 1, ready: 1, scheduled: 1, done: 0,
};

export interface GroupRowsOptions {
  /** Accessible name of the order list in a grouped row's panel. */
  listLabel: string;
  /** Label of each order's link to its own `detailHref`. */
  openLabel: string;
  /** One order's line; defaults to the row's context column, status and link. */
  orderLine?: (row: EhrCareDashboardRow) => EhrPatientOrder;
  /** Anything else a grouped row should override (its subtitle, full-page link). */
  groupRow?: (rows: EhrCareDashboardRow[]) => Partial<EhrCareDashboardRow>;
}

export function groupRowsByPatient(rows: EhrCareDashboardRow[], options: GroupRowsOptions): EhrCareDashboardRow[] {
  const orderLine = options.orderLine ?? ((row: EhrCareDashboardRow): EhrPatientOrder => ({
    id: row.id,
    title: row.location || row.subtitle || row.title,
    detail: row.locationSecondary,
    status: <EhrOrderStatus row={row} label={row.location || row.title} />,
    actions: row.detailHref
      ? <Link href={row.detailHref} className="btn btn-secondary btn-sm">{options.openLabel}</Link>
      : undefined,
  }));
  return groupByPatient(rows, row => row.patientId || row.title).map(group => {
    const [first] = group;
    if (group.length === 1) return { ...first, hideDetailFields: true };
    const lines = group.map(orderLine);
    // The pill speaks for the whole group, so it carries the most urgent
    // order's tone, and it is no longer a picker: which order would it move?
    const worst = group.reduce((a, b) => (TONE_RANK[b.statusTone ?? 'scheduled'] > TONE_RANK[a.statusTone ?? 'scheduled'] ? b : a));
    return {
      ...first,
      location: withOthers(lines[0].title, lines.length - 1),
      locationSecondary: lines.slice(1).map(line => line.title).join(', '),
      locationLabel: undefined,
      statusTone: worst.statusTone,
      statusOptions: undefined,
      statusValue: undefined,
      onStatusChange: undefined,
      priority: group.find(row => row.priority === 'RED')?.priority ?? first.priority,
      popupDetail: <EhrPatientOrderList label={options.listLabel} orders={lines} />,
      ...options.groupRow?.(group),
    };
  });
}
