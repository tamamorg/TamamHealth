'use client';

/**
 * What a screen looks like while its code and first data are on their way:
 * a title line, a toolbar and list rows, in the shape most screens take, so
 * the page lands where its outline already was instead of jumping in.
 *
 * Shown by `app/(dashboard)/loading.tsx`. It stays invisible for its first
 * ~160 ms, so a fast (prefetched) navigation never flashes it; the progress
 * line under the rail covers that moment.
 */
import { Skeleton, SkeletonRows } from '@/components/overlay/Skeleton';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function RouteLoading() {
  const { t } = useTranslation();
  return (
    <div className="tm-route-loading tm-motion" role="status" aria-busy="true" aria-label={t('common.loading')}>
      <div className="tm-route-loading__head" aria-hidden="true">
        <Skeleton width={220} height={22} variant="block" />
        <Skeleton width={120} height={32} variant="block" />
      </div>
      <div className="tm-route-loading__toolbar" aria-hidden="true">
        <Skeleton width="min(360px, 60%)" height={32} variant="block" />
        <Skeleton width={96} height={32} variant="block" />
      </div>
      <div className="tm-route-loading__list">
        <SkeletonRows rows={7} />
      </div>
    </div>
  );
}
