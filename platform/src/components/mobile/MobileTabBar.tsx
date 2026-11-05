'use client';

import { useRouter } from 'next/navigation';
import { Calendar, LayoutDashboard, MessageSquare, Plus, Users } from '@/components/icons/lucide';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';
import type { MobileShellTab } from '@/lib/mobile-shell/use-mobile-shell-state';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface MobileTabBarProps {
  activeTab: MobileShellTab;
  homeHref: string;
  allowedRoutes: readonly string[];
  onOpenCreate: () => void;
}

export default function MobileTabBar({ activeTab, homeHref, allowedRoutes, onOpenCreate }: MobileTabBarProps) {
  const { t } = useTranslation();
  const router = useRouter();

  const tabs: { key: MobileShellTab; href: string; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'dashboard', href: homeHref, label: 'Dashboard', icon: LayoutDashboard },
    ...(isHrefAllowed('/patients', allowedRoutes) ? [{ key: 'patients' as const, href: '/patients', label: 'Patients', icon: Users }] : []),
  ];
  const trailingTabs: { key: MobileShellTab; href: string; label: string; icon: typeof LayoutDashboard }[] = [
    ...(isHrefAllowed('/appointments', allowedRoutes) ? [{ key: 'calendar' as const, href: '/appointments', label: 'Calendar', icon: Calendar }] : []),
    ...(isHrefAllowed('/messages', allowedRoutes) ? [{ key: 'inbox' as const, href: '/messages', label: 'Inbox', icon: MessageSquare }] : []),
  ];

  const renderTab = (tab: (typeof tabs)[number]) => {
    const Icon = tab.icon;
    const active = activeTab === tab.key;
    return (
      <button
        key={tab.href}
        type="button"
        className={active ? 'active' : ''}
        onClick={() => router.push(tab.href)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="w-5 h-5" />
        {tab.label}
      </button>
    );
  };

  return (
    <nav className="mobile-shell-tabbar" aria-label={t('featureCatalog.capability.primary-navigation')}>
      {tabs.map(renderTab)}
      <button type="button" className="mobile-shell-tabbar-fab" aria-label={t('ui.quickCreate')} onClick={onOpenCreate}>
        <Plus className="w-6 h-6" />
      </button>
      {trailingTabs.map(renderTab)}
    </nav>
  );
}
