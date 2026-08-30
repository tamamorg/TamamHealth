import { renderToStaticMarkup } from 'react-dom/server';
import SyncStatusBadge, { hasUnsyncedWrite, worstOfflineSync, type OfflineSyncMeta } from '@/components/ehr/SyncStatusBadge';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const meta = (status: OfflineSyncMeta['status']): OfflineSyncMeta => ({ status });

describe('SyncStatusBadge', () => {
  it('renders nothing when offlineSync is absent', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge />);
    expect(markup).toBe('');
  });

  it('renders nothing for the synced (quiet, default) state', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta('synced')} />);
    expect(markup).toBe('');
  });

  it('renders a subtle, neutral-toned chip for pending', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta('pending')} />);
    expect(markup).toContain('sync-status-badge--neutral');
    expect(markup).toContain('sync.docPendingLabel');
    expect(markup).toContain('title="sync.docPendingTooltip"');
  });

  it('treats the unassigned "local" status the same as pending', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta('local')} />);
    expect(markup).toContain('sync-status-badge--neutral');
    expect(markup).toContain('sync.docPendingLabel');
  });

  it('renders a danger-toned chip for failed, distinct from pending', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta('failed')} />);
    expect(markup).toContain('sync-status-badge--danger');
    expect(markup).toContain('sync.docFailedLabel');
    expect(markup).toContain('title="sync.docFailedTooltip"');
    expect(markup).not.toContain('sync.docPendingLabel');
  });

  it('renders a danger-toned chip for conflict, distinct from failed', () => {
    const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta('conflict')} />);
    expect(markup).toContain('sync-status-badge--danger');
    expect(markup).toContain('sync.docConflictLabel');
    expect(markup).toContain('title="sync.docConflictTooltip"');
    expect(markup).not.toContain('sync.docFailedLabel');
  });

  it('is never color-only: every rendered state pairs an icon with a visible text label', () => {
    (['pending', 'failed', 'conflict'] as const).forEach(status => {
      const markup = renderToStaticMarkup(<SyncStatusBadge offlineSync={meta(status)} />);
      expect(markup).toContain('<svg');
      // The visible label text is present as element content, not just the
      // title attribute — so a reader who never hovers still sees the word.
      expect(markup.replace(/title="[^"]*"/, '')).toMatch(/sync\.doc(Pending|Failed|Conflict)Label/);
    });
  });
});

describe('hasUnsyncedWrite', () => {
  it('is false for a doc with no offlineSync at all', () => {
    expect(hasUnsyncedWrite({})).toBe(false);
    expect(hasUnsyncedWrite(undefined)).toBe(false);
  });

  it('is false once a doc is synced', () => {
    expect(hasUnsyncedWrite({ offlineSync: meta('synced') })).toBe(false);
  });

  it('is true for pending, failed, and conflict', () => {
    expect(hasUnsyncedWrite({ offlineSync: meta('pending') })).toBe(true);
    expect(hasUnsyncedWrite({ offlineSync: meta('failed') })).toBe(true);
    expect(hasUnsyncedWrite({ offlineSync: meta('conflict') })).toBe(true);
  });
});

describe('worstOfflineSync', () => {
  it('returns undefined when given nothing', () => {
    expect(worstOfflineSync()).toBeUndefined();
    expect(worstOfflineSync(undefined, undefined)).toBeUndefined();
  });

  it('picks the only defined status', () => {
    expect(worstOfflineSync(undefined, meta('pending'))).toEqual(meta('pending'));
  });

  it('prefers conflict over failed, and failed over pending', () => {
    expect(worstOfflineSync(meta('pending'), meta('failed'))).toEqual(meta('failed'));
    expect(worstOfflineSync(meta('failed'), meta('conflict'))).toEqual(meta('conflict'));
    expect(worstOfflineSync(meta('conflict'), meta('pending'))).toEqual(meta('conflict'));
  });

  it('prefers any unsynced status over synced', () => {
    expect(worstOfflineSync(meta('synced'), meta('pending'))).toEqual(meta('pending'));
  });

  it('is order-independent', () => {
    const a = meta('pending');
    const b = meta('conflict');
    expect(worstOfflineSync(a, b)).toEqual(worstOfflineSync(b, a));
  });
});
