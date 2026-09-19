import React from 'react';
import { mountAndFlush, clickAsync } from '../components/clinical-notes/test-utils';
import { moduleIdentity } from '@/components/ehr/module-identity';
import EhrTopActions from '@/components/ehr/EhrTopActions';
import { Users } from '@/components/icons/lucide';

describe('clinical module identity', () => {
  test.each([
    ['/lab', 'laboratory'], ['/lab/orders/123', 'laboratory'],
    ['/dashboard/lab?view=queue', 'laboratory'], ['/radiology', 'imaging'],
    ['/pharmacy', 'pharmacy'], ['/anc', 'family'], ['/payments/claims', 'finance'],
    ['/billing/123#payments', 'finance'], ['/patients/new', 'care'],
    ['/admin/audit', 'operations'], ['/laboratory-unknown', 'care'],
  ])('%s has stable module identity %s', (href, tone) => {
    expect(moduleIdentity(href).tone).toBe(tone);
  });

  it('retains navigation, active state and work counts after restyling', async () => {
    const open = jest.fn();
    const mounted = await mountAndFlush(<EhrTopActions
      items={[{ href: '/patients', label: 'Patients', icon: Users }]}
      navLabel={item => item.label} activeHref="/patients" onOpenModule={open}
      badges={{ '/patients': 3 }} />);
    const button = mounted.container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Patients, 3 waiting');
    expect(button.getAttribute('aria-current')).toBe('page');
    expect(button.textContent).toBe('3');
    expect(mounted.container.querySelector('.ehr-module-shortcut-label')).toBeNull();
    expect(mounted.container.querySelector('[data-module-tone]')).toBeNull();
    await clickAsync(button);
    expect(open).toHaveBeenCalledWith('/patients');
    mounted.unmount();
  });
});
