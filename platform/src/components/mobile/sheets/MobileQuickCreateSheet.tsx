'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { uniqueAllowedNavItems, getPrimaryShortcutItems } from '@/components/ehr/ehr-navigation';
import MobileBottomSheet from '../MobileBottomSheet';

interface MobileQuickCreateSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function MobileQuickCreateSheet({ open, onClose }: MobileQuickCreateSheetProps) {
  const { currentUser } = useAuth();
  const router = useRouter();
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : undefined;
  const allowedRoutes = useMemo(() => roleConfig?.allowedRoutes || [], [roleConfig]);
  const navItems = useMemo(
    () => uniqueAllowedNavItems(roleConfig?.navItems || [], allowedRoutes),
    [roleConfig, allowedRoutes]
  );
  // Same rule as the top rail: "quick create" is for work destinations, and the
  // role's own dashboard is always one tap away on the mobile tab bar — so it
  // only fills a slot here as a last resort.
  const shortcuts = useMemo(
    () => getPrimaryShortcutItems(navItems, currentUser?.role, 4, roleConfig?.defaultDashboard),
    [navItems, currentUser?.role, roleConfig?.defaultDashboard],
  );

  return (
    <MobileBottomSheet open={open} onClose={onClose} title="Quick create">
      <div className="mobile-sheet-grid">
        {shortcuts.map((item) => {
          const ItemIcon = item.icon;
          return (
            <button
              key={item.href}
              type="button"
              className="mobile-sheet-grid-item"
              onClick={() => {
                onClose();
                router.push(item.href);
              }}
            >
              <span className="mobile-sheet-grid-icon"><ItemIcon className="w-4 h-4" /></span>
              <span>
                <b>{item.label}</b>
              </span>
            </button>
          );
        })}
      </div>
    </MobileBottomSheet>
  );
}
