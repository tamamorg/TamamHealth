'use client';

/**
 * FingerprintCapture — consent-gated fingerprint enrollment widget.
 *
 * Controlled component: captured templates accumulate in `value` (parent form
 * state) and are persisted by the parent AFTER the patient record is created
 * (see patients/new). Talks to the local fingerprint-bridge via
 * fingerprint-service; degrades to an informational note when the feature
 * flag is off or the bridge/scanner is unavailable — the section stays
 * visible so staff know fingerprint intake is part of registration, but
 * registration must never depend on biometric hardware.
 */

import { useState, useEffect, useCallback } from 'react';
import { ScanLine, X, RefreshCw, Check } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  isFingerprintEnabled,
  getBridgeStatus,
  captureFingerprint,
  type BridgeStatus,
} from '@/lib/services/fingerprint-service';
import type { FingerPosition, BiometricTemplateFormat } from '@/lib/db-types-biometrics';
import Select from '@/components/Select';

export interface CapturedFingerprint {
  finger: FingerPosition;
  template: string;
  quality: number;
  format: BiometricTemplateFormat;
  driver: string;
}

interface FingerprintCaptureProps {
  value: CapturedFingerprint[];
  onChange: (captures: CapturedFingerprint[]) => void;
}

const FINGER_OPTIONS: { value: FingerPosition; labelKey: string }[] = [
  { value: 'right_thumb', labelKey: 'fingerprint.fingerRightThumb' },
  { value: 'right_index', labelKey: 'fingerprint.fingerRightIndex' },
  { value: 'right_middle', labelKey: 'fingerprint.fingerRightMiddle' },
  { value: 'right_ring', labelKey: 'fingerprint.fingerRightRing' },
  { value: 'right_little', labelKey: 'fingerprint.fingerRightLittle' },
  { value: 'left_thumb', labelKey: 'fingerprint.fingerLeftThumb' },
  { value: 'left_index', labelKey: 'fingerprint.fingerLeftIndex' },
  { value: 'left_middle', labelKey: 'fingerprint.fingerLeftMiddle' },
  { value: 'left_ring', labelKey: 'fingerprint.fingerLeftRing' },
  { value: 'left_little', labelKey: 'fingerprint.fingerLeftLittle' },
];

export default function FingerprintCapture({ value, onChange }: FingerprintCaptureProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [consented, setConsented] = useState(false);
  const [finger, setFinger] = useState<FingerPosition>('right_index');
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    setStatus(await getBridgeStatus());
  }, []);

  useEffect(() => {
    if (isFingerprintEnabled()) refreshStatus();
  }, [refreshStatus]);

  const enabled = isFingerprintEnabled();
  const ready = enabled && !!status?.available && !!status?.scannerConnected;

  const handleCapture = async () => {
    setCapturing(true);
    setError('');
    try {
      const result = await captureFingerprint({ finger });
      const capture: CapturedFingerprint = {
        finger,
        template: result.template,
        quality: result.quality,
        format: result.format,
        driver: result.driver,
      };
      // Re-capturing a finger replaces the earlier capture for that finger.
      onChange([...value.filter(c => c.finger !== finger), capture]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fingerprint.captureFailed'));
    } finally {
      setCapturing(false);
    }
  };

  const removeCapture = (f: FingerPosition) => onChange(value.filter(c => c.finger !== f));

  // Consent gates capture AND retention: withdrawing consent discards any
  // templates already captured so stored biometrics always have live consent.
  const handleConsentChange = (checked: boolean) => {
    setConsented(checked);
    if (!checked && value.length > 0) onChange([]);
  };

  return (
    <div className="border-t pt-4" style={{ borderColor: 'var(--border-light)' }}>
      <h4 className="text-sm font-medium mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <ScanLine className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
        {t('fingerprint.sectionTitle')}
      </h4>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('fingerprint.sectionDesc')}
      </p>

      {!enabled ? (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
          <span>{t('fingerprint.featureDisabled')}</span>
        </div>
      ) : !ready ? (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
          <span>{status?.available ? t('fingerprint.scannerDisconnected') : t('fingerprint.bridgeUnavailable')}</span>
          <button type="button" onClick={refreshStatus} className="btn btn-secondary btn-sm ml-auto">
            <RefreshCw className="w-3.5 h-3.5" /> {t('fingerprint.retry')}
          </button>
        </div>
      ) : (
        <>
          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={e => handleConsentChange(e.target.checked)}
              className="mt-0.5"
              style={{ width: 'auto' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {t('fingerprint.consentLabel')}
            </span>
          </label>

          <div className="flex gap-2 items-end flex-wrap">
            <div className="w-44">
              <label htmlFor="fp-finger" className="text-xs">{t('fingerprint.selectFinger')}</label>
              <Select id="fp-finger" value={finger} onChange={e => setFinger(e.target.value as FingerPosition)} disabled={!consented || capturing}>
                {FINGER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              onClick={handleCapture}
              disabled={!consented || capturing}
              className="btn btn-primary btn-sm"
              style={{ opacity: !consented || capturing ? 0.6 : 1 }}
            >
              {capturing ? (
                <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> {t('fingerprint.capturing')}</>
              ) : (
                <><ScanLine className="w-3.5 h-3.5" /> {t('fingerprint.capture')}</>
              )}
            </button>
          </div>

          {error && (
            <p className="text-[11px] mt-2" role="alert" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
          )}

          {value.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {value.map(c => (
                <span
                  key={c.finger}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md"
                  style={{ background: 'rgba(34,197,94,0.10)', color: '#15803d', border: '1px solid rgba(34,197,94,0.25)' }}
                >
                  <Check className="w-3 h-3" />
                  {t(FINGER_OPTIONS.find(o => o.value === c.finger)?.labelKey || c.finger)}
                  <span style={{ opacity: 0.75 }}>{t('fingerprint.qualityShort', { value: c.quality })}</span>
                  <button type="button" onClick={() => removeCapture(c.finger)} title={t('fingerprint.remove')} className="hover:opacity-70">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
