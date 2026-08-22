'use client';

/**
 * Importing a facility's staff list in one go.
 *
 * Two steps, and the first one is the point: paste or upload, see EXACTLY
 * which rows will become accounts and which will not and why, then commit. A
 * one-shot importer that reports its failures afterwards is how a go-live ends
 * with a hundred and ninety-two of two hundred people and nobody noticing
 * until somebody cannot sign in.
 *
 * The commit step returns a per-row result including, for anyone with no email
 * address, the temporary password to hand over. That list is shown once and is
 * downloadable as a CSV, because a facility administrator standing in front of
 * forty people needs it on paper.
 */

import { useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import Modal from '@/components/Modal';
import { Check, Loader2, Upload } from '@/components/icons/lucide';
import { IMPORT_TEMPLATE_CSV, type ImportRow } from '@/lib/bulk-user-import';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ImportOutcome {
  line: number;
  name: string;
  username?: string;
  temporaryPassword?: string;
  invited: boolean;
  error?: string;
}

export default function BulkUserImportModal({
  onClose,
  onImported,
  orgId,
  orgName,
}: {
  onClose: () => void;
  /** Fired once accounts exist, so the caller can reload its roster. */
  onImported: () => void;
  /**
   * Which organization the accounts belong to.
   *
   * An org_admin has exactly one and the server uses it whatever this says. A
   * platform operator has none of their own, so they have to have chosen one —
   * the roster's organization filter is that choice, and without it the dialog
   * refuses rather than guessing which tenant gets two hundred staff.
   */
  orgId?: string;
  orgName?: string;
}) {
  const { t } = useTranslation();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportRow[] | null>(null);
  const [results, setResults] = useState<ImportOutcome[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async (dryRun: boolean) => {
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch('/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun, orgId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || t('bui.errRead')); return null; }
      return body;
    } catch {
      setError(t('bui.errNetwork'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const body = await post(true);
    if (body?.rows) setPreview(body.rows as ImportRow[]);
  };

  const commit = async () => {
    const body = await post(false);
    if (body?.results) {
      setResults(body.results as ImportOutcome[]);
      setPreview(null);
      onImported();
    }
  };

  const download = (filename: string, text: string) => {
    // A data URL rather than a Blob URL: this runs inside an app that may be
    // offline, and the file is a few kilobytes of text.
    const link = document.createElement('a');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
    link.download = filename;
    link.click();
  };

  const readyCount = preview?.filter(r => !r.problem).length ?? 0;
  const blockedCount = preview?.filter(r => r.problem).length ?? 0;

  return (
    <Modal onClose={onClose} width={720} labelledBy="bulk-import-title">
      <div className="sadb-modal bui">
        <div className="sadb-modal-copy">
          <h2 id="bulk-import-title" className="sadb-modal-title">{t('bui.title')}</h2>
          <p className="sadb-modal-sub">
            {t('bui.ledePre')} <strong>{t('bui.colName')}</strong> {t('bui.ledeAnd')}{' '}
            <strong>{t('bui.colRole')}</strong>{t('bui.ledePost')}
          </p>
          {orgName && <p className="sadb-modal-sub"><strong>Importing into {orgName}.</strong></p>}
        </div>

        {!orgId ? (
          <>
            <p className="bui-error" role="alert">
              Choose an organization in the list filter first — imported accounts have to belong
              to one, and picking a tenant on your behalf is not something this should do.
            </p>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
            </div>
          </>
        ) : results ? (
          <>
            <p className="bui-summary">
              <Check className="w-4 h-4" />
              {results.filter(r => r.username).length === 1
                ? t('bui.createdOne')
                : t('bui.created', { count: results.filter(r => r.username).length })}
              {results.some(r => r.error)
                && t('bui.notCreated', { count: results.filter(r => r.error).length })}.
            </p>
            <div className="bui-scroll">
              <table className="bui-table">
                <thead>
                  <tr><th>{t('bui.colRow')}</th><th>{t('bui.colName')}</th><th>{t('bui.colUsername')}</th><th>{t('bui.colOutcome')}</th></tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.line} className={r.error ? 'is-bad' : undefined}>
                      <td>{r.line}</td>
                      <td>{r.name}</td>
                      <td><code>{r.username ?? '—'}</code></td>
                      <td>
                        {r.error
                          ? r.error
                          : r.invited
                            ? t('bui.invitationEmailed')
                            : <>{t('bui.temporaryPassword')} <code>{r.temporaryPassword}</code></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sadb-modal-actions">
              {results.some(r => r.temporaryPassword) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => download('tamamhealth-credentials.csv', [
                    t('bui.csvHeader'),
                    ...results.filter(r => r.temporaryPassword)
                      .map(r => `${r.name},${r.username},${r.temporaryPassword}`),
                  ].join('\n'))}
                >
                  {t('bui.downloadPasswords')}
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{t('bui.done')}</button>
            </div>
          </>
        ) : (
          <>
            <label className="bui-field">
              <span>{t('bui.pasteOrChoose')}</span>
              <textarea
                rows={8}
                value={csv}
                onChange={e => { setCsv(e.target.value); setPreview(null); }}
                placeholder={IMPORT_TEMPLATE_CSV}
                spellCheck={false}
              />
            </label>

            <div className="bui-filerow">
              <label className="btn btn-secondary btn-sm bui-filebtn">
                <Upload className="w-4 h-4" /> {t('bui.chooseFile')}
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setCsv(await file.text());
                    setPreview(null);
                  }}
                />
              </label>
              <button
                type="button"
                className="bui-link"
                onClick={() => download('tamamhealth-staff-template.csv', IMPORT_TEMPLATE_CSV)}
              >
                {t('bui.downloadTemplate')}
              </button>
            </div>

            {error && <p className="bui-error" role="alert">{error}</p>}

            {preview && (
              <>
                <p className="bui-summary">
                  {t('bui.readyToCreate', { count: readyCount })}
                  {blockedCount > 0 && t('bui.blocked', { count: blockedCount })}.
                </p>
                <div className="bui-scroll">
                  <table className="bui-table">
                    <thead>
                      <tr><th>{t('bui.colRow')}</th><th>{t('bui.colName')}</th><th>{t('bui.colUsername')}</th><th>{t('bui.colRole')}</th><th>{t('bui.colFacility')}</th><th>{t('bui.colStatus')}</th></tr>
                    </thead>
                    <tbody>
                      {preview.map(r => (
                        <tr key={r.line} className={r.problem ? 'is-bad' : undefined}>
                          <td>{r.line}</td>
                          <td>{r.name || '—'}</td>
                          <td><code>{r.username || '—'}</code></td>
                          <td>{r.role || '—'}</td>
                          <td>{r.facilityName || '—'}</td>
                          <td>{r.problem ?? t('bui.ready')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>
                {t('bui.cancel')}
              </button>
              {!preview ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={check} disabled={busy || !csv.trim()}>
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('bui.checking')}</> : t('bui.checkList')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={commit} disabled={busy || readyCount === 0}>
                  {busy
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('bui.creating')}</>
                    : readyCount === 1 ? t('bui.createAccountOne') : t('bui.createAccounts', { count: readyCount })}
                </button>
              )}
            </div>
          </>
        )}

        <style jsx>{`
          .bui { display: flex; flex-direction: column; gap: 14px; }
          .bui-field { display: flex; flex-direction: column; gap: 5px; }
          /* The global bare-label rule uppercases every <label>; opt out here
             rather than fighting its specificity. */
          .bui-field span {
            font-size: 12px; font-weight: 600; letter-spacing: 0;
            text-transform: none; color: var(--text-muted);
          }
          .bui-field textarea {
            width: 100%; padding: 10px 12px; border-radius: 6px;
            border: 1px solid var(--border-light); background: var(--overlay-subtle);
            color: var(--text-primary); outline: none; resize: vertical;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
          }
          .bui-filerow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
          .bui-filebtn { position: relative; overflow: hidden; cursor: pointer; }
          .bui-filebtn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
          .bui-link {
            appearance: none; background: none; border: none; padding: 0;
            font-size: 12.5px; font-weight: 600; color: var(--accent-text); cursor: pointer;
          }
          .bui-summary {
            margin: 0; display: flex; align-items: center; gap: 6px;
            font-size: 13.5px; color: var(--text-primary);
          }
          .bui-scroll { max-height: 260px; overflow: auto; border: 1px solid var(--border-light); border-radius: 8px; }
          .bui-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
          .bui-table th, .bui-table td {
            text-align: start; padding: 7px 10px; border-bottom: 1px solid var(--border-light);
            vertical-align: top; color: var(--text-secondary);
          }
          .bui-table thead th {
            position: sticky; top: 0; background: var(--bg-card-solid);
            color: var(--text-muted); font-weight: 600;
            text-transform: uppercase; letter-spacing: 0.06em; font-size: 10.5px;
          }
          .bui-table tr.is-bad td { color: var(--color-danger-text); }
          .bui-error { margin: 0; font-size: 13px; color: var(--color-danger-text); }
        `}</style>
      </div>
    </Modal>
  );
}
