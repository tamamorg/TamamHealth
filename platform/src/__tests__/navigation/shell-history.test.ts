import { consumeShellHistoryEntry, recordShellHistoryEntry } from '@/lib/mobile-shell/shell-history';

describe('mobile shell history entries', () => {
  it('pops an overlay URL that the shell pushed', () => {
    const target = '/dashboard?day=2026-08-19&chart=patient-1';
    recordShellHistoryEntry('chart', target);

    expect(consumeShellHistoryEntry('chart', target)).toBe(true);
    expect(consumeShellHistoryEntry('chart', target)).toBe(false);
  });

  it('does not pop history for a direct deep link', () => {
    expect(consumeShellHistoryEntry('sheet', '/dashboard?sheet=modules')).toBe(false);
  });

  it('does not consume a marker on an unrelated URL', () => {
    recordShellHistoryEntry('sheet', '/dashboard?sheet=create');

    expect(consumeShellHistoryEntry('sheet', '/patients?sheet=create')).toBe(false);
    expect(consumeShellHistoryEntry('sheet', '/dashboard?sheet=create')).toBe(true);
  });
});
