'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Keyboard } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useMessagingDock } from '@/modules/communication/client';
import Modal from '@/components/Modal';

const SHORTCUTS = [
  { keys: ['Alt', 'N'], altKeys: ['Ctrl', 'N'], descriptionKey: 'keyboardShortcuts.newPatient', action: '/patients/new' },
  { keys: ['Alt', 'S'], altKeys: ['/'], descriptionKey: 'keyboardShortcuts.focusSearch', action: 'focus-search' },
  { keys: ['Alt', 'D'], descriptionKey: 'keyboardShortcuts.goToDashboard', action: '/dashboard' },
  { keys: ['Alt', 'P'], descriptionKey: 'keyboardShortcuts.goToPatients', action: '/patients' },
  { keys: ['Alt', 'R'], descriptionKey: 'keyboardShortcuts.goToReferrals', action: '/referrals' },
  { keys: ['Alt', 'M'], descriptionKey: 'keyboardShortcuts.goToMessages', action: '/messages' },
  { keys: ['?'], descriptionKey: 'keyboardShortcuts.showKeyboardShortcuts', action: 'show-help' },
];

export default function KeyboardShortcuts() {
  const { t } = useTranslation();
  const router = useRouter();
  const { openDock } = useMessagingDock();
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const isInputFocused = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;

    // Allow ? and / only when not in an input
    if (isInputFocused) return;

    // ? → show help
    if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setShowHelp(prev => !prev);
      return;
    }

    // / → focus search
    if (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>('input[type="search"], input[data-global-search]');
      if (searchInput) {
        searchInput.focus();
      }
      return;
    }

    // Alt+key or Ctrl+key shortcuts
    if (e.altKey || e.ctrlKey) {
      const key = e.key.toLowerCase();

      if (key === 'n') {
        e.preventDefault();
        router.push('/patients/new');
        return;
      }
      if (e.altKey && key === 's') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[type="search"], input[data-global-search]');
        if (searchInput) {
          searchInput.focus();
        }
        return;
      }
      if (e.altKey && key === 'd') {
        e.preventDefault();
        router.push('/dashboard');
        return;
      }
      if (e.altKey && key === 'p') {
        e.preventDefault();
        router.push('/patients');
        return;
      }
      if (e.altKey && key === 'r') {
        e.preventDefault();
        router.push('/referrals');
        return;
      }
      if (e.altKey && key === 'm') {
        e.preventDefault();
        // Open the floating dock in place rather than navigating away — the
        // whole point of the shortcut is messaging without losing the chart.
        openDock();
        return;
      }
    }
  }, [router, openDock]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!showHelp) return null;

  return (
    <Modal onClose={() => setShowHelp(false)} width={448} labelledBy="keyboard-shortcuts-title">
      <div
        className="modal-panel w-full overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-panel)',
          borderRadius: 'var(--card-radius)',
          boxShadow: 'var(--card-shadow-xl)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--table-row-border)' }}
        >
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <h2 id="keyboard-shortcuts-title" className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('keyboardShortcuts.title')}
            </h2>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            className="p-1 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="px-5 py-3">
          {SHORTCUTS.map((shortcut, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2.5"
              style={{ borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--table-row-border)' : 'none' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t(shortcut.descriptionKey)}
              </span>
              <div className="flex items-center gap-1.5">
                {shortcut.keys.map((key, j) => (
                  <span key={j}>
                    <kbd
                      className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-mono font-bold"
                      style={{
                        background: 'var(--overlay-subtle)',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--text-primary)',
                        minWidth: '24px',
                      }}
                    >
                      {key}
                    </kbd>
                    {j < shortcut.keys.length - 1 && (
                      <span className="text-xs mx-0.5" style={{ color: 'var(--text-muted)' }}>+</span>
                    )}
                  </span>
                ))}
                {shortcut.altKeys && (
                  <>
                    <span className="text-xs mx-1" style={{ color: 'var(--text-muted)' }}>{t('keyboardShortcuts.or')}</span>
                    {shortcut.altKeys.map((key, j) => (
                      <span key={j}>
                        <kbd
                          className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-mono font-bold"
                          style={{
                            background: 'var(--overlay-subtle)',
                            border: '1px solid var(--border-medium)',
                            color: 'var(--text-primary)',
                            minWidth: '24px',
                          }}
                        >
                          {key}
                        </kbd>
                        {j < (shortcut.altKeys?.length ?? 0) - 1 && (
                          <span className="text-xs mx-0.5" style={{ color: 'var(--text-muted)' }}>+</span>
                        )}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--table-row-border)' }}>
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            {t('keyboardShortcuts.pressToToggle')} <kbd className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)' }}>?</kbd> {t('keyboardShortcuts.toToggleDialog')}
          </p>
        </div>
      </div>
    </Modal>
  );
}
