'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText, Image as ImageIcon, Eye, AlertTriangle } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Attachment } from '@/data/mock';
import { validateAttachment, MAX_FILE_SIZE_BYTES } from '@/lib/validation';

interface FileUploadProps {
  attachments: Attachment[];
  onAdd: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
  uploaderName: string;
  maxFiles?: number;
}

export default function FileUpload({ attachments, onAdd, onRemove, uploaderName, maxFiles = 10 }: FileUploadProps) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    const validation = validateAttachment(file);
    if (!validation.valid) {
      setErrors(prev => [...prev, validation.error!]);
      return;
    }
    if (attachments.length >= maxFiles) {
      setErrors(prev => [...prev, t('fileUpload.maxFilesError', { count: maxFiles })]);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        const attachment: Attachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: base64,
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: uploaderName,
        };
        onAdd(attachment);
      };
      // FileReader surfaces I/O failures via onerror, NOT a thrown exception
      // — a `try` around `readAsDataURL` would silently swallow real read
      // errors. Hook the error event so the user actually sees the failure.
      reader.onerror = () => {
        setErrors(prev => [...prev, t('fileUpload.readError', { name: file.name })]);
      };
      reader.readAsDataURL(file);
    } catch {
      setErrors(prev => [...prev, t('fileUpload.readError', { name: file.name })]);
    }
  }, [attachments.length, maxFiles, onAdd, uploaderName, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setErrors([]);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(processFile);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setErrors([]);
    const files = Array.from(e.target.files || []);
    files.forEach(processFile);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');

  return (
    <div>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('fileUpload.dropPrompt')}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          fileInputRef.current?.click();
        }}
        className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all"
        style={{
          borderColor: dragOver ? 'var(--tamamhealth-blue)' : 'var(--border-light)',
          background: dragOver ? 'rgba(33, 145, 208, 0.08)' : 'var(--overlay-subtle)',
        }}
      >
        <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: dragOver ? 'var(--tamamhealth-blue)' : 'var(--text-muted)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('fileUpload.dropPrompt')}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('fileUpload.constraints', { maxSize: formatSize(MAX_FILE_SIZE_BYTES), used: attachments.length, max: maxFiles })}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.dcm"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mt-3 space-y-1" role="alert" aria-live="assertive">
          {errors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg text-xs" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {err}
              <button type="button" aria-label={t('common.dismissNotification')} onClick={() => setErrors(prev => prev.filter((_, j) => j !== i))} className="ms-auto">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div className="mt-3 space-y-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              {/* Thumbnail / icon */}
              {isImage(att.mimeType) ? (
                <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-black/20">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${att.mimeType};base64,${att.base64Data}`}
                    alt={att.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5" style={{ color: 'var(--color-danger)' }} />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{att.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatSize(att.sizeBytes)} &middot; {att.mimeType}
                </p>
              </div>

              {/* Actions */}
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewAttachment(att); }}
                className="p-1.5 rounded transition-colors flex-shrink-0"
                style={{ background: 'var(--accent-light)' }}
                title={t('fileUpload.preview')}
              >
                <Eye className="w-3.5 h-3.5" style={{ color: 'var(--tamamhealth-blue)' }} />
              </button>
              <button
                type="button"
                aria-label={`${t('fileUpload.remove')}: ${att.name}`}
                onClick={(e) => { e.stopPropagation(); onRemove(att.id); }}
                className="p-1.5 rounded transition-colors flex-shrink-0"
                style={{ background: 'rgba(224, 49, 39,0.12)' }}
                title={t('fileUpload.remove')}
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-8"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-card)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <div className="flex items-center gap-2">
                {isImage(previewAttachment.mimeType) ? <ImageIcon className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} /> : <FileText className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />}
                <span className="text-sm font-semibold">{previewAttachment.name}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatSize(previewAttachment.sizeBytes)}</span>
              </div>
              <button type="button" aria-label={t('common.dismissNotification')} onClick={() => setPreviewAttachment(null)} className="p-1 rounded" style={{ background: 'var(--overlay-subtle)' }}>
                <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
              {isImage(previewAttachment.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${previewAttachment.mimeType};base64,${previewAttachment.base64Data}`}
                  alt={previewAttachment.name}
                  className="max-w-full h-auto rounded"
                />
              ) : previewAttachment.mimeType === 'application/pdf' ? (
                <iframe
                  src={`data:application/pdf;base64,${previewAttachment.base64Data}`}
                  className="w-full rounded"
                  style={{ height: '70vh' }}
                  title={previewAttachment.name}
                />
              ) : (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('referrals.previewNotAvailable')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
