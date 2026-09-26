'use client';
import { useEffect, useRef, useState } from 'react';
import './scribe.css';
import Modal from '@/components/Modal';
import { Mic, Square, Shield, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { apiFetch } from '@/lib/api-fetch';
import { getSectionLabel } from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { MAX_AUDIO, MAX_RECORDING_MS, MAX_SOURCE, isScribeSection, type ScribeSuggestion } from '../core/contracts';

export default function ScribePanel({ note, onClose, onApply }: {
  note: ClinicalNoteDoc; onClose: () => void;
  onApply: (revision: string, section: string, suggestion: ScribeSuggestion) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false); const [checked, setChecked] = useState(false);
  const [consent, setConsent] = useState(false); const [source, setSource] = useState('');
  const [section, setSection] = useState(note.sections.find(s => isScribeSection(s.sectionId))?.sectionId || 'subjective');
  const [recording, setRecording] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [reviewed, setReviewed] = useState(false);
  const [suggestion, setSuggestion] = useState<ScribeSuggestion | null>(null);
  const [baseRevision, setBaseRevision] = useState('');
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]); const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null); const mounted = useRef(true); const size = useRef(0);
  const revision = useRef(note._rev);
  const captureGeneration = useRef(0);
  function discardRecording() {
    captureGeneration.current++;
    if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null; recorder.current.onerror = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; recorder.current = null;
    clearTimeout(timeout.current); chunks.current = []; size.current = 0;
  }
  useEffect(() => {
    mounted.current = true;
    const ac = new AbortController();
    void apiFetch('/api/ai-scribe', { signal: ac.signal, cache: 'no-store' }).then(r => r.json()).then(data => {
      if (mounted.current) { setAvailable(data.available === true); setChecked(true); }
    }).catch(() => { if (mounted.current) setChecked(true); });
    const clear = () => { discardRecording(); controller.current?.abort(); controller.current = null; setRecording(false); setBusy(false); setSource(''); setSuggestion(null); setConsent(false); };
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('tamam:session-locked', clear);
    return () => { mounted.current = false; ac.abort(); controller.current?.abort(); discardRecording(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('tamam:session-locked', clear); };
  }, []);
  useEffect(() => { revision.current = note._rev; controller.current?.abort(); controller.current = null; discardRecording(); }, [note._rev]);

  async function request(action: 'generate' | 'transcribe', audio?: Blob) {
    const expected = note._rev || ''; controller.current?.abort(); const ac = new AbortController(); controller.current = ac;
    const deadline = setTimeout(() => { ac.abort(); if (mounted.current && controller.current === ac) setError(t('scribe.failed')); }, 95000);
    setBusy(true); setError(''); setSuggestion(null); setReviewed(false);
    try {
      const form = new FormData(); form.set('noteId', note._id); form.set('revision', expected); form.set('section', section);
      form.set('action', action); form.set('consent', 'confirmed');
      if (audio) form.set('audio', audio, 'recording'); else form.set('source', source);
      const res = await apiFetch('/api/ai-scribe', { method: 'POST', body: form, signal: ac.signal, cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === 'stale_note' ? 'stale' : 'failed');
      if (!mounted.current || ac.signal.aborted || revision.current !== expected) return;
      if (audio) {
        const combined = [source, data.transcript].filter(Boolean).join('\n');
        if (combined.length > MAX_SOURCE) { setError(t('scribe.limit')); return; }
        setSource(combined);
      } else { setSuggestion(data); setBaseRevision(expected); }
    } catch (err) { if (mounted.current && !ac.signal.aborted) setError(t(err instanceof Error && err.message === 'stale' ? 'scribe.stale' : 'scribe.failed')); }
    finally { clearTimeout(deadline); if (mounted.current && controller.current === ac) setBusy(false); }
  }
  async function startRecording() {
    if (!consent || !available || busy || recording) return;
    const generation = ++captureGeneration.current;
    setBusy(true); setError(''); setSuggestion(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error();
      const mime = ['audio/webm;codecs=opus','audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error();
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!mounted.current || document.hidden || captureGeneration.current !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; chunks.current = []; size.current = 0;
      const rec = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: 32000 }); recorder.current = rec;
      rec.ondataavailable = event => {
        size.current += event.data.size;
        if (size.current > MAX_AUDIO) { discardRecording(); setRecording(false); setError(t('scribe.limit')); return; }
        if (event.data.size) chunks.current.push(event.data);
      };
      rec.onerror = () => { discardRecording(); setRecording(false); setError(t('scribe.micError')); };
      rec.onstop = () => {
        const audio = new Blob(chunks.current, { type: mime.includes('mp4') ? 'audio/mp4' : 'audio/webm' });
        discardRecording(); setRecording(false);
        if (mounted.current && audio.size) void request('transcribe', audio);
      };
      rec.start(1000); setRecording(true);
      timeout.current = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, MAX_RECORDING_MS);
    } catch { if (mounted.current && captureGeneration.current === generation) { setError(t('scribe.micError')); setBusy(false); discardRecording(); } }
    finally { if (mounted.current && captureGeneration.current === generation) setBusy(false); }
  }
  return <Modal onClose={onClose} width={980} labelledBy="scribe-title" disableBackdropClose>
    <div className="scribe-panel">
      <header><div><h2 id="scribe-title">{t('scribe.title')}</h2><p>{t('scribe.subtitle')}</p></div><button type="button" onClick={onClose} aria-label={t('scribe.close')}><X size={20}/></button></header>
      <div className="scribe-context"><Shield size={18}/><span>{note.patientName} · {note.mrn || note._id}</span><span>{t('scribe.unsigned')}</span></div>
      <p className="scribe-notice">{t('scribe.privacy')}</p>
      {checked && !available && <p role="status" className="scribe-warning">{t('scribe.unavailable')}</p>}
      <label className="scribe-consent"><input type="checkbox" checked={consent} disabled={busy || recording} onChange={e => setConsent(e.target.checked)}/>{t('scribe.consent')}</label>
      <div className="scribe-columns">
        <section><h3>{t('scribe.source')}</h3><p>{t('scribe.sourceHelp')}</p>
          <div className="scribe-controls"><button className="btn btn-secondary" type="button" disabled={!available || !consent || busy} onClick={() => recording ? recorder.current?.stop() : void startRecording()}>{recording ? <Square size={16}/> : <Mic size={16}/>} {t(recording ? 'scribe.stop' : 'scribe.record')}</button>
            {recording && <span role="status">{t('scribe.recording')}</span>}</div>
          <textarea value={source} maxLength={MAX_SOURCE} disabled={busy || recording} onChange={e => { setSource(e.target.value); setSuggestion(null); setReviewed(false); }} aria-label={t('scribe.source')} />
          <label>{t('scribe.section')}<select value={section} disabled={busy || recording} onChange={e => { setSection(e.target.value as typeof section); setSuggestion(null); setReviewed(false); }}>{note.sections.filter(s => isScribeSection(s.sectionId)).map(s => <option key={s.sectionId} value={s.sectionId}>{getSectionLabel(s.sectionId)}</option>)}</select></label>
          <button type="button" className="btn btn-primary" disabled={!available || !consent || !source.trim() || busy || recording} onClick={() => void request('generate')}>{t(busy ? 'scribe.processing' : 'scribe.generate')}</button>
        </section>
        <section><h3>{t('scribe.review')}</h3><p>{t('scribe.reviewHelp')}</p>
          <textarea aria-label={t('scribe.review')} disabled={!suggestion || busy} value={suggestion?.text || ''} onChange={e => { setSuggestion(s => s ? { ...s, text: e.target.value } : s); setReviewed(false); }} maxLength={12000}/>
          {suggestion && <><details><summary>{t('scribe.evidence')}</summary>{suggestion.evidence.map((quote, i) => <blockquote key={i}>{quote}</blockquote>)}</details><label className="scribe-consent"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>{t('scribe.reviewed')}</label></>}
          <button type="button" className="btn btn-primary" disabled={!suggestion?.text.trim() || !reviewed || busy || baseRevision !== note._rev} onClick={async () => { if (!suggestion) return; setBusy(true); try { if (await onApply(baseRevision, section, suggestion)) onClose(); else setError(t('scribe.stale')); } finally { if (mounted.current) setBusy(false); } }}>{t('scribe.apply')}</button>
        </section>
      </div>
      {error && <p role="alert" className="scribe-warning">{error}</p>}
      <footer><span>{t('scribe.discardHelp')}</span><button type="button" className="btn btn-secondary" onClick={onClose}>{t('scribe.discard')}</button></footer>
    </div>
  </Modal>;
}
