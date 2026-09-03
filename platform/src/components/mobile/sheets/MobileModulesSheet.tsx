'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getRoleConfig } from '@/lib/permissions';
import { uniqueAllowedNavItems, groupNavItemsBySection, isHrefAllowed, navItemLabel } from '@/components/ehr/ehr-navigation';
import MobileBottomSheet from '../MobileBottomSheet';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { getDisabledAppRoutes, isAppDisabled, subscribeDisabledApps } from '@/lib/settings/disabled-apps';
import { applyFeatureCatalogToNavigation } from '@/modules/feature-catalog/client';

interface MobileModulesSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileModulesSheet({ open, onClose }: MobileModulesSheetProps) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const { config: platformConfig } = usePlatformConfig();
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : undefined;
  const allowedRoutes = useMemo(() => roleConfig?.allowedRoutes || [], [roleConfig]);
  const disabledRoutes = useSyncExternalStore(subscribeDisabledApps, getDisabledAppRoutes, getDisabledAppRoutes);
  const navItems = useMemo(() => {
    const authorized = uniqueAllowedNavItems(roleConfig?.navItems || [], allowedRoutes)
      .filter(item => !isAppDisabled(item.href, disabledRoutes));
    return applyFeatureCatalogToNavigation(
      authorized,
      platformConfig?.featureCatalog,
      href => isHrefAllowed(href, allowedRoutes),
    );
  }, [roleConfig, allowedRoutes, disabledRoutes, platformConfig?.featureCatalog]);
  const groups = useMemo(() => groupNavItemsBySection(navItems), [navItems]);

  return (
    <MobileBottomSheet open={open} onClose={onClose} title="All modules" subtitle={roleConfig?.badgeLabel}>
      {groups.map((group, i) => (
        <div key={`${group.section || 'main'}-${i}`} className="mobile-sheet-section">
          {group.section && <small className="mobile-sheet-section-label">{group.section}</small>}
          <div className="mobile-sheet-grid mobile-sheet-grid-3">
            {group.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.href}
                  type="button"
                  className="mobile-sheet-module-item"
                  onClick={() => {
                    onClose();
                    router.push(item.href);
                  }}
                >
                  <span className="mobile-sheet-grid-icon"><ItemIcon className="w-4 h-4" /></span>
                  {navItemLabel(item, t)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </MobileBottomSheet>
  );
}
