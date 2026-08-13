'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/context';
import type { PatientDoc } from '@/lib/db-types';
import type { DirectiveType, CareAlertCategory } from '@/data/mock';
import { AlertTriangle, ShieldCheck, Bell, Plus, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import AddAllergyModal from '@/components/patients/AddAllergyModal';
import CareAlertFields from '@/components/patients/CareAlertFields';
import Select from '@/components/Select';

const DIRECTIVE_LABELS: Record<DirectiveType, string> = {
  informed_consent: 'Informed consent',
  abn_noncovered: 'Non-covered service (ABN)',
  privacy_consent: 'Privacy / communication consent',
  advance_directive: 'Advance directive',
  release_of_information: 'Release of information',
  other: 'Other',
};
const DIRECTIVE_OPTIONS = Object.keys(DIRECTIVE_LABELS) as DirectiveType[];

type Which = 'allergy' | 'directive' | 'alert' | null;

const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' } as const;

const triggerClass = 'inline-flex items-center gap-2 px-3.5 rounded-lg text-sm font-semibold transition-colors';
const triggerStyle = { height: 40, background: 'transparent', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' } as const;

export default function ChartSafetyActions({ patient, iconOnly }: { patient: PatientDoc; iconOnly?: boolean }) {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState<Which>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const author = { recordedBy: currentUser?._id, recordedByName: currentUser?.name || currentUser?.username };

  const [directive, setDirective] = useState<{ type: DirectiveType; description: string; startDate: string }>(
    { type: 'informed_consent', description: '', startDate: '' },
  );
  const [alert, setAlert] = useState<{ category: CareAlertCategory; message: string; priority: 'high' | 'normal' }>(
    { category: 'clinical_risk', message: '', priority: 'high' },
  );

  function close() {
    setOpen(null);
    setError(null);
    setDirective({ type: 'informed_consent', description: '', startDate: '' });
    setAlert({ category: 'clinical_risk', message: '', priority: 'high' });
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveDirective() {
    const svc = await import('@/lib/services/directive-service');
    await svc.addDirective(patient._id, { ...directive, ...author });
  }
  async function saveAlert() {
    const svc = await import('@/lib/services/care-alert-service');
    await svc.addCareAlert(patient._id, { ...alert, ...author });
  }

  const titleId = 'chart-safety-action-title';

  const iconBtnStyle = { width: 36, height: 36, flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-secondary)' } as const;

  return (
    <>
      {iconOnly ? (
        <>
          <button onClick={() => setOpen('allergy')} title="Add allergy" aria-label="Add allergy" className="flex items-center justify-center rounded-lg transition-colors hover:opacity-80" style={iconBtnStyle}>
            <AlertTriangle className="w-4 h-4" />
          </button>
          <button onClick={() => setOpen('directive')} title="Add directive" aria-label="Add directive" className="flex items-center justify-center rounded-lg transition-colors hover:opacity-80" style={iconBtnStyle}>
            <ShieldCheck className="w-4 h-4" />
          </button>
          <button onClick={() => setOpen('alert')} title="Add care alert" aria-label="Add care alert" className="flex items-center justify-center rounded-lg transition-colors hover:opacity-80" style={iconBtnStyle}>
            <Bell className="w-4 h-4" />
          </button>
        </>
      ) : (
      <div className="inline-flex items-center gap-2 flex-wrap">
        <button onClick={() => setOpen('allergy')} className={triggerClass} style={triggerStyle}>
          <AlertTriangle className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> Add allergy
        </button>
        <button onClick={() => setOpen('directive')} className={triggerClass} style={triggerStyle}>
          <ShieldCheck className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> Add directive
        </button>
        <button onClick={() => setOpen('alert')} className={triggerClass} style={triggerStyle}>
          <Bell className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> Add alert
        </button>
      </div>
      )}

      {open === 'allergy' && (
        <AddAllergyModal
          onClose={close}
          onSave={async input => {
            const svc = await import('@/lib/services/allergy-service');
            await svc.addAllergy(patient._id, { ...input, ...author });
          }}
        />
      )}

      {(open === 'directive' || open === 'alert') && (
        <Modal onClose={busy ? () => {} : close} width={460} labelledBy={titleId}>
          <div className="card-elevated p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 id={titleId} className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {open === 'directive' && (<><ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Add directive / consent</>)}
                {open === 'alert' && (<><Bell className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Add care alert</>)}
              </h3>
              <button className="btn btn-xs btn-secondary" disabled={busy} onClick={close} aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {open === 'directive' && (
              <div className="space-y-2">
                <Select value={directive.type} onChange={(e) => setDirective({ ...directive, type: e.target.value as DirectiveType })}
                  className="w-full p-2 rounded-md text-[12px]" style={inputStyle}>
                  {DIRECTIVE_OPTIONS.map((t) => <option key={t} value={t}>{DIRECTIVE_LABELS[t]}</option>)}
                </Select>
                <input
                  value={directive.description}
                  onChange={(e) => setDirective({ ...directive, description: e.target.value })}
                  placeholder="Description (e.g. Consent to treat signed)"
                  className="w-full p-2 rounded-md text-[13px]" style={inputStyle} autoFocus
                />
                <div className="flex items-center gap-2 pt-1">
                  <button className="btn btn-sm btn-primary" disabled={busy || directive.description.trim().length === 0} onClick={() => run(saveDirective)}>
                    <Plus className="w-3 h-3" /> Save directive
                  </button>
                  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={close}>Cancel</button>
                </div>
              </div>
            )}

            {open === 'alert' && (
              <div className="space-y-2">
                <CareAlertFields
                  category={alert.category}
                  priority={alert.priority}
                  message={alert.message}
                  onCategoryChange={category => setAlert({ ...alert, category })}
                  onPriorityChange={priority => setAlert({ ...alert, priority })}
                  onMessageChange={message => setAlert({ ...alert, message })}
                  autoFocus
                />
                <div className="flex items-center gap-2 pt-1">
                  <button className="btn btn-sm btn-primary" disabled={busy || alert.message.trim().length === 0} onClick={() => run(saveAlert)}>
                    <Plus className="w-3 h-3" /> Save alert
                  </button>
                  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={close}>Cancel</button>
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
