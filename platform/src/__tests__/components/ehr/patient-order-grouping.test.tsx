/**
 * Lab and pharmacy queues show one row per patient: a patient with three
 * orders is one row ("HIV Rapid Test +2") whose panel lists every order, not
 * three rows with the same name.
 */
import React from 'react';
import { mount, type Mounted } from '../clinical-notes/test-utils';
import type { EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { groupRowsByPatient } from '@/components/ehr/EhrPatientOrders';

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const order = (id: string, patientId: string, test: string, extra: Partial<EhrCareDashboardRow> = {}): EhrCareDashboardRow => ({
  id,
  patientId,
  title: patientId === 'p1' ? 'Achol Ayuel' : 'Deng Garang',
  subtitle: '',
  location: test,
  statusLabel: 'Tests ordered',
  statusTone: 'scheduled',
  statusOptions: [{ value: 'pending', label: 'Tests ordered' }, { value: 'in_progress', label: 'In progress' }],
  statusValue: 'pending',
  onStatusChange: jest.fn(),
  detailHref: `/patients/${patientId}?focus=${id}`,
  ...extra,
});

const OPTIONS = { listLabel: 'Lab orders', openLabel: 'Open' };

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('groupRowsByPatient', () => {
  it('folds a patient\'s orders into one row with the first order and a count', () => {
    const rows = groupRowsByPatient([
      order('l1', 'p1', 'HIV Rapid Test'),
      order('l2', 'p2', 'Malaria RDT'),
      order('l3', 'p1', 'CBC'),
      order('l4', 'p1', 'Urinalysis'),
    ], OPTIONS);
    expect(rows.map(row => row.title)).toEqual(['Achol Ayuel', 'Deng Garang']);
    expect(rows[0]).toMatchObject({ id: 'l1', location: 'HIV Rapid Test +2', locationSecondary: 'CBC, Urinalysis' });
    // The group's pill can't move one order on the others' behalf.
    expect(rows[0].statusOptions).toBeUndefined();
    expect(rows[0].onStatusChange).toBeUndefined();
  });

  it('keeps a single order\'s row and drops the panel that repeated it', () => {
    const [row] = groupRowsByPatient([order('l2', 'p2', 'Malaria RDT')], OPTIONS);
    expect(row).toMatchObject({ location: 'Malaria RDT', hideDetailFields: true });
    expect(row.statusOptions).toHaveLength(2);
    expect(row.popupDetail).toBeUndefined();
  });

  it('carries the most urgent order\'s tone and lists each order with its own status and link', () => {
    const onCbc = jest.fn();
    const [row] = groupRowsByPatient([
      order('l1', 'p1', 'HIV Rapid Test'),
      order('l3', 'p1', 'CBC', { statusTone: 'danger', priority: 'RED', onStatusChange: onCbc }),
    ], OPTIONS);
    expect(row.statusTone).toBe('danger');
    expect(row.priority).toBe('RED');

    mounted = mount(<>{row.popupDetail}</>);
    const items = mounted.container.querySelectorAll('.ehr-order-list__item');
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain('CBC');
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/patients/p1?focus=l3');
    const select = items[1].querySelector('select')!;
    select.value = 'in_progress';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onCbc).toHaveBeenCalledWith('in_progress');
  });
});
