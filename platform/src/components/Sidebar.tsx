'use client';

import { useRef, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
// Clean single-stroke Tailwind Labs Heroicons via the local compatibility shim.
import {
  Settings,
  LogOut,
  Globe,
  X,
  ChevronsLeft,
  ChevronsRight,
  Check,
} from '@/components/icons/lucide';
import { useApp } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import type { NavItem } from '@/lib/permissions';
import { useSidebarBadges } from '@/lib/hooks/useSidebarBadges';
import AvailabilityModal from '@/components/AvailabilityModal';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SUPPORTED_LOCALES } from '@/lib/i18n';

function groupBySection(items: NavItem[]): { section: string | null; items: NavItem[] }[] {
  const groups: { section: string | null; items: NavItem[] }[] = [];
  let current: { section: string | null; items: NavItem[] } | null = null;

  for (const item of items) {
    const sec = item.section || null;
    if (!current || current.section !== sec) {
      current = { section: sec, items: [item] };
      groups.push(current);
    } else {
      current.items.push(item);
    }
  }
  return groups;
}

function uniqueNavItems(items: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const result: NavItem[] = [];
  for (const item of items) {
    const key = item.action ? `${item.action}:${item.href}` : item.href;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, currentUser, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useApp();
  const { t, locale, setLocale } = useTranslation();
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const currentLocaleConfig = SUPPORTED_LOCALES.find(l => l.code === locale);

  // Map nav hrefs to i18n keys — falls back to the original label if no key exists
  const navLabel = (item: NavItem): string => {
    const keyMap: Record<string, string> = {
      '/dashboard': 'nav.dashboard', '/patients': 'nav.patients', '/consultation': 'nav.consultation',
      '/appointments': 'nav.appointments', '/referrals': 'nav.referrals', '/lab': 'nav.lab',
      '/pharmacy': 'nav.pharmacy', '/immunizations': 'nav.immunizations', '/anc': 'nav.anc',
      '/births': 'nav.births', '/deaths': 'nav.deaths', '/surveillance': 'nav.surveillance',
      '/hospitals': 'nav.hospitals', '/reports': 'nav.reports', '/messages': 'nav.messages',
      '/settings': 'nav.settings', '/telehealth': 'nav.telehealth', '/government': 'nav.government',
      '/facility-settings': 'nav.facilitySettings',
    };
    const key = keyMap[item.href];
    if (key) {
      const translated = t(key);
      if (translated !== key) return translated; // translation found
    }
    return item.label; // fallback to original
  };

  const badges = useSidebarBadges();
  const role = currentUser?.role;
  // Anyone can pick the language they read the app in — a nurse who reads Juba
  // Arabic should not have to ask an administrator to be able to use the ward
  // screen. What stays privileged is writing that choice to the organization,
  // which changes the default for every other user at the facility.
  const canSetOrgLocale = role === 'super_admin' || role === 'org_admin' || role === 'government' || role === 'medical_superintendent';
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;
  const navItems = useMemo(() => uniqueNavItems(roleConfig?.navItems || []), [roleConfig?.navItems]);
  const groups = groupBySection(navItems);
  const hasSections = navItems.some(i => i.section);

  // Highlight only the *most specific* matching nav item. Prefix matching keeps
  // a sub-route (e.g. /patients/123) highlighting its parent nav item
  // (/patients), but when a deeper route is itself a nav item — e.g.
  // /payments/plans sitting under /payments — only the deepest match should be
  // active. Without this, both /payments and /payments/plans light up at once.
  const activeHref = navItems
    .map(i => i.href)
    .filter((h): h is string => !!h && (pathname === h || !!pathname?.startsWith(h + '/')))
    .sort((a, b) => b.length - a.length)[0];

  const branding = currentUser?.branding;
  // The top of the sidebar is the product brand. The org/facility identity is
  // shown exactly once in the user card below, so it must not be repeated here.
  const brandName = 'Tamam Healthcare System';
  const brandLogo = branding?.logoUrl;

  const handleNavClick = () => {
    setSidebarOpen(false);
    setShowLangPicker(false);
  };

  const collapsed = sidebarCollapsed;
  const compactItemClass = collapsed ? 'mx-auto w-10 justify-center !px-0' : '';
  const compactFooterClass = collapsed ? 'mx-auto w-10 justify-center !px-0' : 'w-full text-left';

  // Render a single nav entry. Items with an `action` are in-place triggers
  // (e.g. the Schedule tab opens the Add availability modal) rather than route
  // links, so they render as buttons instead of <Link>.
  const renderNavItem = (item: NavItem, collapsed: boolean) => {
    const badgeCount = item.badgeKey ? ((badges as unknown as Record<string, number>)[item.badgeKey] ?? 0) : 0;

    const badgePill = badgeCount > 0 ? (
      <span
        className="ms-auto flex-shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold leading-none"
        style={{
          background: '#F8593E4D',
          color: '#F8593E',
          minWidth: 18,
          height: 18,
          padding: '0 5px',
        }}
      >
        {badgeCount > 99 ? '99+' : badgeCount}
      </span>
    ) : null;

    if (item.action === 'availability') {
      return (
        <button
          key={item.href}
          type="button"
          onClick={() => { handleNavClick(); setShowAvailability(true); }}
          title={collapsed ? navLabel(item) : undefined}
          className={`nav-item w-full text-start ${compactItemClass}`}
        >
          <item.icon className="w-[20px] h-[20px] flex-shrink-0" color="var(--accent-primary)" />
          {!collapsed && <span>{navLabel(item)}</span>}
          {!collapsed && badgePill}
        </button>
      );
    }
    const isActive = !!activeHref && item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={handleNavClick}
        title={collapsed ? navLabel(item) : undefined}
        className={`nav-item ${isActive ? 'nav-item-active' : ''} ${compactItemClass}`}
      >
        <item.icon className="w-[20px] h-[20px] flex-shrink-0" color="var(--accent-primary)" />
        {!collapsed && <span>{navLabel(item)}</span>}
        {!collapsed && badgePill}
      </Link>
    );
  };

  // Drag-to-collapse/expand
  const dragRef = useRef<{ startX: number; startWidth: number; dragging: boolean }>({ startX: 0, startWidth: 220, dragging: false });
  const sidebarRef = useRef<HTMLElement>(null);

  const handleDragStart = useCallback((clientX: number) => {
    dragRef.current = {
      startX: clientX,
      startWidth: collapsed ? 80 : 220,
      dragging: true,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [collapsed]);

  const handleDragMove = useCallback((clientX: number) => {
    if (!dragRef.current.dragging) return;
    const delta = clientX - dragRef.current.startX;
    const newWidth = dragRef.current.startWidth + delta;
    // Threshold: if dragged below 140px, collapse; above 140px, expand
    if (sidebarRef.current) {
      sidebarRef.current.style.transition = 'none';
      sidebarRef.current.style.width = `${Math.max(64, Math.min(280, newWidth))}px`;
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (sidebarRef.current) {
      const currentWidth = sidebarRef.current.getBoundingClientRect().width;
      sidebarRef.current.style.transition = '';
      if (currentWidth < 140) {
        setSidebarCollapsed(true);
        sidebarRef.current.style.width = '';
      } else {
        setSidebarCollapsed(false);
        sidebarRef.current.style.width = '';
      }
    }
  }, [setSidebarCollapsed]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX);
    const onMouseMove = (ev: MouseEvent) => handleDragMove(ev.clientX);
    const onMouseUp = () => {
      handleDragEnd();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [handleDragStart, handleDragMove, handleDragEnd]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleDragStart(e.touches[0].clientX);
    const onTouchMove = (ev: TouchEvent) => handleDragMove(ev.touches[0].clientX);
    const onTouchEnd = () => {
      handleDragEnd();
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
  }, [handleDragStart, handleDragMove, handleDragEnd]);

  const sidebarBody = (collapsed: boolean) => (
    <>
      {/* Logo — pt tuned so the brand row lines up with the body's first row
          (breadcrumb / page header), which sits ~20px from the viewport top. */}
      <div className={`pt-4 pb-4 ${collapsed ? 'px-2' : 'px-4'}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
          {collapsed ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandLogo || '/assets/tamam-icon.svg'}
                alt={brandName}
                className="flex-shrink-0 object-contain"
                style={{ width: 32, height: 32 }}
              />
            </>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandLogo || '/assets/tamamhealth-logo-full.svg'}
                alt={brandName}
                className="flex-1 min-w-0 object-contain object-left"
                style={{ height: 28, width: 'auto', maxWidth: 180 }}
              />
            </>
          )}
          {/* Close button - only on mobile/tablet */}
          {!collapsed && (
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden p-2 rounded-xl transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ background: 'var(--overlay-subtle)' }}
            >
              <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      {/* First section label starts near the top so it aligns with the page's
          first content block (e.g. the "QUICK ACTIONS" heading) in the column. */}
      <nav aria-label="Main navigation" className={`flex-1 overflow-y-auto overflow-x-hidden sidebar-scrollbar ${collapsed ? 'mt-1 px-2' : 'mt-1 px-3'}`}>
        {hasSections ? (
          groups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.section && !collapsed && (
                <p className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
                  {group.section}
                </p>
              )}
              {group.section && collapsed && (
                <div className="w-6 h-px mx-auto my-2" style={{ background: 'var(--border-light)' }} />
              )}
              <div className="space-y-1">
                {group.items.map(item => renderNavItem(item, collapsed))}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-1">
            {navItems.map(item => renderNavItem(item, collapsed))}
          </div>
        )}
      </nav>

      {/* Bottom section */}
      <div className={`pb-2 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
        {/* Collapse toggle - desktop only */}
        <button
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden lg:flex nav-item items-center ${collapsed ? 'mx-auto w-10 justify-center !px-0' : 'w-full text-start'}`}
          style={{ color: 'var(--nav-text)' }}
        >
          {collapsed ? (
            <ChevronsRight className="w-[18px] h-[18px] mx-auto" color="var(--accent-primary)" />
          ) : (
            <>
              <ChevronsLeft className="w-[18px] h-[18px]" color="var(--accent-primary)" />
              <span>Collapse</span>
            </>
          )}
        </button>

        {/* Language picker — available to every signed-in user */}
        <div className="relative">
            <button
              onClick={() => setShowLangPicker(!showLangPicker)}
              title={collapsed ? `Language: ${currentLocaleConfig?.nativeName || 'English'}` : undefined}
              className={`nav-item ${compactFooterClass}`}
              style={{ color: 'var(--nav-text)' }}
            >
              <Globe className="w-[18px] h-[18px]" color="var(--accent-primary)" />
              {!collapsed && (
                <span className="text-[13px] flex-1">{currentLocaleConfig?.nativeName || 'English'}</span>
              )}
            </button>
            {showLangPicker && (
              <div
                className="absolute start-0 bottom-full mb-1 rounded-xl overflow-hidden"
                style={{
                  background: 'var(--bg-card-solid)',
                  border: '1px solid var(--border-medium)',
                  boxShadow: 'var(--card-shadow-lg)',
                  width: collapsed ? '220px' : '100%',
                  zIndex: 100,
                  maxHeight: '320px',
                  overflowY: 'auto',
                }}
              >
                <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Language</p>
                </div>
                {SUPPORTED_LOCALES.map(loc => (
                  <button
                    key={loc.code}
                    onClick={async () => {
                      await setLocale(loc.code);
                      // Administrators additionally set the facility default, so
                      // new users there start in this language. Everyone else's
                      // choice stays local to their own device.
                      if (canSetOrgLocale && currentUser?.orgId) {
                        try {
                          const { updateOrganization } = await import('@/lib/services/organization-service');
                          await updateOrganization(currentUser.orgId, { locale: loc.code });
                        } catch { /* offline — will sync later */ }
                      }
                      setShowLangPicker(false);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-start transition-colors"
                    style={{
                      background: loc.code === locale ? 'var(--accent-light)' : 'transparent',
                      color: loc.code === locale ? 'var(--accent-primary)' : 'var(--text-primary)',
                    }}
                  >
                    <span className="text-sm font-semibold flex-1">{loc.nativeName}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{loc.region || ''}</span>
                    {loc.code === locale && <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />}
                  </button>
                ))}
              </div>
            )}
        </div>

        {roleConfig?.allowedRoutes?.includes('/settings') && (
          <Link
            href="/settings"
            onClick={handleNavClick}
            title={collapsed ? t('nav.settings') : undefined}
            className={`nav-item ${pathname === '/settings' ? 'nav-item-active' : ''} ${compactFooterClass}`}
          >
            <Settings className="w-[18px] h-[18px]" color="var(--accent-primary)" />
            {!collapsed && <span>{t('nav.settings')}</span>}
          </Link>
        )}

        <button
          onClick={() => { setSidebarOpen(false); logout(); }}
          aria-label="Sign Out"
          className={`nav-item ${compactFooterClass}`}
          style={{ color: 'var(--nav-text)' }}
        >
          <LogOut className="w-[18px] h-[18px]" color="var(--accent-primary)" />
          {!collapsed && <span>{t('auth.logout')}</span>}
        </button>
      </div>

    </>
  );

  return (
    <>
      {/* Desktop sidebar — solid floating panel */}
      <aside
        ref={sidebarRef}
        className="hidden lg:flex fixed start-0 top-0 bottom-0 flex-col z-40 transition-all duration-300 ease-in-out"
        style={{
          width: collapsed ? '80px' : '220px',
          margin: '10px 0 10px 10px',
          height: 'calc(100vh - 20px)',
          background: 'var(--glass-bg-strong)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          borderRadius: 18,
          boxShadow: 'var(--panel-shadow), var(--glass-highlight)',
        }}
      >
        {sidebarBody(collapsed)}
        {/* Drag handle on right edge */}
        <div
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          className="absolute end-0 top-0 bottom-0 w-2 cursor-col-resize z-50 group"
          style={{ borderRadius: '0 var(--card-radius) var(--card-radius) 0' }}
        >
          <div
            className="absolute end-0 top-1/2 -translate-y-1/2 w-[3px] h-10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ background: roleConfig?.color || 'var(--accent-primary)' }}
          />
        </div>
      </aside>

      {/* Mobile/Tablet drawer backdrop */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Off-canvas drawer — the full LABELLED sidebar, opened from the TopBar
          hamburger. Slides over the persistent icon rail when you need labels. */}
      <aside
        className={`lg:hidden fixed start-0 top-0 bottom-0 flex flex-col z-50 transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: '280px',
          margin: '10px 0 10px 10px',
          height: 'calc(100vh - 20px)',
          background: 'var(--sidebar-bg)',
          borderRadius: 18,
          borderInlineEnd: 'none',
          boxShadow: sidebarOpen ? '0 4px 32px rgba(1, 86, 151, 0.24)' : 'none',
        }}
      >
        {sidebarBody(false)}
      </aside>

      {/* Add availability — opened from the Schedule nav item */}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} />}
    </>
  );
}
