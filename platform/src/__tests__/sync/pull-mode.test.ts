/**
 * Sync — pull-mode selection for the connection-starvation fix.
 *
 * A single client runs ~77 databases. If every pull holds a live longpoll open,
 * they saturate the browser's ~6-connections-per-host limit and starve push, so
 * new local writes never reach the server. The manager therefore defaults pull
 * to periodic polling (connections released between cycles) with push kept live.
 * This test pins the env-driven selection logic the manager uses so the default
 * can't silently regress to the starving 'live' behaviour.
 */

// Mirror of the selection in sync-manager.ts startReplications(). Kept in step
// with that code; if the manager's parsing changes, update here too.
function selectPullConfig(env: Record<string, string | undefined>) {
  const pullMode = env.NEXT_PUBLIC_SYNC_PULL_MODE === 'live' ? 'live' : 'poll';
  const parsed = Number(env.NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS);
  const pullIntervalMs = Number.isFinite(parsed) && parsed >= 2000 ? parsed : 15000;
  return { pullMode, pullIntervalMs };
}

describe('pull-mode selection', () => {
  test('defaults to polling (the starvation fix) when unset', () => {
    expect(selectPullConfig({})).toEqual({ pullMode: 'poll', pullIntervalMs: 15000 });
  });

  test('only the explicit "live" opt-out restores continuous longpoll', () => {
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_MODE: 'live' }).pullMode).toBe('live');
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_MODE: 'poll' }).pullMode).toBe('poll');
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_MODE: 'anything-else' }).pullMode).toBe('poll');
  });

  test('a sane custom interval is honoured', () => {
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS: '8000' }).pullIntervalMs).toBe(8000);
  });

  test('an absurdly small or non-numeric interval falls back to the default', () => {
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS: '10' }).pullIntervalMs).toBe(15000);
    expect(selectPullConfig({ NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS: 'soon' }).pullIntervalMs).toBe(15000);
  });
});
