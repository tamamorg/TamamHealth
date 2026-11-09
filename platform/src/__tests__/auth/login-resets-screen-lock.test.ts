/**
 * A password sign-in starts the screen lock fresh (2026-11-08 sweep).
 *
 * A session that ended without a sign-out (the cookie expired) left the last
 * activity time in the lock state, and the next sign-in opened straight on
 * "Session Locked" because the idle window had long passed. The reset must run
 * in login() before the session is set, so the lock hook reads fresh state.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '../../lib/context.tsx'), 'utf8');

describe('login resets the screen-lock state', () => {
  it('writes an unlocked, fresh lock state before setting the signed-in user', () => {
    const loginStart = source.indexOf('const login = useCallback(');
    const reset = source.indexOf("writeLockState(appUser._id, { locked: false, at: Date.now(), fails: 0 })", loginStart);
    const setUser = source.indexOf('setCurrentUser(appUser);', loginStart);
    expect(loginStart).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(loginStart);
    expect(setUser).toBeGreaterThan(reset);
    expect(source.slice(reset, setUser)).toContain('clearTabLocked(appUser._id)');
  });
});
