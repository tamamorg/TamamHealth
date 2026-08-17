'use client';

/**
 * Visit note workspace panel — OpenMRS-style quick capture: primary/secondary
 * diagnosis search + a free-text note. Diagnosis search reuses the same
 * CodedSearchField + COMMON_ICD11_CODES pairing as ProblemList's "Add
 * problem" flow.
 *
 * Persists as a clinical-notes-module draft (`ClinicalNoteDoc`), not the old
 * `PatientNoteDoc`: the diagnoses land structured on the SOAP Assessment
 * section and the paragraph becomes its narrative, so a note captured here
 * shows up in the chart's Notes tab, can be opened in the full editor, and
 * goes through the same sign/addendum lifecycle as every other note. The old
 * data layer made this panel's output invisible to the Notes list — a note
 * the author could not find again.
 *
 * The primary action starts a full consultation for this patient: this panel
 * captures a diagnosis and a paragraph, while the encounter itself (vitals,
 * orders, prescriptions, signing) lives in /consultation. Anything typed here
 * is saved as a note first, so opening the consultation never loses the draft.
 */

import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Stethoscope, X } from '@/components/icons/lucide';
import CodedSearchField from '@/components/CodedSearchField';
import { useToast } from '@/components/Toast';
import { toIsoDate } from '@/components/ehr/EhrMiniCalendar';
import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import type { PatientDoc } from '@/lib/db-types';
import type { ChartPanelRouter, ChartPanelUser } from './types';

interface PickedDx { code: string; title: string; chapter: string }

interface VisitNotePanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  router: ChartPanelRouter;
  canConsult: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function VisitNotePanel({ patient, currentUser, router, canConsult, onClose, onSaved }: VisitNotePanelProps) {
  const { showToast } = useToast();
  const icdOptions = useMemo(() => COMMON_ICD11_CODES.map(c => ({ code: c.code, name: c.title, meta: c.chapter, keywords: c.keywords })), []);

  const [primarySearch, setPrimarySearch] = useState('');
  const [primaryDx, setPrimaryDx] = useState<PickedDx | null>(null);
  const [secondarySearch, setSecondarySearch] = useState('');
  const [secondaryDx, setSecondaryDx] = useState<PickedDx | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Images picked for this note — persisted to the patient_documents store on
  // save (same flow the radiology queue uses), so they survive the session and
  // show on the chart's documents/attachments views.
  const [images, setImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — PouchDB doc budget

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1)); // strip data: prefix
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleImagesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file
    const oversized = files.filter(f => f.size > MAX_IMAGE_BYTES);
    if (oversized.length > 0) {
      showToast(`Skipped ${oversized.length} file(s) over 5MB`, 'error');
    }
    setImages(prev => [...prev, ...files.filter(f => f.size <= MAX_IMAGE_BYTES)]);
  };

  if (!canConsult) {
    return (
      <div className="omrs-drawer-body">
        <div className="omrs-panel-permission-note">
          <p>You don&apos;t have permission to add visit notes for this patient.</p>
        </div>
      </div>
    );
  }

  const canSave = !!primaryDx || note.trim().length > 0;

  /** Writes the drafted diagnoses/note/images. Returns how many images failed
   *  to attach; throws if the note itself could not be saved. */
  const persistNote = async (): Promise<number> => {
    {
      const now = new Date();
      // Structured, not prose: the dx cards land on the Assessment section the
      // same way the full editor writes them, so reopening this note there
      // shows editable diagnosis cards rather than a paragraph to re-type.
      const diagnoses = [primaryDx, secondaryDx]
        .filter((dx): dx is PickedDx => !!dx)
        .map((dx, i) => ({
          id: `dx-${now.getTime()}-${i}`,
          name: dx.title,
          icd11Code: dx.code,
          addedAt: now.toISOString(),
        }));
      const lines: string[] = [];
      if (note.trim()) lines.push(note.trim());
      if (images.length > 0) lines.push(`Attached images: ${images.map(f => f.name).join(', ')}`);
      const { createClinicalNote } = await import('@/lib/clinical-notes/note-service');
      const { patientFullName } = await import('@/lib/patient-utils');
      await createClinicalNote({
        patientId: patient._id,
        patientName: patientFullName(patient),
        mrn: patient.hospitalNumber,
        patientDob: patient.dateOfBirth,
        noteType: 'soap',
        serviceDate: toIsoDate(now),
        serviceTime: now.toTimeString().slice(0, 5),
        sections: [{ sectionId: 'assessment', text: lines.join('\n\n'), diagnoses }],
        assignedToId: currentUser?._id,
        assignedToName: currentUser?.name,
        authorId: currentUser?._id || currentUser?.username,
        authorName: currentUser?.name || 'Care team',
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      // Persist picked images to the synced patient_documents store (the same
      // place radiology films land) so they outlive this session.
      let imageFailures = 0;
      if (images.length > 0) {
        const { addPatientDocument } = await import('@/lib/services/patient-document-service');
        for (const file of images) {
          try {
            const base64Data = await fileToBase64(file);
            await addPatientDocument({
              patientId: patient._id,
              title: `Visit note image — ${file.name}`,
              category: 'scanned_record',
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              base64Data,
              sizeBytes: file.size,
              note: 'Attached from a visit note',
              uploadedById: currentUser?._id,
              uploadedByName: currentUser?.name,
              hospitalId: currentUser?.hospitalId,
              orgId: currentUser?.orgId,
            });
          } catch {
            imageFailures++;
          }
        }
      }
      return imageFailures;
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    try {
      setSubmitting(true);
      const imageFailures = await persistNote();
      showToast(imageFailures > 0 ? `Visit note saved — ${imageFailures} image(s) failed to attach` : 'Visit note saved', imageFailures > 0 ? 'error' : 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      showToast('Could not save this note. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Primary action: open a new consultation for this patient. Any draft in the
   * panel is written first — losing a typed diagnosis because the clinician
   * chose the fuller workspace would be the worst possible outcome here. A
   * failed save aborts the navigation so the draft stays on screen.
   */
  const handleStartConsultation = async () => {
    try {
      setSubmitting(true);
      if (canSave) {
        const imageFailures = await persistNote();
        showToast(
          imageFailures > 0
            ? `Note saved (${imageFailures} image(s) failed) — opening consultation`
            : 'Note saved — opening consultation',
          imageFailures > 0 ? 'error' : 'success',
        );
        onSaved?.();
      }
      onClose();
      router.push(`/consultation?patientId=${encodeURIComponent(patient._id)}`);
    } catch (err) {
      console.error(err);
      showToast('Could not save this note, so the consultation was not opened.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="omrs-drawer-body">
        {/* No "For <patient>" line: this drawer only ever opens over the chart
            of the patient it writes to, and the banner behind it already names
            them. */}
        <div className="omrs-panel-field">
          <label className="omrs-panel-label">Primary diagnosis</label>
          {primaryDx ? (
            <div className="omrs-panel-picked-chip">
              <span>{primaryDx.title} <span style={{ color: 'var(--ehr-muted)' }}>· {primaryDx.code}</span></span>
              <button type="button" onClick={() => setPrimaryDx(null)}>Change</button>
            </div>
          ) : (
            <CodedSearchField
              label=""
              placeholder="Search ICD-11 diagnoses…"
              options={icdOptions}
              value={primarySearch}
              onChange={setPrimarySearch}
              onSelect={c => { setPrimaryDx({ code: c.code, title: c.name, chapter: c.meta || '' }); setPrimarySearch(''); }}
            />
          )}
        </div>

        <div className="omrs-panel-field">
          <label className="omrs-panel-label">Secondary diagnosis</label>
          {secondaryDx ? (
            <div className="omrs-panel-picked-chip">
              <span>{secondaryDx.title} <span style={{ color: 'var(--ehr-muted)' }}>· {secondaryDx.code}</span></span>
              <button type="button" onClick={() => setSecondaryDx(null)}>Change</button>
            </div>
          ) : (
            <CodedSearchField
              label=""
              placeholder="Search ICD-11 diagnoses… (optional)"
              options={icdOptions}
              value={secondarySearch}
              onChange={setSecondarySearch}
              onSelect={c => { setSecondaryDx({ code: c.code, title: c.name, chapter: c.meta || '' }); setSecondarySearch(''); }}
              excludeCodes={primaryDx ? [primaryDx.code] : undefined}
            />
          )}
        </div>

        <div className="omrs-panel-field">
          <label className="omrs-panel-label">Note</label>
          <textarea
            className="omrs-panel-textarea"
            placeholder="Assessment, plan, follow-up instructions…"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {images.length > 0 && (
          <div className="omrs-panel-field">
            <label className="omrs-panel-label">Images</label>
            {images.map((file, i) => (
              <div className="omrs-panel-picked-chip" key={`${file.name}-${i}`}>
                <span>{file.name} <span style={{ color: 'var(--ehr-muted)' }}>· {(file.size / 1024).toFixed(0)} KB</span></span>
                <button type="button" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`}>
                  <X size={12} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleImagesChosen}
        />
        <button type="button" className="omrs-panel-add-btn" onClick={() => fileInputRef.current?.click()}>
          <ImageIcon /> Add image
        </button>
      </div>
      <div className="omrs-drawer-footer">
        <button type="button" className="omrs-btn-ghost" onClick={onClose} disabled={submitting}>Discard</button>
        <button type="button" className="omrs-btn-ghost" onClick={handleSave} disabled={!canSave || submitting}>
          {submitting ? 'Saving…' : 'Save note'}
        </button>
        {/* Primary: the note above is the short form — the full encounter
            (vitals, orders, prescriptions, signing) happens in /consultation. */}
        <button type="button" className="omrs-btn-primary" onClick={handleStartConsultation} disabled={submitting}>
          <Stethoscope className="w-3.5 h-3.5" /> Start consultation
        </button>
      </div>
    </>
  );
}
