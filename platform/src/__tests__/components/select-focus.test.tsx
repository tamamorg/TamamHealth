/**
 * Opening a dropdown hands it the keyboard. The popup mounts only once its
 * position is measured, a render after it opens; the focus effect used to run
 * before that, find nothing mounted, and leave focus where it was — so typing,
 * arrows and Enter never reached the list and it could only be worked with
 * the mouse.
 */
import React, { act } from 'react';
import { mount, type Mounted } from './clinical-notes/test-utils';

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import Select from '@/components/Select';

const NOTE_TYPES = ['Consultation', 'H&P', 'Procedure', 'Discharge Summary', 'Nurse Visit', 'OB Evaluation', 'Phone', 'Memo to Record'];

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const open = (select: HTMLSelectElement) => act(() => {
  select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
});

describe('Select keyboard focus', () => {
  it('focuses the filter box of a long list on first open', () => {
    mounted = mount(
      <Select aria-label="Note type" defaultValue="Consultation">
        {NOTE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      </Select>,
    );
    open(mounted.container.querySelector('select')!);
    const search = document.querySelector<HTMLInputElement>('.tsel-search input');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it('focuses the menu of a short list on first open', () => {
    mounted = mount(
      <Select aria-label="Order type" defaultValue="all">
        <option value="all">All</option>
        <option value="drug">Drug</option>
      </Select>,
    );
    open(mounted.container.querySelector('select')!);
    expect(document.activeElement).toBe(document.querySelector('.tsel-menu'));
  });
});
