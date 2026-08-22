'use client';

/**
 * Trash — deactivated tenants, and the only place they are visible.
 *
 * Deactivating an organization used to leave it in the roster wearing a red
 * chip, which made every count on that page a question about which kind of row
 * it meant: three organizations reporting "2 active, 2 trial, 1 suspended".
 * A tenant you have stopped running is not one of the tenants you are running,
 * so it leaves the consoles entirely and arrives here.
 *
 * Two ways out, and no third:
 *   Restore — puts it back exactly as it was. Deactivation only ever flipped
 *             `isActive`, so the plan, limits, branding and billing status are
 *             all still on the document.
 *   Delete  — permanent, and refused while the tenant still owns facilities,
 *             staff or patients. Deleting the organization does not delete
 *             those; they carry the `orgId` as a plain string and would be
 *             stranded behind a scope match that can never succeed again.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, Loader2, AlertTriangle } from '@/components/icons/lucide';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { OrganizationDoc } from '@/lib/db-types';
import { SadbConfirmModal } from '@/components/admin/sadb-ui';

/** What a tenant still holds, so the operator sees it before deleting. */
interface Holdings { hospitalCount: number; userCount: number; patientCount: number }

export default function TrashPanel() {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { trashedOrganizations, loading, restore, purge, getStats } = useOrganizations();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<OrganizationDoc | null>(null);
  const [holdings, setHoldings] = useState<Record<string, Holdings>>({});

  // What each trashed tenant still owns. Read here rather than at the moment
  // of deletion so the row can say "still holds 3 facilities" BEFORE the
  // operator clicks a permanent action and gets refused.
  const loadHoldings = useCallback(async () => {
    for (const org of trashedOrganizations) {
      try {
        const stats = await getStats(org._id);
        setHoldings(prev => ({
          ...prev,
          [org._id]: {
            hospitalCount: stats.hospitalCount,
            userCount: stats.userCount,
            patientCount: stats.patientCount,
          },
        }));
      } catch {
        // A count that cannot be read is left unknown; the delete itself is
        // still guarded server-side, which is the check that matters.
      }
    }
  }, [trashedOrganizations, getStats]);

  useEffect(() => { loadHoldings(); }, [loadHoldings]);

  const isEmpty = (org: OrganizationDoc): boolean => {
    const h = holdings[org._id];
    return !!h && h.hospitalCount === 0 && h.userCount === 0 && h.patientCount === 0;
  };

  const handleRestore = async (org: OrganizationDoc) => {
    setBusyId(org._id);
    try {
      await restore(org._id, currentUser?._id, currentUser?.username);
      showToast(t('trash.restored', { name: org.name }), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('trash.restoreFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async () => {
    if (!confirmTarget) return;
    setBusyId(confirmTarget._id);
    try {
      await purge(confirmTarget._id, currentUser?._id, currentUser?.username);
      showToast(t('trash.deleted', { name: confirmTarget.name }), 'success');
      setConfirmTarget(null);
    } catch (err) {
      // The server refuses a tenant that still owns records and says what it
      // holds; surface that verbatim rather than a generic failure.
      showToast(err instanceof Error ? err.message : t('trash.deleteFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <section className="ehr-set-section">
        <p className="trash-empty"><Loader2 className="animate-spin" /> {t('trash.loading')}</p>
      </section>
    );
  }

  return (
    <section className="ehr-set-section">
      <header className="trash-head">
        <h3>{t('trash.title')}</h3>
        <p>{t('trash.intro')}</p>
      </header>

      {trashedOrganizations.length === 0 ? (
        <p className="trash-empty">{t('trash.empty')}</p>
      ) : (
        <ul className="trash-list">
          {trashedOrganizations.map(org => {
            const h = holdings[org._id];
            const empty = isEmpty(org);
            return (
              <li key={org._id} className="trash-row">
                <div className="trash-row-main">
                  <b>{org.name}</b>
                  <span>
                    {org.slug}
                    {h && (
                      <>
                        {' · '}
                        {t('trash.holds', {
                          facilities: h.hospitalCount,
                          staff: h.userCount,
                          patients: h.patientCount,
                        })}
                      </>
                    )}
                  </span>
                </div>
                <div className="trash-row-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyId === org._id}
                    onClick={() => handleRestore(org)}
                  >
                    <RotateCcw className="w-4 h-4" /> {t('trash.restore')}
                  </button>
                  {/* Offered only for a tenant that owns nothing. The server
                      refuses the rest anyway; disabling the button here is
                      what stops it reading as an option that failed. */}
                  <button
                    type="button"
                    className="btn btn-sm sadb-btn-danger"
                    disabled={busyId === org._id || !empty}
                    title={empty ? undefined : t('trash.deleteBlocked')}
                    onClick={() => setConfirmTarget(org)}
                  >
                    <Trash2 className="w-4 h-4" /> {t('trash.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmTarget && (
        <SadbConfirmModal
          title={t('trash.confirmTitle', { name: confirmTarget.name })}
          body={t('trash.confirmBody', { name: confirmTarget.name })}
          confirmLabel={busyId ? t('trash.deleting') : t('trash.delete')}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handlePurge}
          busy={busyId === confirmTarget._id}
        />
      )}

      <p className="trash-note">
        <AlertTriangle className="w-4 h-4" /> {t('trash.note')}
      </p>
    </section>
  );
}
