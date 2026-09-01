'use client';

/**
 * Care Coordination — send this visit to another provider as a referral with a
 * Summary of Care attached.
 *
 * The Summary of Care is mandatory but its contents are selectable: the sender
 * decides which problems and social history travel with the referral. That is a
 * minimum-necessary decision, not a formality — a referral for a fracture does
 * not need the patient's HIV status to travel with it.
 *
 * Transport honesty: this platform has no Direct Messaging or eFax gateway. The
 * choice is recorded on the referral as the requested channel and the referral
 * itself is created in the system, so the receiving provider sees it in their
 * queue. Nothing here claims to have transmitted over a network that is not
 * connected.
 */

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Printer, Download, Send, X } from '@/components/icons/lucide';
import { stripTemplateMarkers } from '@/lib/clinical-notes/section-templates';
import { getSectionLabel } from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { buildClinicalPrintDocument } from '@/lib/print-document';

export interface SummaryProblem {
  effectiveDate: string;
  problem: string;
  status: string;
}

export interface SummarySocialHistory {
  comment: string;
  description: string;
}

export interface CareCoordinationResult {
  channel: 'direct_message' | 'efax';
  recipient: string;
  instructions: string;
  problems: SummaryProblem[];
  socialHistory: SummarySocialHistory[];
}

interface CareCoordinationModalProps {
  note: ClinicalNoteDoc;
  problems: SummaryProblem[];
  socialHistory: SummarySocialHistory[];
  onSend: (result: CareCoordinationResult) => Promise<void> | void;
  onClose: () => void;
}

export default function CareCoordinationModal({
  note, problems, socialHistory, onSend, onClose,
}: CareCoordinationModalProps) {
  const { showToast } = useToast();
  const [channel, setChannel] = useState<'direct_message' | 'efax'>('direct_message');
  const [recipient, setRecipient] = useState('');
  const [instructions, setInstructions] = useState('');
  const [includeProblems, setIncludeProblems] = useState(true);
  const [includeSocial, setIncludeSocial] = useState(true);
  const [includeInstructions, setIncludeInstructions] = useState(true);
  const [pickedProblems, setPickedProblems] = useState<Set<number>>(
    () => new Set(problems.map((_, i) => i)),
  );
  const [pickedSocial, setPickedSocial] = useState<Set<number>>(
    () => new Set(socialHistory.map((_, i) => i)),
  );
  const [sending, setSending] = useState(false);

  const summaryText = useMemo(() => {
    const lines: string[] = [
      `SUMMARY OF CARE — ${note.patientName}`,
      note.mrn ? `MRN: ${note.mrn}` : '',
      `Date of service: ${note.serviceDate}${note.serviceTime ? ` ${note.serviceTime}` : ''}`,
      '',
    ];
    for (const section of note.sections) {
      const body = stripTemplateMarkers(section.text || '').trim() || (section.snapshot || '').trim();
      if (!body) continue;
      lines.push(getSectionLabel(section.sectionId).toUpperCase(), body, '');
    }
    if (includeProblems && pickedProblems.size > 0) {
      lines.push('PROBLEMS');
      problems.forEach((p, i) => {
        if (pickedProblems.has(i)) lines.push(`  ${p.effectiveDate}  ${p.problem}  (${p.status})`);
      });
      lines.push('');
    }
    if (includeSocial && pickedSocial.size > 0) {
      lines.push('SOCIAL HISTORY');
      socialHistory.forEach((s, i) => {
        if (pickedSocial.has(i)) lines.push(`  ${s.comment}  ${s.description}`);
      });
      lines.push('');
    }
    if (includeInstructions && instructions.trim()) {
      lines.push('INSTRUCTIONS', instructions.trim(), '');
    }
    return lines.filter(l => l !== undefined).join('\n');
  }, [note, problems, socialHistory, pickedProblems, pickedSocial,
    includeProblems, includeSocial, includeInstructions, instructions]);

  const toggle = (set: Set<number>, apply: (s: Set<number>) => void, index: number) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index); else next.add(index);
    apply(next);
  };

  const handleDownload = () => {
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summary-of-care-${note.patientName.replace(/\s+/g, '-').toLowerCase()}-${note.serviceDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const noteSections = note.sections.flatMap(section => {
      const text = stripTemplateMarkers(section.text || '').trim() || (section.snapshot || '').trim();
      return text ? [`<section class="section"><h2 class="section-title">${escapeHtml(getSectionLabel(section.sectionId))}</h2><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p></section>`] : [];
    }).join('');
    const selectedProblems = problems.filter((_, index) => includeProblems && pickedProblems.has(index));
    const selectedSocial = socialHistory.filter((_, index) => includeSocial && pickedSocial.has(index));
    const body = `${noteSections}
      ${selectedProblems.length ? `<section class="section"><h2 class="section-title">Problems</h2><table><thead><tr><th>Effective date</th><th>Problem</th><th>Status</th></tr></thead><tbody>${selectedProblems.map(problem => `<tr><td>${escapeHtml(problem.effectiveDate || '—')}</td><td>${escapeHtml(problem.problem)}</td><td><span class="status">${escapeHtml(problem.status)}</span></td></tr>`).join('')}</tbody></table></section>` : ''}
      ${selectedSocial.length ? `<section class="section"><h2 class="section-title">Social history</h2><table><thead><tr><th>Context</th><th>Description</th></tr></thead><tbody>${selectedSocial.map(item => `<tr><td>${escapeHtml(item.comment || '—')}</td><td>${escapeHtml(item.description)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      ${includeInstructions && instructions.trim() ? `<section class="section"><h2 class="section-title">Referral instructions</h2><p class="notice">${escapeHtml(instructions.trim()).replace(/\n/g, '<br>')}</p></section>` : ''}`;
    const html = buildClinicalPrintDocument({
      title: note.patientName,
      documentLabel: 'Summary of care',
      facilityName: note.hospitalName,
      meta: [
        { label: 'MRN', value: note.mrn || '—' },
        { label: 'Date of service', value: `${note.serviceDate}${note.serviceTime ? ` ${note.serviceTime}` : ''}` },
        { label: 'Author', value: note.authorName || note.signedByName || '—' },
        { label: 'Recipient', value: recipient.trim() || 'Not yet assigned' },
      ],
      safeBodyHtml: body || '<p class="notice">No clinical content was selected for this summary.</p>',
      footer: 'Summary of care prepared for continuity of treatment. Contains selected minimum-necessary information.',
    });
    openIsolatedHtmlWindow(html, '', true);
  };

  const handleSend = async () => {
    if (!recipient.trim()) {
      showToast('Name the provider or facility receiving this referral.', 'error');
      return;
    }
    setSending(true);
    try {
      await onSend({
        channel,
        recipient: recipient.trim(),
        instructions: instructions.trim(),
        problems: problems.filter((_, i) => includeProblems && pickedProblems.has(i)),
        socialHistory: socialHistory.filter((_, i) => includeSocial && pickedSocial.has(i)),
      });
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send the referral.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} width={780} align="top">
      <div style={{ padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, flex: 1 }}>
            Send Referral for {note.patientName}
          </h2>
          <button type="button" className="cn-tool" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="cn-field" style={{ marginBottom: 16 }}>
          <span className="cn-label">Send via</span>
          <div className="cn-segmented">
            <button
              type="button"
              aria-pressed={channel === 'direct_message'}
              onClick={() => setChannel('direct_message')}
            >
              Direct Message
            </button>
            <button
              type="button"
              aria-pressed={channel === 'efax'}
              onClick={() => setChannel('efax')}
            >
              eFax
            </button>
          </div>
        </div>

        <div className="cn-field" style={{ marginBottom: 16, display: 'flex', width: '100%' }}>
          <span className="cn-label" style={{ minWidth: 96 }}>
            {channel === 'efax' ? 'Fax number' : 'Recipient'}
          </span>
          <input
            className="cn-input"
            style={{ flex: 1 }}
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder={channel === 'efax' ? '+211…' : 'Provider or facility'}
          />
        </div>

        <label className="cn-tree-option" style={{ marginBottom: 4 }}>
          <input type="checkbox" checked disabled readOnly />
          <span style={{ fontWeight: 700 }}>Summary of Care (mandatory)</span>
        </label>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted, #5d728b)', margin: '0 0 14px 26px' }}>
          Attaching the Summary of Care is mandatory, but you choose which information travels with it.
        </p>

        {problems.length > 0 && (
          <div className="cn-coord-section">
            <label className="cn-tree-option">
              <input
                type="checkbox"
                checked={includeProblems}
                onChange={e => setIncludeProblems(e.target.checked)}
              />
              <span style={{ fontWeight: 700 }}>Problems</span>
            </label>
            {includeProblems && (
              <table className="cn-coord-table">
                <thead>
                  <tr><th /><th>Effective Dates</th><th>Problem</th><th>Problem Status</th></tr>
                </thead>
                <tbody>
                  {problems.map((p, i) => (
                    <tr key={`${p.problem}-${i}`}>
                      <td style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={pickedProblems.has(i)}
                          onChange={() => toggle(pickedProblems, setPickedProblems, i)}
                          aria-label={`Include ${p.problem}`}
                        />
                      </td>
                      <td>{p.effectiveDate}</td>
                      <td>{p.problem}</td>
                      <td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {socialHistory.length > 0 && (
          <div className="cn-coord-section">
            <label className="cn-tree-option">
              <input
                type="checkbox"
                checked={includeSocial}
                onChange={e => setIncludeSocial(e.target.checked)}
              />
              <span style={{ fontWeight: 700 }}>Social History</span>
            </label>
            {includeSocial && (
              <table className="cn-coord-table">
                <thead>
                  <tr><th /><th>Comments</th><th>Description</th></tr>
                </thead>
                <tbody>
                  {socialHistory.map((s, i) => (
                    <tr key={`${s.description}-${i}`}>
                      <td style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={pickedSocial.has(i)}
                          onChange={() => toggle(pickedSocial, setPickedSocial, i)}
                          aria-label={`Include ${s.description}`}
                        />
                      </td>
                      <td>{s.comment}</td>
                      <td>{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="cn-coord-section">
          <label className="cn-tree-option">
            <input
              type="checkbox"
              checked={includeInstructions}
              onChange={e => setIncludeInstructions(e.target.checked)}
            />
            <span style={{ fontWeight: 700 }}>Instructions</span>
          </label>
          {includeInstructions && (
            <textarea
              className="cn-textarea"
              style={{ minHeight: 64 }}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="What you would like the receiving provider to do…"
              aria-label="Referral instructions"
            />
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #5d728b)', margin: '4px 0 14px' }}>
          This platform has no Direct Messaging or eFax gateway connected. The referral is created
          here with your chosen channel recorded on it, so the receiving provider sees it in their
          referral queue.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="cn-btn" onClick={handlePrint}>
            <Printer size={14} /> Preview/Print
          </button>
          <button type="button" className="cn-btn" onClick={handleDownload}>
            <Download size={14} /> Download
          </button>
          <div className="cn-footer-spacer" />
          <button type="button" className="cn-btn" onClick={onClose}>Close</button>
          <button
            type="button"
            className="cn-btn cn-btn-primary"
            onClick={handleSend}
            disabled={sending}
          >
            <Send size={14} /> {sending ? 'Sending…' : channel === 'efax' ? 'Send Fax' : 'Send Message'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
