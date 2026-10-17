/**
 * The chart's screenings rows. A click has to change the row at once — the
 * patient prop only refreshes when the whole patient list reloads — and done
 * or declined screenings stay on the chart as the record, not vanish.
 */
import React from 'react';
import { act, click, flush, mountAndFlush, qa, type Mounted } from '../clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => {
  const map = (jest.requireActual('@/lib/i18n/locales/en') as { default: Record<string, string> }).default;
  const t = (key: string, vars?: Record<string, unknown>) =>
    (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? ''));
  return { useTranslation: () => ({ t }) };
});
const AUTH = { currentUser: { _id: 'u1', name: 'Dr. Wani', role: 'doctor', hospitalId: 'h1', orgId: 'o1' } };
jest.mock('@/lib/context', () => ({ useAuth: () => AUTH }));
const showToast = jest.fn();
const TOAST = { showToast };
jest.mock('@/components/Toast', () => ({ useToast: () => TOAST }));
const confirm = jest.fn(async () => true);
const confirmPrompt = jest.fn(async () => 'Tested elsewhere last month' as string | null);
jest.mock('@/components/ConfirmDialog', () => ({ useConfirm: () => confirm, useConfirmPrompt: () => confirmPrompt }));

type Entry = { id: string; type: string; status: 'due' | 'completed' | 'declined'; dueDate?: string; lastDoneDate?: string; intervalMonths?: number; notes?: string; recordedAt: string };
let store: Entry[] = [];
const write = (next: Entry[]) => { store = next; return next; };
jest.mock('@/lib/services/screening-service', () => ({
  completeScreening: jest.fn(async (_p: string, id: string) => write(store.map(s => (s.id === id
    ? (s.intervalMonths ? { ...s, lastDoneDate: '2026-10-16', dueDate: '2027-10-16' } : { ...s, status: 'completed', lastDoneDate: '2026-10-16' })
    : s)))),
  declineScreening: jest.fn(async (_p: string, id: string, reason?: string) => write(store.map(s => (s.id === id ? { ...s, status: 'declined', notes: reason } : s)))),
  removeScreening: jest.fn(async (_p: string, id: string) => write(store.filter(s => s.id !== id))),
  addScreening: jest.fn(),
}));

import ScreeningsPanel from '@/components/patients/ScreeningsPanel';
import type { PatientDoc } from '@/lib/db-types';

const via: Entry = { id: 's1', type: 'Cervical cancer (VIA)', status: 'due', dueDate: '2026-10-16', recordedAt: '2026-10-01T00:00:00Z' };
const bp: Entry = { id: 's2', type: 'Blood pressure', status: 'due', dueDate: '2026-10-20', intervalMonths: 12, recordedAt: '2026-10-01T00:00:00Z' };

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; jest.clearAllMocks(); });

async function mount(entries: Entry[]) {
  store = entries;
  // The prop never changes in these tests: the chart's list reload is not
  // what makes a click show.
  const patient = { _id: 'pat-1', screenings: entries } as unknown as PatientDoc;
  mounted = await mountAndFlush(<ScreeningsPanel patient={patient} />);
  return mounted.container;
}
const rowOf = (root: ParentNode, type: string) => qa<HTMLTableRowElement>(root, 'tbody tr').find(r => r.textContent?.includes(type))!;
const button = (row: ParentNode, text: string) => qa<HTMLButtonElement>(row, 'button').find(b => b.textContent?.includes(text) || b.getAttribute('aria-label')?.startsWith(text))!;
const press = async (b: HTMLButtonElement) => { await act(async () => { click(b); }); await flush(); };

test('Done on a one-off screening shows it completed straight away, and keeps it', async () => {
  const root = await mount([via]);
  await press(button(rowOf(root, 'Cervical'), 'Done'));
  const row = rowOf(root, 'Cervical');
  expect(row.textContent).toContain('Completed');
  expect(row.textContent).toContain('last done 2026-10-16');
  expect(button(row, 'Done')).toBeUndefined();
  expect(showToast).toHaveBeenCalledWith('Cervical cancer (VIA) marked done.', 'success');
});

test('Done on a recurring screening re-arms it to the next interval', async () => {
  const root = await mount([bp]);
  await press(button(rowOf(root, 'Blood pressure'), 'Done'));
  const row = rowOf(root, 'Blood pressure');
  expect(row.textContent).toContain('2027-10-16');
  expect(row.textContent).toContain('Every 12 months · last done 2026-10-16');
  expect(row.textContent).toContain('Due');
});

test('Decline asks for a reason and records it on the row', async () => {
  const root = await mount([via]);
  await press(button(rowOf(root, 'Cervical'), 'Decline'));
  expect(confirmPrompt).toHaveBeenCalledTimes(1);
  const row = rowOf(root, 'Cervical');
  expect(row.textContent).toContain('Declined');
  expect(row.textContent).toContain('Tested elsewhere last month');
});

test('cancelling the decline prompt changes nothing', async () => {
  confirmPrompt.mockResolvedValueOnce(null);
  const root = await mount([via]);
  await press(button(rowOf(root, 'Cervical'), 'Decline'));
  const { declineScreening } = jest.requireMock('@/lib/services/screening-service') as { declineScreening: jest.Mock };
  expect(declineScreening).not.toHaveBeenCalled();
  expect(rowOf(root, 'Cervical').textContent).toContain('Due');
});

test('remove asks first, then the row goes', async () => {
  const root = await mount([via, bp]);
  await press(button(rowOf(root, 'Cervical'), 'Remove'));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(rowOf(root, 'Cervical')).toBeUndefined();
  expect(rowOf(root, 'Blood pressure')).toBeDefined();
});

test('outstanding screenings come before the record', async () => {
  const done: Entry = { ...via, id: 's3', type: 'HIV test', status: 'completed', lastDoneDate: '2026-09-01' };
  const root = await mount([done, bp]);
  const order = qa<HTMLTableRowElement>(root, 'tbody tr').map(r => r.querySelector('td')?.textContent);
  expect(order).toEqual(['Blood pressure', 'HIV test']);
});
