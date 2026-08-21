'use client';

/**
 * PhotoCaptureModal — take a patient photo with the device camera.
 *
 * Centered popup (shared Modal) used from patient registration. Shows a live
 * camera preview, lets staff capture → review → retake, and falls back to a
 * file upload when no camera is available or permission is denied. Returns a
 * downscaled JPEG data URL sized for inline storage on the patient doc.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { Camera, Check, RefreshCw, Upload, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface PhotoCaptureModalProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/** Longest edge of the stored photo — keeps the inline base64 doc small. */
const MAX_EDGE = 640;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export default function PhotoCaptureModal({ onCapture, onClose }: PhotoCaptureModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'starting' | 'live' | 'preview' | 'error'>('starting');
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [error, setError] = useState('');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  // Sets state only after the getUserMedia await, so the mount effect below
  // doesn't trigger a synchronous cascading render.
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase('live');
    } catch {
      stopStream();
      setError(t('photoCapture.cameraUnavailable'));
      setPhase('error');
    }
  }, [stopStream, t]);

  const retake = () => {
    setPhase('starting');
    setError('');
    setSnapshot(null);
    startCamera();
  };

  useEffect(() => {
    startCamera();
    return stopStream;
  }, [startCamera, stopStream]);

  const takeSnapshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshot(canvas.toDataURL('image/jpeg', 0.85));
    stopStream();
    setPhase('preview');
  };

  const usePhoto = () => {
    if (!snapshot) return;
    stopStream();
    onCapture(snapshot);
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('photoCapture.photoTooLarge'));
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      if (result) {
        stopStream();
        onCapture(result);
        onClose();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleClose = () => {
    stopStream();
    onClose();
  };

  return (
    <Modal onClose={handleClose} width={440} labelledBy="photo-capture-title">
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
        {/* Header — same layout as the check-in card popup */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <h3 id="photo-capture-title" className="text-sm font-semibold flex items-center gap-2">
            <Camera className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            {t('photoCapture.title')}
          </h3>
          <button onClick={handleClose} aria-label={t('action.close')} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Camera / preview area */}
          <div
            className="relative w-full overflow-hidden rounded-xl"
            style={{ aspectRatio: '4 / 3', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}
          >
            {phase === 'preview' && snapshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snapshot} alt={t('photoCapture.capturedPhotoAlt')} className="w-full h-full object-cover" />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                // Mirror the live preview so it behaves like a selfie camera;
                // the stored capture keeps the true (unmirrored) orientation.
                style={{ transform: 'scaleX(-1)', display: phase === 'error' ? 'none' : undefined }}
              />
            )}
            {phase === 'starting' && (
              <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('photoCapture.startingCamera')}
              </div>
            )}
            {phase === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <Camera className="w-8 h-8" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{error}</p>
              </div>
            )}
          </div>

          {error && phase !== 'error' && (
            <p className="text-xs" style={{ color: 'var(--danger, #d92b20)' }}>{error}</p>
          )}

          {/* Actions */}
          {phase === 'preview' ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={usePhoto} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                <Check className="w-4 h-4" /> {t('photoCapture.usePhoto')}
              </button>
              <button type="button" onClick={retake} className="btn btn-secondary flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> {t('photoCapture.retake')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={takeSnapshot}
                disabled={phase !== 'live'}
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> {t('photoCapture.capture')}
              </button>
              <label className="btn btn-secondary cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" /> {t('photoCapture.upload')}
                <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={handleFileUpload} />
              </label>
            </div>
          )}

          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('photoCapture.footerGuidance')}
          </p>
        </div>
      </div>
    </Modal>
  );
}
