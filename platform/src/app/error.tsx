'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Home } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error('[TamamHealth] Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-app)' }}>
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{
          background: 'transparent',
        }}>
          <AlertTriangle className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          {t('error.title')}
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {t('error.description')}
        </p>
        {process.env.NODE_ENV !== 'production' && (
          <div className="mb-6 p-3 rounded-xl text-start" style={{
            background: 'var(--color-danger-bg)',
            border: '1px solid color-mix(in srgb, var(--color-danger) 12%, transparent)',
          }}>
            <p className="text-xs font-mono break-all" style={{ color: 'var(--color-danger-text)' }}>
              {error.message}
            </p>
          </div>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{
              background: 'var(--accent-primary)',
              boxShadow: 'none',
            }}
          >
            <RotateCcw className="w-4 h-4" /> {t('error.tryAgain')}
          </button>
          <a
            href="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{
              background: 'var(--overlay-subtle)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-light)',
            }}
          >
            <Home className="w-4 h-4" /> {t('error.dashboard')}
          </a>
        </div>
      </div>
    </div>
  );
}
