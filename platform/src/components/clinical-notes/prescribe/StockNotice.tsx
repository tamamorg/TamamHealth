'use client';

/**
 * The shelf, said out loud, right under the drug being prescribed.
 *
 * Stock used to be one line on the monograph's third tab, so a prescriber
 * learned a medicine was out only when the patient came back from the
 * pharmacy window. This sits in the form itself and follows the quantity as
 * it is typed: "enough", "running low", "not enough for this prescription",
 * "none". When the pharmacy cannot fill the order it offers the way out —
 * issue the script for an outside pharmacy instead.
 */
import InlineBanner, { type BannerTone } from '@/components/overlay/InlineBanner';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cannotFillOnSite, type StockPosition, type StockState } from '@/lib/pharmacy-stock-position';

const TONE: Partial<Record<StockState, BannerTone>> = {
  low: 'warning',
  short: 'warning',
  not_stocked: 'warning',
  out: 'danger',
  expired: 'danger',
};

export default function StockNotice({ position, facilityName, onIssueOutside }: {
  position: StockPosition;
  facilityName: string;
  /** Offered when the on-site pharmacy cannot fill the order as written. */
  onIssueOutside?: () => void;
}) {
  const { t } = useTranslation();
  const vars = {
    available: position.available,
    requested: position.requested,
    unit: position.unit || t('rxStock.units'),
    reorder: position.reorderLevel,
    facility: facilityName,
  };

  if (position.state === 'ok' || position.state === 'untracked') {
    return (
      <p className="cn-rx-stock cn-rx-stock--quiet" data-stock={position.state}>
        {t(position.state === 'ok' ? 'rxStock.ok' : 'rxStock.untracked', vars)}
      </p>
    );
  }

  return (
    <div className="cn-rx-stock" data-stock={position.state}>
      <InlineBanner
        compact
        tone={TONE[position.state] || 'warning'}
        title={t(`rxStock.${position.state}.title`, vars)}
        action={onIssueOutside && cannotFillOnSite(position)
          ? { label: t('rxStock.issueOutside'), onClick: onIssueOutside }
          : undefined}
      >
        {t(`rxStock.${position.state}.body`, vars)}
      </InlineBanner>
    </div>
  );
}
