'use client';

/**
 * FingerprintIdentifyModal — 1:N patient identification by fingerprint.
 *
 * Captures a probe from the local scanner via fingerprint-bridge, matches it
 * against the locally-replicated template database (works offline), and lets
 * staff open the matched patient's record. Used from the patients page
 * "Find Patient" flow.
 */

import { useState, useEffect, useCallback } from 'react';
import { ScanLine, X, RefreshCw, ChevronRight, UserCheck } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import {
  getBridgeStatus,
  captureFingerprint,
  identifyPatient,
  type BridgeStatus,
  type IdentifyMatch,
} from '@/lib/services/fingerprint-service';
import type { DataScope } from '@/lib/services/data-scope';

interface FingerprintIdentifyModalProps {
  onSelect: (patientId: string) => void;
  onClose: () => void;
}

export default function FingerprintIdentifyModal({ onSelect, onClose }: FingerprintIdentifyModalProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'results'>('idle');
  const [matches, setMatches] = useState<IdentifyMatch[]>([]);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    setStatus(await getBridgeStatus());
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const ready = !!status?.available && !!status?.scannerConnected;

  const handleScan = async () => {
    setPhase('scanning');
    setError('');
    try {
      const capture = await captureFingerprint();
      // Identification searches the whole org, not just this facility —
      // a patient enrolled at one clinic must be findable at another.
      const scope: DataScope | undefined = currentUser
        ? { role: currentUser.role, orgId: currentUser.orgId }
        : undefined;
      const found = await identifyPatient(capture.template, scope);
      setMatches(found);
      setPhase('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fingerprint.captureFailed'));
      setPhase('idle');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--card-bg, var(--bg-card))' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ScanLine className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            {t('fingerprint.identifyTitle')}
          </h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!ready && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
              <span>{status?.available ? t('fingerprint.scannerDisconnected') : t('fingerprint.bridgeUnavailable')}</span>
              <button type="button" onClick={refreshStatus} className="btn btn-secondary btn-sm ml-auto">
                <RefreshCw className="w-3.5 h-3.5" /> {t('fingerprint.retry')}
              </button>
            </div>
          )}

          {ready && phase !== 'results' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'transparent' }}>
                {phase === 'scanning' ? (
                  <span className="animate-spin inline-block w-6 h-6 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--tamamhealth-blue)', borderTopColor: 'transparent' }} />
                ) : (
                  <ScanLine className="w-8 h-8" style={{ color: 'var(--tamamhealth-blue)' }} />
                )}
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {phase === 'scanning' ? t('fingerprint.identifyScanning') : t('fingerprint.identifyPrompt')}
              </p>
              <button onClick={handleScan} disabled={phase === 'scanning'} className="btn btn-primary" style={{ opacity: phase === 'scanning' ? 0.6 : 1 }}>
                <ScanLine className="w-4 h-4" /> {t('fingerprint.identifyScan')}
              </button>
              {error && <p className="text-[11px]" role="alert" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
            </div>
          )}

          {phase === 'results' && (
            <div className="space-y-3">
              {matches.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('fingerprint.noMatch')}
                </p>
              ) : (
                <>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t('fingerprint.matchesFound', { count: matches.length })}
                  </p>
                  {matches.map(m => (
                    <button
                      key={m.patientId}
                      onClick={() => onSelect(m.patientId)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--accent-light)]"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
                    >
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'transparent' }}>
                        <UserCheck className="w-5 h-5" style={{ color: 'var(--tamamhealth-blue)' }} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{m.patientName}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {t('fingerprint.confidence', { score: m.score })}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 ml-auto" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  ))}
                </>
              )}
              <button onClick={() => { setPhase('idle'); setMatches([]); }} className="btn btn-secondary btn-sm w-full">
                <RefreshCw className="w-3.5 h-3.5" /> {t('fingerprint.scanAgain')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
