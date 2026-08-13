'use client';

import { useState } from 'react';
import {
  Mic, Square, Play, Pause, RotateCcw,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  Clipboard, Sparkles, Thermometer, Pill, FlaskConical,
  Stethoscope, FileText, Calendar, Keyboard, X,
  AlertCircle, Heart,
} from '@/components/icons/lucide';
import { useClinicalScribe } from '@/lib/hooks/useClinicalScribe';
import type { ScribeExtraction } from '@/lib/services/clinical-scribe-service';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ClinicalScribeProps {
  onApply: (extraction: ScribeExtraction) => void;
  onClose: () => void;
}

type PreviewTab = 'transcript' | 'fields' | 'soap';

export default function ClinicalScribe({ onApply, onClose }: ClinicalScribeProps) {
  const { t } = useTranslation();
  const scribe = useClinicalScribe();
  const [activeTab, setActiveTab] = useState<PreviewTab>('transcript');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualText, setManualText] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['vitals', 'complaint', 'medications', 'diagnoses']));

  const toggleSection = (s: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleFinalize = () => {
    if (scribe.status === 'recording' || scribe.status === 'paused') {
      scribe.stopRecording();
    }
    scribe.processTranscript();
  };

  const handleManualProcess = () => {
    if (!manualText.trim()) return;
    scribe.setManualTranscript(manualText);
    scribe.processTranscript(manualText);
    setShowManualInput(false);
  };

  const handleApply = () => {
    if (scribe.extraction) {
      onApply(scribe.extraction);
    }
  };

  const hasContent = scribe.transcript.trim().length > 0;
  const isRecording = scribe.status === 'recording';
  const isPaused = scribe.status === 'paused';
  const isDone = scribe.status === 'done';

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
            background: 'transparent',
          }}>
            {isRecording ? (
              <Mic className="w-4 h-4 animate-pulse" style={{ color: 'var(--color-danger)' }} />
            ) : (
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {t('scribe.title')}
            </h3>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {isRecording ? t('scribe.statusListening') : isPaused ? t('scribe.statusPaused') : isDone ? t('scribe.statusReviewApply') : t('scribe.statusReady')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(isRecording || isPaused) && (
            <span className="text-xs font-mono font-bold px-2 py-1 rounded" style={{
              background: isRecording ? 'rgba(229,46,66,0.12)' : 'var(--overlay-subtle)',
              color: isRecording ? 'var(--color-danger-text)' : 'var(--text-secondary)',
            }}>
              {isRecording && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse" style={{ background: 'var(--color-danger)' }} />}
              {formatDuration(scribe.duration)}
            </span>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-light)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Recording Controls */}
      <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}>
        {scribe.status === 'idle' && !isDone && (
          <>
            {scribe.isSupported ? (
              <button onClick={scribe.startRecording} className="btn btn-primary btn-sm flex-1">
                <Mic className="w-4 h-4" /> {t('scribe.startRecording')}
              </button>
            ) : (
              <button onClick={() => setShowManualInput(true)} className="btn btn-primary btn-sm flex-1">
                <Keyboard className="w-4 h-4" /> {t('scribe.enterTranscript')}
              </button>
            )}
            <button onClick={() => setShowManualInput(!showManualInput)} className="btn btn-secondary btn-sm" title={t('scribe.manualTranscriptEntry')}>
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {isRecording && (
          <>
            <button onClick={scribe.pauseRecording} className="btn btn-secondary btn-sm">
              <Pause className="w-4 h-4" /> {t('scribe.pause')}
            </button>
            <button onClick={handleFinalize} className="btn btn-primary btn-sm flex-1">
              <Square className="w-4 h-4" /> {t('scribe.stopAndProcess')}
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button onClick={scribe.resumeRecording} className="btn btn-secondary btn-sm">
              <Play className="w-4 h-4" /> {t('scribe.resume')}
            </button>
            <button onClick={handleFinalize} className="btn btn-primary btn-sm flex-1">
              <CheckCircle2 className="w-4 h-4" /> {t('scribe.finalizeNote')}
            </button>
          </>
        )}

        {scribe.status === 'processing' && (
          <div className="flex items-center gap-2 flex-1 justify-center py-1">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" style={{ color: 'var(--accent-primary)' }} />
            </svg>
            <span className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>{t('scribe.extractingData')}</span>
          </div>
        )}

        {isDone && (
          <>
            <button onClick={handleApply} className="btn btn-primary btn-sm flex-1">
              <CheckCircle2 className="w-4 h-4" /> {t('scribe.applyToConsultation')}
            </button>
            <button onClick={scribe.reset} className="btn btn-secondary btn-sm" title={t('scribe.startOver')}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {hasContent && scribe.status === 'idle' && !isDone && (
          <button onClick={() => scribe.processTranscript()} className="btn btn-primary btn-sm">
            <Sparkles className="w-3.5 h-3.5" /> {t('scribe.process')}
          </button>
        )}
      </div>

      {/* Manual Input */}
      {showManualInput && (
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <label className="text-[10px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
            {t('scribe.manualInputLabel')}
          </label>
          <textarea
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            rows={6}
            placeholder={t('scribe.manualInputPlaceholder')}
            className="text-xs mb-2"
            style={{ fontSize: '0.8rem', lineHeight: '1.5' }}
          />
          <div className="flex gap-2">
            <button onClick={handleManualProcess} disabled={!manualText.trim()} className="btn btn-primary btn-sm flex-1">
              <Sparkles className="w-3.5 h-3.5" /> {t('scribe.processTranscript')}
            </button>
            <button onClick={() => setShowManualInput(false)} className="btn btn-secondary btn-sm">
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {scribe.error && (
        <div className="mx-4 mt-3 p-2.5 rounded-lg flex items-start gap-2" style={{
          background: 'rgba(229,46,66,0.08)', border: '1px solid rgba(229,46,66,0.2)',
        }}>
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
          <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{scribe.error}</p>
        </div>
      )}

      {/* Tabs */}
      {(hasContent || isDone) && (
        <div className="flex border-b" style={{ borderColor: 'var(--border-light)' }}>
          {(['transcript', 'fields', 'soap'] as PreviewTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative ${activeTab === tab ? 'tab-active' : ''}`}
              style={{ color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-muted)' }}
            >
              {tab === 'transcript' ? t('scribe.tabTranscript') : tab === 'fields' ? t('scribe.tabExtractedFields') : t('scribe.tabSoapNote')}
            </button>
          ))}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Transcript Tab */}
        {activeTab === 'transcript' && (
          <div className="p-4">
            {scribe.transcript ? (
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {scribe.transcript}
                {scribe.interimText && (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {scribe.interimText}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <Mic className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.2 }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {scribe.isSupported
                    ? t('scribe.emptyStartHint')
                    : t('scribe.emptyUnsupportedHint')}
                </p>
                <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                  {t('scribe.localProcessingNote')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Extracted Fields Tab */}
        {activeTab === 'fields' && scribe.extraction && (
          <div className="p-3 space-y-2">
            <FieldSection
              icon={Clipboard} label={t('scribe.sectionChiefComplaint')} color="var(--accent-primary)"
              expanded={expandedSections.has('complaint')}
              onToggle={() => toggleSection('complaint')}
              empty={!scribe.extraction.chiefComplaint}
            >
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {scribe.extraction.chiefComplaint || t('scribe.notDetected')}
              </p>
            </FieldSection>

            <FieldSection
              icon={Thermometer} label={t('scribe.sectionVitals')} color="var(--accent-primary)"
              expanded={expandedSections.has('vitals')}
              onToggle={() => toggleSection('vitals')}
              empty={!Object.values(scribe.extraction.vitals).some(v => v)}
              count={Object.values(scribe.extraction.vitals).filter(v => v).length}
            >
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['temperature', t('scribe.vitalTemp'), '°C'],
                  ['systolic', t('scribe.vitalSystolic'), 'mmHg'],
                  ['diastolic', t('scribe.vitalDiastolic'), 'mmHg'],
                  ['pulse', t('scribe.vitalPulse'), 'bpm'],
                  ['respRate', t('scribe.vitalRespRate'), '/min'],
                  ['o2Sat', t('scribe.vitalSpo2'), '%'],
                  ['weight', t('scribe.vitalWeight'), 'kg'],
                  ['height', t('scribe.vitalHeight'), 'cm'],
                  ['muac', t('scribe.vitalMuac'), 'cm'],
                ] as const).map(([key, label, unit]) => {
                  const val = scribe.extraction!.vitals[key];
                  return val ? (
                    <div key={key} className="p-2 rounded-lg" style={{ background: 'rgba(92,184,168,0.08)', border: '1px solid rgba(92,184,168,0.15)' }}>
                      <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-muted)' }}>{label}</p>
                      <p className="text-sm font-bold" style={{ color: 'var(--accent-primary)' }}>{val} <span className="text-[10px] font-normal">{unit}</span></p>
                    </div>
                  ) : null;
                })}
              </div>
            </FieldSection>

            <FieldSection
              icon={Stethoscope} label={t('scribe.sectionExamFindings')} color="#A855F7"
              expanded={expandedSections.has('exam')}
              onToggle={() => toggleSection('exam')}
              empty={scribe.extraction.examFindings.length === 0}
              count={scribe.extraction.examFindings.length}
            >
              <div className="space-y-1.5">
                {scribe.extraction.examFindings.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[9px] uppercase tracking-wider font-bold w-20 flex-shrink-0 pt-0.5" style={{ color: 'var(--accent-primary)' }}>
                      {f.system}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{f.finding}</span>
                  </div>
                ))}
              </div>
            </FieldSection>

            <FieldSection
              icon={AlertTriangle} label={t('scribe.sectionDiagnoses')} color="var(--color-warning-text)"
              expanded={expandedSections.has('diagnoses')}
              onToggle={() => toggleSection('diagnoses')}
              empty={scribe.extraction.diagnoses.length === 0}
              count={scribe.extraction.diagnoses.length}
            >
              <div className="space-y-1.5">
                {scribe.extraction.diagnoses.map((dx, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    {dx.icd10Hint && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(228,168,75,0.12)', color: 'var(--color-warning-text)' }}>
                        {dx.icd10Hint}
                      </span>
                    )}
                    <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{dx.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{
                      background: dx.certainty === 'confirmed' ? 'rgba(33, 145, 208, 0.12)' : 'rgba(252,211,77,0.12)',
                      color: dx.certainty === 'confirmed' ? 'var(--accent-primary)' : 'var(--color-warning-text)',
                    }}>{dx.certainty}</span>
                  </div>
                ))}
              </div>
            </FieldSection>

            <FieldSection
              icon={Pill} label={t('scribe.sectionMedications')} color="#EC4899"
              expanded={expandedSections.has('medications')}
              onToggle={() => toggleSection('medications')}
              empty={scribe.extraction.medications.length === 0}
              count={scribe.extraction.medications.length}
            >
              <div className="space-y-1.5">
                {scribe.extraction.medications.map((med, i) => (
                  <div key={i} className="p-2 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>{med.name}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {[med.dose, med.frequency, med.route, med.duration].filter(Boolean).join(' · ') || t('scribe.detailsNotCaptured')}
                    </p>
                  </div>
                ))}
              </div>
            </FieldSection>

            <FieldSection
              icon={Heart} label={t('scribe.sectionAllergies')} color="var(--color-danger-text)"
              expanded={expandedSections.has('allergies')}
              onToggle={() => toggleSection('allergies')}
              empty={scribe.extraction.allergies.length === 0}
              count={scribe.extraction.allergies.length}
            >
              <div className="flex flex-wrap gap-1.5">
                {scribe.extraction.allergies.map((a, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full" style={{
                    background: 'rgba(229,46,66,0.12)', color: 'var(--color-danger-text)', border: '1px solid rgba(229,46,66,0.2)',
                  }}>
                    {a.allergen}{a.reaction ? ` → ${a.reaction}` : ''}
                  </span>
                ))}
              </div>
            </FieldSection>

            <FieldSection
              icon={FlaskConical} label={t('scribe.sectionLabOrders')} color="#369FDA"
              expanded={expandedSections.has('labs')}
              onToggle={() => toggleSection('labs')}
              empty={scribe.extraction.labOrders.length === 0}
              count={scribe.extraction.labOrders.length}
            >
              <div className="flex flex-wrap gap-1.5">
                {scribe.extraction.labOrders.map((lab, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-lg font-medium" style={{
                    background: 'rgba(6,182,212,0.10)', color: 'var(--accent-primary)', border: '1px solid rgba(6,182,212,0.2)',
                  }}>
                    {lab}
                  </span>
                ))}
              </div>
            </FieldSection>

            <FieldSection
              icon={FileText} label={t('scribe.sectionTreatmentPlan')} color="var(--accent-primary)"
              expanded={expandedSections.has('plan')}
              onToggle={() => toggleSection('plan')}
              empty={scribe.extraction.treatmentPlan.length === 0}
            >
              <ul className="space-y-1">
                {scribe.extraction.treatmentPlan.map((p, i) => (
                  <li key={i} className="text-xs flex gap-1.5" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--accent-primary)' }}>•</span> {p}
                  </li>
                ))}
              </ul>
            </FieldSection>

            <FieldSection
              icon={Calendar} label={t('scribe.sectionFollowUp')} color="#8B5CF6"
              expanded={expandedSections.has('followup')}
              onToggle={() => toggleSection('followup')}
              empty={!scribe.extraction.followUp}
            >
              <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                {scribe.extraction.followUp || t('scribe.notDiscussed')}
              </p>
            </FieldSection>

            {/* Conflicts */}
            {scribe.extraction.conflicts.length > 0 && (
              <div className="p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-warning-text)' }}>{t('scribe.conflictsHeader')}</span>
                </div>
                {scribe.extraction.conflicts.map((c, i) => (
                  <p key={i} className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    <strong>{c.field}:</strong> {t('scribe.conflictLine', { earlier: c.earlier, latest: c.latest })}
                  </p>
                ))}
              </div>
            )}

            {/* Uncertain items */}
            {scribe.extraction.uncertainItems.length > 0 && (
              <div className="p-3 rounded-lg" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>{t('scribe.itemsToConfirm')}</span>
                </div>
                {scribe.extraction.uncertainItems.map((u, i) => (
                  <p key={i} className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{u}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'fields' && !scribe.extraction && (
          <div className="p-8 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.2 }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('scribe.fieldsEmptyHint')}
            </p>
          </div>
        )}

        {/* SOAP Note Tab */}
        {activeTab === 'soap' && (
          <div className="p-4">
            {scribe.soapNote ? (
              <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{
                color: 'var(--text-primary)',
                fontFamily: "var(--font-platform-mono)",
              }}>
                {scribe.soapNote}
              </pre>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.2 }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('scribe.soapEmptyHint')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom: Apply Action */}
      {isDone && scribe.extraction && (
        <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
              {t('scribe.fieldsAutoPopulated', { count: countExtracted(scribe.extraction) })}
            </span>
          </div>
          <button onClick={handleApply} className="btn btn-primary w-full">
            <CheckCircle2 className="w-4 h-4" /> {t('scribe.applyAllFields')}
          </button>
          <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
            {t('scribe.reviewBeforeSaving')}
          </p>
        </div>
      )}
    </div>
  );
}

// ===== Sub-components =====

function FieldSection({ icon: Icon, label, color, expanded, onToggle, empty, count, children }: {
  icon: typeof Clipboard;
  label: string;
  color: string;
  expanded: boolean;
  onToggle: () => void;
  empty: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: `1px solid ${empty ? 'var(--border-light)' : color + '25'}`,
      background: empty ? 'var(--overlay-subtle)' : `${color}08`,
    }}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" style={{ color: empty ? 'var(--text-muted)' : color }} />
          <span className="text-xs font-semibold" style={{ color: empty ? 'var(--text-muted)' : 'var(--text-primary)' }}>
            {label}
          </span>
          {count !== undefined && count > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
              {count}
            </span>
          )}
          {empty && (
            <span className="text-[9px] italic" style={{ color: 'var(--text-muted)' }}>{t('scribe.notDetected')}</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />}
      </button>
      {expanded && !empty && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

function countExtracted(e: ScribeExtraction): number {
  let count = 0;
  if (e.chiefComplaint) count++;
  if (Object.values(e.vitals).some(v => v)) count++;
  if (e.examFindings.length > 0) count++;
  if (e.diagnoses.length > 0) count++;
  if (e.medications.length > 0) count++;
  if (e.allergies.length > 0) count++;
  if (e.labOrders.length > 0) count++;
  if (e.treatmentPlan.length > 0) count++;
  if (e.followUp) count++;
  if (e.pastMedicalHistory.length > 0) count++;
  return count;
}
