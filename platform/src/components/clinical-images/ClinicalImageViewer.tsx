'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClinicalImageAnnotation } from '@/lib/db-types';
import {
  ChevronLeft, ChevronRight, Download, Maximize2, Minus, Pencil, Plus,
  RotateCcw, Sliders, Trash2, X,
} from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import './clinical-image-viewer.css';

export interface ClinicalImageItem {
  id: string;
  title: string;
  fileName: string;
  src: string;
  annotations?: ClinicalImageAnnotation[];
}

export interface ClinicalImageViewerProps {
  images: ClinicalImageItem[];
  initialImageId?: string;
  onClose?: () => void;
  onCreateAnnotation?: (imageId: string, input: { label: string; x: number; y: number }) => Promise<unknown>;
  onUpdateAnnotation?: (imageId: string, annotationId: string, label: string) => Promise<unknown>;
  onDeleteAnnotation?: (imageId: string, annotationId: string) => Promise<unknown>;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export default function ClinicalImageViewer({
  images,
  initialImageId,
  onClose,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: ClinicalImageViewerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === initialImageId)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [inverted, setInverted] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [labelMode, setLabelMode] = useState(false);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const image = images[Math.min(index, Math.max(0, images.length - 1))];
  const annotations = useMemo(
    () => (image?.annotations || []).filter(annotation => annotation.status === 'active'),
    [image],
  );
  const canAnnotate = !!onCreateAnnotation;
  const markerTransform = `translate(-50%, -50%) rotate(${-rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1}) scale(${1 / zoom})`;

  const resetView = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setBrightness(100);
    setContrast(100);
    setInverted(false);
    setPan({ x: 0, y: 0 });
    setLabelMode(false);
    setDraftPoint(null);
    setEditingId(null);
    setError(null);
  }, []);

  const selectIndex = useCallback((next: number) => {
    if (!images.length) return;
    setIndex((next + images.length) % images.length);
    resetView();
  }, [images.length, resetView]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea')) return;
      if (event.key === 'ArrowLeft') selectIndex(index - 1);
      if (event.key === 'ArrowRight') selectIndex(index + 1);
      if (event.key === '+' || event.key === '=') setZoom(value => clampZoom(value + 0.25));
      if (event.key === '-') setZoom(value => clampZoom(value - 0.25));
      if (event.key.toLowerCase() === 'r') setRotation(value => (value + 90) % 360);
      if (event.key.toLowerCase() === 'f') void node.requestFullscreen?.();
      if (event.key === 'Escape') { setLabelMode(false); setDraftPoint(null); }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [index, selectIndex]);

  if (!image) {
    return <div className="civ-empty">{t('imageViewer.noImages')}</div>;
  }

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      setDraftPoint(null);
      setDraftLabel('');
      setEditingId(null);
      setLabelMode(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('imageViewer.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (!draftPoint || !draftLabel.trim() || !onCreateAnnotation) return;
    void run(() => onCreateAnnotation(image.id, { ...draftPoint, label: draftLabel.trim() }));
  };

  const onImageClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!labelMode || !canAnnotate) return;
    event.stopPropagation();
    const target = event.currentTarget;
    const x = Math.min(1, Math.max(0, event.nativeEvent.offsetX / target.clientWidth));
    const y = Math.min(1, Math.max(0, event.nativeEvent.offsetY / target.clientHeight));
    setDraftPoint({ x, y });
    setDraftLabel('');
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await rootRef.current?.requestFullscreen?.();
  };

  return (
    <div ref={rootRef} className={`civ ${fullscreen ? 'civ--fullscreen' : ''}`} tabIndex={0} aria-label={t('imageViewer.workspace')}>
      <header className="civ-header">
        <div className="civ-title-block">
          <strong>{image.title}</strong>
          <span>{t('imageViewer.imageCounter', { current: index + 1, total: images.length })}</span>
        </div>
        <div className="civ-header-actions">
          <a className="civ-icon-button" href={image.src} download={image.fileName} aria-label={t('imageViewer.download')} title={t('imageViewer.download')}>
            <Download aria-hidden />
          </a>
          <button type="button" className="civ-icon-button" onClick={toggleFullscreen} aria-label={t('imageViewer.fullscreen')} title={t('imageViewer.fullscreen')}>
            <Maximize2 aria-hidden />
          </button>
          {onClose && (
            <button type="button" className="civ-icon-button" onClick={onClose} aria-label={t('action.close')} title={t('action.close')}>
              <X aria-hidden />
            </button>
          )}
        </div>
      </header>

      <div className="civ-toolbar" role="toolbar" aria-label={t('imageViewer.tools')}>
        <button type="button" onClick={() => setZoom(value => clampZoom(value - 0.25))} aria-label={t('imageViewer.zoomOut')}><Minus aria-hidden /></button>
        <span className="civ-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(value => clampZoom(value + 0.25))} aria-label={t('imageViewer.zoomIn')}><Plus aria-hidden /></button>
        <span className="civ-tool-separator" />
        <button type="button" onClick={() => setRotation(value => (value - 90 + 360) % 360)} aria-label={t('imageViewer.rotateLeft')}><RotateCcw aria-hidden /></button>
        <button type="button" onClick={() => setRotation(value => (value + 90) % 360)} aria-label={t('imageViewer.rotateRight')} className="civ-rotate-right"><RotateCcw aria-hidden /></button>
        <button type="button" className={flipX ? 'is-active' : ''} onClick={() => setFlipX(value => !value)} aria-pressed={flipX}>{t('imageViewer.flipHorizontal')}</button>
        <button type="button" className={flipY ? 'is-active' : ''} onClick={() => setFlipY(value => !value)} aria-pressed={flipY}>{t('imageViewer.flipVertical')}</button>
        <button type="button" className={inverted ? 'is-active' : ''} onClick={() => setInverted(value => !value)} aria-pressed={inverted}>{t('imageViewer.invert')}</button>
        <span className="civ-tool-separator" />
        <label className="civ-slider"><Sliders aria-hidden /><span>{t('imageViewer.brightness')}</span><input type="range" min="25" max="200" value={brightness} onChange={event => setBrightness(Number(event.target.value))} /></label>
        <label className="civ-slider"><span>{t('imageViewer.contrast')}</span><input type="range" min="25" max="200" value={contrast} onChange={event => setContrast(Number(event.target.value))} /></label>
        {canAnnotate && (
          <button type="button" className={labelMode ? 'is-active' : ''} onClick={() => { setLabelMode(value => !value); setDraftPoint(null); }} aria-pressed={labelMode}>
            <Pencil aria-hidden /> {t('imageViewer.addLabel')}
          </button>
        )}
        <button type="button" onClick={resetView}>{t('imageViewer.reset')}</button>
      </div>

      <div className="civ-body">
        <div
          className={`civ-stage ${labelMode ? 'is-labeling' : ''}`}
          onWheel={event => {
            event.preventDefault();
            if (event.shiftKey && images.length > 1) selectIndex(index + (event.deltaY < 0 ? -1 : 1));
            else setZoom(value => clampZoom(value + (event.deltaY < 0 ? 0.15 : -0.15)));
          }}
          onPointerDown={event => {
            if (labelMode) return;
            dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const drag = dragRef.current;
            if (!drag) return;
            setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <div
            className="civ-image-transform"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})` }}
          >
            {/* Native image rendering preserves locally-created blob URLs and works offline. */}
            {/* The click places an annotation at the exact point pressed on the
                study — a coordinate a key press cannot express. Annotating
                from the keyboard needs a different affordance, not a keydown
                on the image. */}
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/click-events-have-key-events */}
            <img
              src={image.src}
              alt={image.title}
              draggable={false}
              onClick={onImageClick}
              style={{ filter: `brightness(${brightness}%) contrast(${contrast}%) invert(${inverted ? 1 : 0})` }}
            />
            {annotations.map((annotation, annotationIndex) => (
              <button
                key={annotation.id}
                type="button"
                className="civ-marker"
                style={{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, transform: markerTransform }}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); setEditingId(annotation.id); setDraftLabel(annotation.label); setDraftPoint(null); }}
                aria-label={`${annotationIndex + 1}. ${annotation.label}`}
              >
                {annotationIndex + 1}
              </button>
            ))}
            {draftPoint && <span className="civ-marker civ-marker--draft" style={{ left: `${draftPoint.x * 100}%`, top: `${draftPoint.y * 100}%`, transform: markerTransform }}>+</span>}
          </div>
        </div>

        <aside className="civ-annotations" aria-label={t('imageViewer.labels')}>
          <div className="civ-aside-head"><strong>{t('imageViewer.labels')}</strong><span>{annotations.length}</span></div>
          {labelMode && !draftPoint && <p className="civ-help">{t('imageViewer.clickToLabel')}</p>}
          {draftPoint && (
            <div className="civ-editor">
              <label htmlFor="civ-new-label">{t('imageViewer.labelText')}</label>
              <input id="civ-new-label" autoFocus maxLength={160} value={draftLabel} onChange={event => setDraftLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveDraft(); }} />
              <div><button type="button" onClick={() => setDraftPoint(null)}>{t('action.cancel')}</button><button type="button" className="is-primary" disabled={busy || !draftLabel.trim()} onClick={saveDraft}>{t('action.save')}</button></div>
            </div>
          )}
          {annotations.length === 0 && !draftPoint && <p className="civ-help">{t('imageViewer.noLabels')}</p>}
          <ol className="civ-label-list">
            {annotations.map((annotation, annotationIndex) => (
              <li key={annotation.id}>
                <span>{annotationIndex + 1}</span>
                {editingId === annotation.id ? (
                  <div className="civ-editor civ-editor--inline">
                    <input autoFocus maxLength={160} value={draftLabel} onChange={event => setDraftLabel(event.target.value)} />
                    <div>
                      <button type="button" onClick={() => setEditingId(null)}>{t('action.cancel')}</button>
                      <button type="button" className="is-primary" disabled={busy || !draftLabel.trim()} onClick={() => onUpdateAnnotation && void run(() => onUpdateAnnotation(image.id, annotation.id, draftLabel.trim()))}>{t('action.save')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p><strong>{annotation.label}</strong><small>{annotation.createdByName || t('imageViewer.clinicalStaff')}</small></p>
                    <button type="button" onClick={() => { setEditingId(annotation.id); setDraftLabel(annotation.label); }} aria-label={t('imageViewer.editLabel')}><Pencil aria-hidden /></button>
                    {onDeleteAnnotation && <button type="button" onClick={() => void run(() => onDeleteAnnotation(image.id, annotation.id))} aria-label={t('imageViewer.deleteLabel')}><Trash2 aria-hidden /></button>}
                  </>
                )}
              </li>
            ))}
          </ol>
          {error && <p className="civ-error" role="alert">{error}</p>}
        </aside>
      </div>

      {images.length > 1 && (
        <footer className="civ-filmstrip">
          <button type="button" onClick={() => selectIndex(index - 1)} aria-label={t('imageViewer.previousImage')}><ChevronLeft aria-hidden /></button>
          <div>
            {images.map((candidate, candidateIndex) => (
              <button key={candidate.id} type="button" className={candidateIndex === index ? 'is-active' : ''} onClick={() => selectIndex(candidateIndex)} aria-label={candidate.title}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={candidate.src} alt="" /><span>{candidateIndex + 1}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => selectIndex(index + 1)} aria-label={t('imageViewer.nextImage')}><ChevronRight aria-hidden /></button>
        </footer>
      )}
    </div>
  );
}
