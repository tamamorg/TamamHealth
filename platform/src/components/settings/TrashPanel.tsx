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
 *   Delete  — permanent. A tenant that owns facilities or staff accounts takes
 *             them with it (the operator is shown the count and types the name
 *             to confirm); a tenant that still holds PATIENTS is refused,
 *             because a chart lives across ~70 databases keyed by patientId
 *             and deleting the patient document would strand it rather than
 *             remove it. Export or transfer the patients first.
 *
 * Layout follows the settings pages this panel sits inside — `ehr-set-section`
 * head with an icon plate, `ehr-set-row` rows on the same 18px inset. It used
 * to draw its own header and rows with no horizontal padding, so its content
 * sat flush against the card border while every other panel was inset.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, RotateCcw, Loader2, AlertTriangle, Building2, Users, HeartPulse } from '@/components/icons/lucide';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatDate } from '@/lib/format-utils';
import type { OrganizationDoc } from '@/lib/db-types';
import { SadbConfirmModal } from '@/components/admin/sadb-ui';

/** What a tenant still holds, so the operator sees it before deleting. */
interface Holdings { hospitalCount: number; userCount: number; patientCount: number }

export default function TrashPanel() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { trashedOrganizations, loading, restore, purge, getStats } = useOrganizations();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<OrganizationDoc | null>(null);
  const [typed, setTyped] = useState('');
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

  /**
   * Whether the operator may delete this tenant, and why not when they can't.
   *
   * `cascade` marks the case where the delete goes through but takes records
   * with it — that is what earns the type-the-name confirmation.
   */
  const deletability = (org: OrganizationDoc): {
    allowed: boolean; cascade: boolean; reason?: string;
  } => {
    const h = holdings[org._id];
    if (!h) return { allowed: false, cascade: false, reason: t('trash.counting') };
    if (h.patientCount > 0) {
      return { allowed: false, cascade: false, reason: t('trash.blockedPatients', { count: h.patientCount }) };
    }
    return { allowed: true, cascade: h.hospitalCount > 0 || h.userCount > 0 };
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

  const openConfirm = (org: OrganizationDoc) => {
    setTyped('');
    setConfirmTarget(org);
  };

  const confirmHoldings = confirmTarget ? holdings[confirmTarget._id] : undefined;
  const confirmCascade = !!confirmHoldings
    && (confirmHoldings.hospitalCount > 0 || confirmHoldings.userCount > 0);
  // Typing the tenant's name is the gate, and only for a delete that destroys
  // records. An organization that owns nothing gets a plain confirm — friction
  // proportional to what is actually lost.
  const nameConfirmed = useMemo(
    () => !confirmCascade || typed.trim().toLowerCase() === (confirmTarget?.name || '').trim().toLowerCase(),
    [confirmCascade, typed, confirmTarget],
  );

  const handlePurge = async () => {
    if (!confirmTarget || !nameConfirmed) return;
    setBusyId(confirmTarget._id);
    try {
      await purge(confirmTarget._id, currentUser?._id, currentUser?.username, { cascade: confirmCascade });
      showToast(t('trash.deleted', { name: confirmTarget.name }), 'success');
      setConfirmTarget(null);
      setTyped('');
    } catch (err) {
      // The server refuses a tenant that still holds patients and says how
      // many; surface that verbatim rather than a generic failure.
      showToast(err instanceof Error ? err.message : t('trash.deleteFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <section className="ehr-set-section">
        <div className="ehr-set-section-head">
          <span><Trash2 /></span>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <h3>{t('trash.title')}</h3>
            <small>{t('trash.intro')}</small>
          </div>
        </div>
        <p className="trash-empty"><Loader2 className="animate-spin" /> {t('trash.loading')}</p>
      </section>
    );
  }

  return (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Trash2 /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>{t('trash.title')}</h3>
          <small>{t('trash.intro')}</small>
        </div>
        {trashedOrganizations.length > 0 && (
          <span className="trash-count">{trashedOrganizations.length}</span>
        )}
      </div>

      {trashedOrganizations.length === 0 ? (
        <p className="trash-empty">{t('trash.empty')}</p>
      ) : (
        trashedOrganizations.map(org => {
          const h = holdings[org._id];
          const { allowed, cascade, reason } = deletability(org);
          return (
            <div key={org._id} className="ehr-set-row trash-row">
              <div className="ehr-set-row-label">
                <b>{org.name}</b>
                <span>
                  {org.slug}
                  {org.updatedAt && ` · ${t('trash.removedOn', { date: formatDate(org.updatedAt) })}`}
                </span>
                <div className="trash-chips">
                  {!h ? (
                    <em className="trash-chip trash-chip--muted">{t('trash.counting')}</em>
                  ) : h.hospitalCount + h.userCount + h.patientCount === 0 ? (
                    <em className="trash-chip trash-chip--muted">{t('trash.holdsNothing')}</em>
                  ) : (
                    <>
                      {h.hospitalCount > 0 && (
                        <em className="trash-chip"><Building2 /> {t('trash.chipFacilities', { count: h.hospitalCount })}</em>
                      )}
                      {h.userCount > 0 && (
                        <em className="trash-chip"><Users /> {t('trash.chipStaff', { count: h.userCount })}</em>
                      )}
                      {h.patientCount > 0 && (
                        <em className="trash-chip trash-chip--block"><HeartPulse /> {t('trash.chipPatients', { count: h.patientCount })}</em>
                      )}
                    </>
                  )}
                </div>
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
                {/* Enabled whenever the delete can actually go through —
                    including the cascade case, where the dialog says what
                    goes with it. Only patients disable it outright. */}
                <button
                  type="button"
                  className="btn btn-sm sadb-btn-danger"
                  disabled={busyId === org._id || !allowed}
                  title={reason}
                  onClick={() => openConfirm(org)}
                >
                  <Trash2 className="w-4 h-4" /> {cascade ? t('trash.deleteWithRecords') : t('trash.delete')}
                </button>
              </div>
            </div>
          );
        })
      )}

      {confirmTarget && (
        <SadbConfirmModal
          title={confirmCascade
            ? t('trash.cascadeTitle', { name: confirmTarget.name })
            : t('trash.confirmTitle', { name: confirmTarget.name })}
          body={confirmCascade
            ? t('trash.cascadeBody', {
              name: confirmTarget.name,
              facilities: confirmHoldings?.hospitalCount ?? 0,
              staff: confirmHoldings?.userCount ?? 0,
            })
            : t('trash.confirmBody', { name: confirmTarget.name })}
          extra={confirmCascade ? (
            <div className="trash-confirm-gate">
              <p className="trash-confirm-hint">{t('trash.typeToConfirm', { name: confirmTarget.name })}</p>
              <input
                className="sadb-modal-input"
                value={typed}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={e => setTyped(e.target.value)}
                aria-label={t('trash.typeToConfirm', { name: confirmTarget.name })}
                placeholder={confirmTarget.name}
              />
            </div>
          ) : undefined}
          confirmLabel={busyId ? t('trash.deleting') : t('trash.delete')}
          cancelLabel={t('common.cancel')}
          confirmDisabled={!nameConfirmed}
          onCancel={() => { setConfirmTarget(null); setTyped(''); }}
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
