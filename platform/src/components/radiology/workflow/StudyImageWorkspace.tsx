'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ClinicalImageViewer, { type ClinicalImageItem } from '@/components/clinical-images/ClinicalImageViewer';
import { useAuth } from '@/lib/context';
import type { LabResultDoc, PatientDocumentDoc } from '@/lib/db-types';
import { usePatientDocuments } from '@/lib/hooks/usePatientDocuments';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Eye, Image as ImageIcon, Upload } from '@/components/icons/lucide';
import { dismissBackdrop, stopsClickPropagation } from '@/lib/a11y';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function objectUrlFor(document: PatientDocumentDoc): string {
  const binary = atob(document.base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: document.mimeType }));
}

export default function StudyImageWorkspace({ study, canUpload }: { study: LabResultDoc; canUpload: boolean }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { documents, add, addAnnotation, updateAnnotation, deleteAnnotation } = usePatientDocuments(study.patientId);
  const { update: updateStudy } = useLabResults(study.patientId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ClinicalImageItem[]>([]);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studyDocuments = useMemo(() => {
    const linked = new Set(study.studyDocumentIds || []);
    return documents.filter(document =>
      document.mimeType.startsWith('image/') &&
      (linked.has(document._id) || document.note?.includes(`order ${study._id}`)),
    );
  }, [documents, study._id, study.studyDocumentIds]);

  useEffect(() => {
    const urls: string[] = [];
    const next = studyDocuments.map((document): ClinicalImageItem => {
      const src = objectUrlFor(document);
      urls.push(src);
      return { id: document._id, title: document.title, fileName: document.fileName, src, annotations: document.imageAnnotations };
    });
    setImages(next);
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [studyDocuments]);

  const actor = { id: currentUser?._id, name: currentUser?.name || currentUser?.username };

  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error(t('imageViewer.imageFilesOnly'));
        if (file.size > MAX_FILE_BYTES) throw new Error(t('imageViewer.fileTooLarge', { name: file.name }));
        const document = await add({
          patientId: study.patientId,
          title: `${study.testName}: ${file.name}`,
          category: 'radiology',
          fileName: file.name,
          mimeType: file.type,
          base64Data: await fileToBase64(file),
          sizeBytes: file.size,
          note: `Attached to imaging study (order ${study._id})`,
          uploadedById: currentUser?._id,
          uploadedByName: actor.name,
          hospitalId: currentUser?.hospitalId || study.hospitalId,
          orgId: currentUser?.orgId || study.orgId,
        });
        ids.push(document._id);
      }
      const linkedIds = [...new Set([...(study.studyDocumentIds || []), ...ids])];
      await updateStudy(study._id, { studyDocumentIds: linkedIds, imageCount: linkedIds.length });
      setViewerImageId(ids[0] || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('imageViewer.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="labord-section" aria-label={t('imageViewer.studyImages')}>
      <div className="labord-section-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{t('imageViewer.studyImages')} ({images.length})</span>
        {canUpload && (
          <button type="button" className="labord-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4" aria-hidden /> {uploading ? t('imageViewer.uploading') : t('imageViewer.addImages')}
          </button>
        )}
      </div>
      <div className="labord-section-body">
        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={uploadFiles} />
        {images.length ? (
          <div className="flex flex-wrap gap-2">
            {images.map((image, imageIndex) => (
              <button key={image.id} type="button" className="relative overflow-hidden rounded-md" style={{ width: 104, height: 82, padding: 0, background: 'var(--tm-ink)', border: '1px solid var(--border-medium)' }} onClick={() => setViewerImageId(image.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt={image.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 p-1 text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,.7)' }}>
                  <Eye className="w-3 h-3" aria-hidden /> {t('imageViewer.openImage', { number: imageIndex + 1 })}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="labord-help" style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}><ImageIcon className="w-4 h-4" aria-hidden /> {t('imageViewer.noStudyImages')}</p>
        )}
        {error && <p className="labord-required" role="alert" style={{ marginBottom: 0 }}>{error}</p>}
      </div>

      {viewerImageId && (
        <div className="viewport-popup fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.84)' }} {...dismissBackdrop(() => setViewerImageId(null))}>
          <div className="viewport-popup__content" {...stopsClickPropagation}>
            <ClinicalImageViewer
              images={images}
              initialImageId={viewerImageId}
              onClose={() => setViewerImageId(null)}
              onCreateAnnotation={(documentId, input) => addAnnotation(documentId, input, actor)}
              onUpdateAnnotation={(documentId, annotationId, label) => updateAnnotation(documentId, annotationId, label, actor)}
              onDeleteAnnotation={(documentId, annotationId) => deleteAnnotation(documentId, annotationId, actor)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
