/**
 * useColumnSort orders the whole list, not just the page on screen, and its
 * header cycles ascending → descending → original order.
 */
import React, { act } from 'react';
import { mount, type Mounted } from '../clinical-notes/test-utils';
import { useColumnSort } from '@/components/table/useColumnSort';

const ITEMS = ['Metformin', 'Amlodipine', 'Paracetamol', 'Azithromycin'];

function Table() {
  const columnSort = useColumnSort<string>();
  const page = columnSort.sort(ITEMS).slice(0, 2);
  return (
    <table data-sort="data">
      <thead><tr><th {...columnSort.headerProps(0, item => item)}>Medication</th></tr></thead>
      <tbody>{page.map(item => <tr key={item}><td>{item}</td></tr>)}</tbody>
    </table>
  );
}

let view: Mounted;
afterEach(() => view?.unmount());
const header = () => view.container.querySelector('th')!;
const rows = () => Array.from(view.container.querySelectorAll('td')).map(cell => cell.textContent);
const click = () => act(() => { header().dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('useColumnSort', () => {
  it('cycles ascending, descending, then the original order across every page', () => {
    view = mount(<Table />);
    expect(rows()).toEqual(['Metformin', 'Amlodipine']);
    click();
    expect(header().getAttribute('aria-sort')).toBe('ascending');
    expect(rows()).toEqual(['Amlodipine', 'Azithromycin']);
    click();
    expect(header().getAttribute('aria-sort')).toBe('descending');
    expect(rows()).toEqual(['Paracetamol', 'Metformin']);
    click();
    expect(header().getAttribute('aria-sort')).toBe('none');
    expect(rows()).toEqual(['Metformin', 'Amlodipine']);
  });

  it('sorts from the keyboard', () => {
    view = mount(<Table />);
    act(() => { header().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(rows()).toEqual(['Amlodipine', 'Azithromycin']);
  });
});
