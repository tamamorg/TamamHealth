'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getRoleConfig } from '@/lib/permissions';
import { uniqueAllowedNavItems, groupNavItemsBySection, navItemLabel } from '@/components/ehr/ehr-navigation';
import MobileBottomSheet from '../MobileBottomSheet';

interface MobileModulesSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileModulesSheet({ open, onClose }: MobileModulesSheetProps) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : undefined;
  const allowedRoutes = useMemo(() => roleConfig?.allowedRoutes || [], [roleConfig]);
  const navItems = useMemo(
    () => uniqueAllowedNavItems(roleConfig?.navItems || [], allowedRoutes),
    [roleConfig, allowedRoutes]
  );
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
