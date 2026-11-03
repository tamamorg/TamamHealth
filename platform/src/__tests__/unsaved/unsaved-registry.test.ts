import {
  __resetUnsavedRegistryForTests, hasUnsavedWork, pendingReloadReason, registerFlusher,
  registerUnsavedSource, requestReload, subscribeReloadRequests,
} from '@/lib/unsaved/unsaved-registry';

afterEach(() => __resetUnsavedRegistryForTests());

it('asks before a refresh only while something is unsaved', () => {
  let dirty = true;
  const unregister = registerUnsavedSource(() => dirty);
  const first = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);

  dirty = false;
  const second = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(second);
  expect(second.defaultPrevented).toBe(false);
  unregister();
  expect(hasUnsavedWork()).toBe(false);
});

it('writes pending drafts when the page is hidden or about to go', async () => {
  const flush = jest.fn();
  registerFlusher(flush);
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  await Promise.resolve();
  expect(flush).toHaveBeenCalled();
});

it('turns the app\'s own reload into a question while something is unsaved', () => {
  registerUnsavedSource(() => true);
  const heard: Array<string | null> = [];
  subscribeReloadRequests(reason => heard.push(reason));
  requestReload('reload.reason.update');
  expect(heard).toEqual(['reload.reason.update']);
  expect(pendingReloadReason()).toBe('reload.reason.update');
});

it('asks before an in-app link to another page, not one to the same page', () => {
  registerUnsavedSource(() => true);
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const away = document.createElement('a');
  away.href = '/billing';
  const sameTab = document.createElement('a');
  sameTab.href = `${window.location.pathname}?tab=labs`;
  document.body.append(away, sameTab);

  const toSameTab = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  sameTab.dispatchEvent(toSameTab);
  expect(confirm).not.toHaveBeenCalled();

  const toAway = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  away.dispatchEvent(toAway);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(toAway.defaultPrevented).toBe(true);
  away.remove(); sameTab.remove(); confirm.mockRestore();
});
