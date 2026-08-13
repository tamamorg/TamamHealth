'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, ScanLine } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface QRScannerProps {
  onScan: (data: { id: string; hospitalNumber?: string }) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const { t } = useTranslation();
  const scannerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html5QrRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const hasProcessed = useRef(false);

  const handleScanSuccess = useCallback((decodedText: string) => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    try {
      const data = JSON.parse(decodedText);
      if (data.type === 'TamamHealth_PATIENT' && data.id) {
        onScan({ id: data.id, hospitalNumber: data.hn });
      } else {
        setError(t('qrScanner.errorInvalidCode'));
        hasProcessed.current = false;
      }
    } catch {
      // Not JSON — try treating the raw text as a patient ID
      if (decodedText.startsWith('patient_')) {
        onScan({ id: decodedText });
      } else {
        setError(t('qrScanner.errorUnrecognizedFormat'));
        hasProcessed.current = false;
      }
    }
  }, [onScan]);

  useEffect(() => {
    // Track whether the effect was torn down before the async scanner.start()
    // resolved. In React Strict Mode the effect runs → tears down → re-runs
    // synchronously on mount; without this guard the first run's camera
    // stream stays open because cleanup ran before `scanner` was assigned.
    let cancelled = false;

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!scannerRef.current || cancelled) return;

        const scanner = new Html5Qrcode('qr-reader');
        html5QrRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1,
          },
          handleScanSuccess,
          () => {} // ignore scan failures (no QR in frame)
        );
        if (cancelled) {
          // Cleanup ran before start() resolved — tear down now.
          try { await scanner.stop(); } catch { /* ignore */ }
          try { scanner.clear(); } catch { /* ignore */ }
          html5QrRef.current = null;
          return;
        }
        setScanning(true);
      } catch (err) {
        if (cancelled) return;
        console.error('QR scanner error:', err);
        const msg = err instanceof Error ? err.message : '';
        setError(
          msg.includes('NotAllowedError') || msg.includes('Permission')
            ? t('qrScanner.errorPermissionDenied')
            : t('qrScanner.errorCameraStart')
        );
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      const scanner = html5QrRef.current;
      if (scanner) {
        scanner.stop().catch(() => {});
        try { scanner.clear(); } catch { /* ignore */ }
        html5QrRef.current = null;
      }
    };
  }, [handleScanSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="relative w-full max-w-md mx-4 rounded-2xl overflow-hidden" style={{ background: 'var(--card-bg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5" style={{ color: 'var(--tamamhealth-blue)' }} />
            <h3 className="text-sm font-semibold">{t('qrScanner.title')}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scanner viewport */}
        <div className="relative" style={{ minHeight: 320 }}>
          <div id="qr-reader" ref={scannerRef} className="w-full" />

          {!scanning && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Camera className="w-10 h-10 animate-pulse" style={{ color: 'var(--tamamhealth-blue)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('qrScanner.startingCamera')}</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'transparent' }}>
                <X className="w-6 h-6" style={{ color: 'var(--color-danger)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
              <button
                onClick={onClose}
                className="btn btn-secondary text-xs mt-2"
              >
                {t('action.close')}
              </button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-3 text-center border-t" style={{ borderColor: 'var(--border-light)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('qrScanner.footerHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
