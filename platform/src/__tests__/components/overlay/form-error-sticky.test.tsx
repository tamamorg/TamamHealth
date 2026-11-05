/**
 * A form's error stays on screen for as long as the form holds it. A notice
 * that faded after ten seconds left a second failed Save (same message, so no
 * change and no new notice) as a dead button with nothing on screen.
 */
import { mount, rerender } from '../clinical-notes/test-utils';
import { FormError } from '@/components/overlay/FormNotices';

const showToast = jest.fn(() => 7);
const dismissToast = jest.fn();
jest.mock('@/components/Toast', () => ({ useToast: () => ({ showToast, dismissToast }) }));

afterEach(() => { showToast.mockClear(); dismissToast.mockClear(); document.body.innerHTML = ''; });

it('holds the error up until the form clears it', () => {
  const { root, unmount } = mount(<FormError message="Enter an amount." />);
  expect(showToast).toHaveBeenCalledWith('Enter an amount.', 'error', expect.objectContaining({ sticky: true }));
  expect(dismissToast).not.toHaveBeenCalled();

  rerender(root, <FormError message="" />);
  expect(dismissToast).toHaveBeenCalledWith(7);
  unmount();
});

it('takes the notice down when the form closes', () => {
  const { unmount } = mount(<FormError message="Enter an amount." />);
  unmount();
  expect(dismissToast).toHaveBeenCalledWith(7);
});
