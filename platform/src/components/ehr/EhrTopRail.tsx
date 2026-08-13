'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Calendar,
  ChevronDown,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  UserPlus,
  Users,
  X,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTourContext } from '@/lib/tour/tour-context';
import { getRoleConfig } from '@/lib/permissions';
import { usePermissions } from '@/lib/hooks/usePermissions';
import type { NavItem } from '@/lib/permissions';
import { usePatients } from '@/lib/hooks/usePatients';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { patientFullName, patientGenderAge, initials } from '@/lib/patient-utils';
import { formatPhoneDisplay } from '@/lib/field-formats';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrModuleMenu from './EhrModuleMenu';
import EhrTopActions from './EhrTopActions';
import EhrRailMenu from './EhrRailMenu';
import QuickActions from '@/components/QuickActions';
import { buildPeopleNavEntries, isPeopleEntryActive, isPeopleSectionActive } from '@/lib/people-nav';
import {
  activeNavItem,
  getPrimaryShortcutItems,
  groupNavItemsBySection,
  isHrefAllowed,
  uniqueAllowedNavItems,
} from './ehr-navigation';
import { moduleBadgeCounts } from '@/lib/module-badges';

export default function EhrTopRail() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { currentUser, logout } = useAuth();
  // Facility name for the header chip. Sessions restored via /api/auth/me
  // before hospitalName was added to the token won't carry it — fall back to
  // resolving the name from the local hospitals store by id.
  const { hospitals } = useHospitals();
  const facilityName = currentUser?.hospitalName
    || (currentUser?.hospitalId ? hospitals.find(h => h._id === currentUser.hospitalId)?.name : undefined);
  // National oversight (Ministry of Health) isn't tied to a single facility —
  // show the ministry name in the rail's center and give it the header search,
  // so the National Dashboard page doesn't need its own title + search row.
  const isNationalRole = currentUser?.role === 'government';
  const centerLabel = facilityName || (isNationalRole ? 'Ministry of Health' : undefined);
  const { canRegisterPatients } = usePermissions();
  const { available: tourAvailable, start: startTour } = useTourContext();
  const { patients } = usePatients();
  const { items: notifications, unreadCount } = useNotifications();
  const moduleBadges = useMemo(() => moduleBadgeCounts(notifications), [notifications]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open && !moduleOpen && !userOpen) return;
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
      if (moduleRef.current && !moduleRef.current.contains(event.target as Node)) {
        setModuleOpen(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setUserOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, moduleOpen, userOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    searchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;
  const allowedRoutes = useMemo(() => roleConfig?.allowedRoutes || [], [roleConfig]);
  const homeHref = roleConfig?.defaultDashboard || '/dashboard';
  const roleLabel = roleConfig?.label || currentUser?.role.replace(/_/g, ' ') || 'Workspace';
  const canSearchPatients = isHrefAllowed('/patients', allowedRoutes);

  const navItems = useMemo(() => {
    if (!currentUser) return [];
    return uniqueAllowedNavItems(roleConfig?.navItems || [], allowedRoutes);
  }, [allowedRoutes, currentUser, roleConfig]);

  // Keep four high-frequency destinations visible in the header. They are
  // removed from the module menu so each destination has one visible home.
  const headerShortcutItems = useMemo(
    () => getPrimaryShortcutItems(navItems, currentUser?.role, 4),
    [navItems, currentUser?.role],
  );
  const headerShortcutHrefs = useMemo(
    () => new Set(headerShortcutItems.map(item => item.href)),
    [headerShortcutItems],
  );
  const navGroups = useMemo(
    () => groupNavItemsBySection(navItems.filter(item => !headerShortcutHrefs.has(item.href))),
    [headerShortcutHrefs, navItems],
  );

  // People & HR — a LABELLED dropdown, unlike the icon-only module trigger.
  // Renders only for roles that can open at least one of its destinations, so
  // it disappears for clinical roles rather than showing dead rows.
  const peopleEntries = useMemo(
    () => (currentUser ? buildPeopleNavEntries({ role: currentUser.role, allowedRoutes }) : []),
    [currentUser, allowedRoutes],
  );
  // Query string drives which HR tab is marked current; usePathname drops it.
  const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
  const peopleMenuItems = useMemo(
    () => peopleEntries.map(entry => ({
      key: entry.key,
      label: entry.label,
      icon: entry.icon,
      description: entry.description,
      section: entry.section,
      active: isPeopleEntryActive(entry, pathname || '', currentSearch),
      onSelect: () => router.push(entry.href),
    })),
    [peopleEntries, pathname, currentSearch, router],
  );

  const navLabel = (item: NavItem): string => {
    const keyMap: Record<string, string> = {
      '/dashboard': 'nav.dashboard',
      '/patients': 'nav.patients',
      '/consultation': 'nav.consultation',
      '/appointments': 'nav.appointments',
      '/referrals': 'nav.referrals',
      '/lab': 'nav.lab',
      '/pharmacy': 'nav.pharmacy',
      '/immunizations': 'nav.immunizations',
      '/anc': 'nav.anc',
      '/births': 'nav.births',
      '/deaths': 'nav.deaths',
      '/surveillance': 'nav.surveillance',
      '/hospitals': 'nav.hospitals',
      '/reports': 'nav.reports',
      '/messages': 'nav.messages',
      '/settings': 'nav.settings',
      '/telehealth': 'nav.telehealth',
      '/government': 'nav.government',
      '/facility-settings': 'nav.facilitySettings',
      '/patient-intake': 'nav.patientIntake',
      '/payments': 'nav.payments',
      '/payments/claims': 'nav.claims',
      '/wards': 'nav.wards',
      '/blood-bank': 'nav.bloodBank',
    };
    const key = item.href ? keyMap[item.href] : undefined;
    if (key) {
      const translated = t(key);
      if (translated !== key) return translated;
    }
    return item.label;
  };

  // Resolved once, then handed to the dropdown and the shortcut row, so all
  // three surfaces name the same module instead of each matching on its own.
  const activeModuleItem = useMemo(() => activeNavItem(navItems, pathname), [navItems, pathname]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return patients
      .filter(patient => {
        const haystack = `${patientFullName(patient)} ${patient.hospitalNumber || ''} ${patient.phone || ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, 6);
  }, [patients, query]);

  const clearSearch = () => {
    setQuery('');
    setOpen(false);
  };

  const closeMobileSearch = () => {
    clearSearch();
    setMobileSearchOpen(false);
  };

  const openPatient = (id: string) => {
    clearSearch();
    router.push(`/patients/${id}`);
  };

  const openModule = (href?: string) => {
    if (!href) return;
    setModuleOpen(false);
    router.push(href);
  };

  const openSettingsPage = () => {
    setUserOpen(false);
    router.push('/settings');
  };

  const userInitials = currentUser?.name ? initials(currentUser.name) : 'TH';

  const isRouteActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(href + '/'));
  const primaryCreateHref = ['/patient-intake', '/consultation', '/patients/new'].find(href => isHrefAllowed(href, allowedRoutes));
  const mobileTabs = [
    { href: homeHref, label: 'Dashboard', icon: LayoutDashboard },
    ...(canSearchPatients ? [{ href: '/patients', label: 'Patients', icon: Users }] : []),
    ...(isHrefAllowed('/appointments', allowedRoutes) ? [{ href: '/appointments', label: 'Calendar', icon: Calendar }] : []),
    ...(isHrefAllowed('/messages', allowedRoutes) ? [{ href: '/messages', label: 'Inbox', icon: MessageSquare }] : []),
  ];

  return (
    <>
    <header className={`ehr-top-rail ${mobileSearchOpen ? 'is-searching' : ''}`}>
      <div className="ehr-top-brand" onClick={() => router.push(homeHref)} role="button" tabIndex={0} data-track="nav.home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ehr-top-brand-logo-full" src="/assets/tamamhealth-logo-full-white.svg" alt="Tamam Healthcare System" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ehr-top-brand-logo-icon" src="/assets/tamamhealth-logo-icon-white.svg" alt="" aria-hidden="true" />
      </div>

      <nav className="ehr-top-modules" aria-label="Primary EHR modules" ref={moduleRef}>
        <button
          type="button"
          className={`ehr-module-trigger ${moduleOpen ? 'active' : ''}`}
          onClick={() => setModuleOpen(value => !value)}
          aria-expanded={moduleOpen}
          aria-haspopup="menu"
          title="Open module menu"
          data-track="nav.module_menu"
        >
          {/* The dashboard glyph, fixed — not a hamburger and not the current
              module's icon. It stays constant so the trigger is always the same
              button in the same place (a changing glyph read as a mystery
              button), and because the module list leads with Dashboard this
              also stands in for the shortcut that used to sit in the row. The
              open panel attaches directly below. */}
          <LayoutDashboard className="w-5 h-5" />
        </button>

        {moduleOpen && (
          <EhrModuleMenu
            groups={navGroups}
            roleLabel={roleLabel}
            activeHref={activeModuleItem?.href}
            navLabel={navLabel}
            onOpenModule={openModule}
          />
        )}

        <EhrTopActions
          items={headerShortcutItems}
          navLabel={navLabel}
          activeHref={activeModuleItem?.href}
          onOpenModule={openModule}
          badges={moduleBadges}
        />

        {peopleMenuItems.length > 0 && (
          <EhrRailMenu
            label="People & HR"
            icon={Users}
            items={peopleMenuItems}
            menuTitle="People & HR"
            menuSubtitle={roleLabel}
            ariaLabel="People and HR menu"
            active={isPeopleSectionActive(peopleEntries, pathname || '')}
          />
        )}

      </nav>

      {/* Overlaid on the rail's true center (not a grid cell), so it never
          shifts the brand/modules/search columns. */}
      {centerLabel && (
        <div className="ehr-top-center">
          <div className="ehr-top-facility" title={centerLabel}>
            <span>{centerLabel}</span>
          </div>
        </div>
      )}

      {/* The calendar lives on the appointments board. Rendered only for
          roles that can open it — the old hardcoded '/dashboard?view=calendar'
          target sent every role without /dashboard access to RoleGuard's
          "Access Restricted" screen, and ?view=calendar was a dead param. */}
      {isHrefAllowed('/appointments', allowedRoutes) && (
        <button
          type="button"
          className="ehr-top-calendar-button"
          onClick={() => router.push('/appointments')}
          aria-label="Open calendar"
          title="Calendar"
          data-track="nav.calendar"
        >
          <Calendar className="w-4 h-4" />
        </button>
      )}

      {(canSearchPatients || isNationalRole) ? (
        <div className={`ehr-top-search ${mobileSearchOpen ? 'is-mobile-open' : ''}`} ref={boxRef} data-track="patient.search">
          <Search className="w-4 h-4" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setOpen(event.target.value.trim().length >= 2);
            }}
            onFocus={() => setOpen(query.trim().length >= 2)}
            placeholder="Start typing a patient name, ID, or phone"
            type="search"
            data-track="patient.search_input"
          />
          {(query || mobileSearchOpen) && (
            <button type="button" onClick={query ? clearSearch : closeMobileSearch} aria-label={query ? 'Clear patient search' : 'Close patient search'}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {open && (
            <div className="ehr-top-search-menu">
              {matches.length === 0 ? (
                <p>No matching patients in this workspace.</p>
              ) : matches.map(patient => (
                <button key={patient._id} type="button" onMouseDown={event => { event.preventDefault(); openPatient(patient._id); }}>
                  <span>
                    <strong>{patientFullName(patient)}</strong>
                    <small>
                      {[patient.hospitalNumber, patientGenderAge(patient), patient.phone ? formatPhoneDisplay(patient.phone) : ''].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ehr-top-search-spacer" aria-hidden="true" />
      )}

      <div className="ehr-top-actions">
        {canSearchPatients && (
          <button
            type="button"
            className="ehr-mobile-search-trigger"
            onClick={() => {
              setMobileSearchOpen(true);
              setOpen(query.trim().length >= 2);
            }}
            aria-label="Search patients"
            data-track="patient.search_mobile"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
        {canRegisterPatients && (
          <button
            type="button"
            onClick={() => router.push('/patients/new')}
            aria-label={t('frontDesk.registerNewPatient')}
            title={t('frontDesk.registerNewPatient')}
            data-track="patient.create"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        )}
        <QuickActions notificationCount={unreadCount} />
        <div className="ehr-user-menu-wrap" ref={userRef}>
          {/* Design: a plain 40px circle avatar — the role label lives in the
              menu below, not on the rail. */}
          <button
            type="button"
            className={`ehr-avatar ${userOpen ? 'active' : ''}`}
            title={`${currentUser?.name || 'Tamam user'} · ${roleConfig?.badgeLabel || roleLabel}`}
            onClick={() => setUserOpen(value => !value)}
            aria-expanded={userOpen}
            aria-haspopup="menu"
          >
            <span className="ehr-avatar-mark">{userInitials}</span>
          </button>

          {userOpen && (
            <div className="ehr-user-menu" role="menu">
              <button type="button" role="menuitem" onClick={openSettingsPage}>
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
              {tourAvailable && (
                <button type="button" role="menuitem" onClick={() => { setUserOpen(false); startTour(); }}>
                  <HelpCircle className="w-4 h-4" />
                  <span>Take a tour</span>
                </button>
              )}
              <button type="button" role="menuitem" className="danger" onClick={() => { setUserOpen(false); logout(); }}>
                <LogOut className="w-4 h-4" />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>

    </header>

    {currentUser && mobileTabs.length > 0 && (
      <nav className="ehr-mobile-tabbar" aria-label="Primary navigation">
        {mobileTabs.slice(0, 2).map(tab => (
          <button
            key={tab.href}
            type="button"
            className={isRouteActive(tab.href) ? 'active' : ''}
            onClick={() => router.push(tab.href)}
          >
            <tab.icon className="w-5 h-5" />
            <span>{tab.label}</span>
          </button>
        ))}
        {primaryCreateHref && (
          <button type="button" className="ehr-mobile-tabbar-fab" aria-label="Quick create" onClick={() => router.push(primaryCreateHref)}>
            <Plus className="w-6 h-6" />
          </button>
        )}
        {mobileTabs.slice(2).map(tab => (
          <button
            key={tab.href}
            type="button"
            className={isRouteActive(tab.href) ? 'active' : ''}
            onClick={() => router.push(tab.href)}
          >
            <tab.icon className="w-5 h-5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    )}
    </>
  );
}
