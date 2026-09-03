/**
 * The status pill selects drop focus once a choice is committed.
 *
 * A native <select> matches `:focus-visible` even when operated by mouse, so
 * without the blur the pill kept its 2px keyboard focus ring after every
 * selection until the next click landed somewhere else — reported as "why does
 * it stay blue around after selection". Keyboard users tabbing through still
 * get the ring while the control is focused; only committing a choice clears
 * it.
 */
import { act } from 'react';
import { mount, setSelect } from '../clinical-notes/test-utils';
import AppointmentStatusPillSelect from '@/components/appointments/AppointmentStatusPillSelect';
import RowStatusSelect from '@/components/ehr/RowStatusSelect';

describe('status pill selects release focus after a pick', () => {
  it('AppointmentStatusPillSelect blurs the select on change', () => {
    const onChange = jest.fn();
    const m = mount(
      <AppointmentStatusPillSelect
        status="scheduled"
        ariaLabel="Appointment status"
        role="front_desk"
        onChange={onChange}
      />,
    );
    const select = m.container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => { select.focus(); });
    expect(document.activeElement).toBe(select);

    setSelect(select, 'checked_in');
    expect(onChange).toHaveBeenCalledWith('checked_in');
    expect(document.activeElement).not.toBe(select);
    m.unmount();
  });

  it('RowStatusSelect blurs the select on change', () => {
    const onSelect = jest.fn();
    const m = mount(
      <RowStatusSelect
        label="Pending"
        value="pending"
        ariaLabel="Leave status"
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
        ]}
        onSelect={onSelect}
      />,
    );
    const select = m.container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();

    act(() => { select.focus(); });
    expect(document.activeElement).toBe(select);

    setSelect(select, 'approved');
    expect(onSelect).toHaveBeenCalledWith('approved');
    expect(document.activeElement).not.toBe(select);
    m.unmount();
  });
});
