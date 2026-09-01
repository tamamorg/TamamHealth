'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Calendar,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings,
  UserCheck,
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
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useUsers } from '@/lib/hooks/useUsers';

import { useHospitals } from '@/lib/hooks/useHospitals';
import { patientFullName, patientGenderAge, initials } from '@/lib/patient-utils';
import { formatPhoneShared } from '@/lib/field-formats';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrModuleMenu from './EhrModuleMenu';
import EhrRailMenu, { type RailMenuItem } from './EhrRailMenu';
import { buildAddMenuEntries, usersHrefForRole } from '@/lib/people-nav';
import EhrTopActions from './EhrTopActions';
import QuickActions from '@/components/QuickActions';
import {
  activeNavItem,
  getPrimaryShortcutItems,
  groupNavItemsBySection,
  navItemLabel,
  isHrefAllowed,
  impersonationChipInfo,
  railCenterLabels,
  resolveRailFacilityName,
  uniqueAllowedNavItems,
} from './ehr-navigation';
import { moduleBadgeCounts } from '@/lib/module-badges';
import { useNotifications } from '@/modules/communication/client';

export default function EhrTopRail() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { currentUser, logout } = useAuth();
  // Facility name for the header chip. Sessions restored via /api/auth/me
  // before hospitalName was added to the token won't carry it — fall back to
  // resolving the name from the local hospitals store by id.
  const { hospitals } = useHospitals();
  const liveFacilityName = currentUser?.hospitalId
    ? hospitals.find(h => h._id === currentUser.hospitalId)?.name
    : undefined;
  const facilityName = resolveRailFacilityName({
    liveName: liveFacilityName,
    hydratedName: currentUser?.hospital?.name,
    sessionName: currentUser?.hospitalName,
  });
  // National oversight (Ministry of Health) isn't tied to a single facility —
  // show the ministry name in the rail's center and give it the header search,
  // so the National Dashboard page doesn't need its own title + search row.
  const isNationalRole = currentUser?.role === 'government';
  // Gates the rail's register-patient shortcut below — the platform operator
  // has no facility to register a patient into.
  const isPlatformAdmin = currentUser?.role === 'super_admin';
  // Every role reads the same two-line shape the platform operator always had
  // ("TAMAMHEALTH PLATFORM ADMIN / COMMAND CENTER"): the organization on the
  // main line, the signed-in user's workspace on the quieter line under it —
  // "MERCY HOSPITAL GROUP / MEDICAL RECEPTIONIST". The derivation (including
  // the facility-console and Ministry special cases) lives in ehr-navigation's
  // railCenterLabels, pure and unit-tested per role shape. The rail names the
  // PLACE — organization over facility — and each dashboard's own header names
  // the job under the greeting, so the two never restate one another.
  const { centerLabel, centerSubLabel } = railCenterLabels({
    role: currentUser?.role,
    name: currentUser?.name,
    orgName: currentUser?.orgName,
    facilityName,
    roleLabel: currentUser ? getRoleConfig(currentUser.role).label : undefined,
  });
  const { canRegisterPatients } = usePermissions();
  // Reception already carries "Register new patient" as a header action on its
  // own dashboard, so the rail's person-plus was the same act offered twice on
  // one screen. Roles whose workspace does NOT offer it keep the rail button —
  // for them it is the only way in.
  const receptionRole = currentUser?.role === 'front_desk'
    || currentUser?.role === 'central_registration_clerk'
    || currentUser?.role === 'clinic_clerk';
  const { available: tourAvailable, start: startTour } = useTourContext();
  // Search follows the signed-in person's work. A platform operator manages
  // tenants, facilities and accounts; loading the national patient register
  // into that rail was irrelevant and an unnecessary PHI read. Clinical roles
  // retain patient search. Disabled hooks do not fetch or subscribe.
  const { patients } = usePatients(!isPlatformAdmin);
  const { organizations } = useOrganizations(isPlatformAdmin);
  const { users: platformUsers } = useUsers(isPlatformAdmin);
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
  // Whether this rail is sitting on the facility-management console, which is
  // the roles' own default dashboard (role-routes.ts:123). Drives the two
  // decisions below: two header shortcuts instead of four, and whether the
  // roster / "Add a record" entries appear at all.
  const isFacilityConsole = homeHref === '/facility-management';
  const roleLabel = roleConfig?.label || currentUser?.role.replace(/_/g, ' ') || 'Workspace';
  // A support session: the platform super-admin signed in AS this role via
  // the login role picker. See `impersonationChipInfo`'s own doc comment for
  // why this was invisible before and why the rule lives there, pure.
  const impersonation = impersonationChipInfo({
    role: currentUser?.role,
    actualRole: currentUser?.actualRole,
    roleLabel,
    actualRoleLabel: currentUser?.actualRole ? getRoleConfig(currentUser.actualRole).label : undefined,
  });
  const canSearchPatients = isHrefAllowed('/patients', allowedRoutes);

  const navItems = useMemo(() => {
    if (!currentUser) return [];
    return uniqueAllowedNavItems(roleConfig?.navItems || [], allowedRoutes);
  }, [allowedRoutes, currentUser, roleConfig]);

  // Keep four high-frequency destinations visible in the header as shortcuts.
  // `homeHref` is passed so the role's own dashboard never takes one of the
  // four — the module trigger to the left of this row already goes there.
  // Two shortcuts, not four, on the facility console: the two slots go to the
  // record actions below, which came off that dashboard's own header. By
  // priority the pair being displaced is Laboratory and Prescriptions — both
  // still one tap away in the module menu.
  const headerShortcutItems = useMemo(
    () => getPrimaryShortcutItems(navItems, currentUser?.role, isFacilityConsole ? 2 : 4, homeHref),
    [navItems, currentUser?.role, homeHref, isFacilityConsole],
  );

  // Staff roster + "Add a record", moved here from the Facility Management
  // dashboard so they are reachable from every page of the console rather than
  // only its landing screen. Every entry navigates: the rail is global, so it
  // cannot open a dialog that belongs to one page.
  const staffListHref = currentUser ? usersHrefForRole(currentUser.role) : null;
  const addMenuItems: RailMenuItem[] = useMemo(() => {
    if (!currentUser || !isFacilityConsole) return [];
    return buildAddMenuEntries({ role: currentUser.role, allowedRoutes })
      .map(entry => ({ key: entry.key, label: entry.label, onSelect: () => router.push(entry.href) }));
  }, [currentUser, allowedRoutes, router, isFacilityConsole]);
  const headerShortcutHrefs = useMemo(
    () => new Set(headerShortcutItems.map(item => item.href)),
    [headerShortcutItems],
  );
  // The menu drops what the rail already shows. These four sit in the row
  // immediately to the right of the trigger on every page, so listing them
  // again inside the panel it opens made the list longer without making
  // anywhere new reachable — and the dashboard header below now carries the
  // next five (getPageHeaderNavItems), so the shortest path to most
  // destinations is already on screen before the menu is opened.
  const navGroups = useMemo(
    () => groupNavItemsBySection(navItems.filter(item => !headerShortcutHrefs.has(item.href))),
    [headerShortcutHrefs, navItems],
  );

  const navLabel = (item: NavItem): string => navItemLabel(item, t);

  // Resolved once, then handed to the dropdown and the shortcut row, so all
  // three surfaces name the same module instead of each matching on its own.
  const activeModuleItem = useMemo(() => activeNavItem(navItems, pathname), [navItems, pathname]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    if (isPlatformAdmin) {
      const organizationMatches = organizations
        .filter(org => `${org.name} ${org.slug} ${org.orgType} ${org.subscriptionStatus}`.toLowerCase().includes(needle))
        .map(org => ({
          key: `organization:${org._id}`,
          title: org.name,
          meta: `${t('topbar.searchOrganization')} · ${org.subscriptionStatus}`,
          href: `/admin/organizations/${encodeURIComponent(org._id)}`,
        }));
      const facilityMatches = hospitals
        .filter(hospital => `${hospital.name} ${hospital.town ?? ''} ${hospital.state ?? ''} ${hospital.facilityType ?? ''}`.toLowerCase().includes(needle))
        .map(hospital => ({
          key: `facility:${hospital._id}`,
          title: hospital.name,
          meta: `${t('topbar.searchFacility')} · ${[hospital.town, hospital.state].filter(Boolean).join(', ') || '—'}`,
          href: `/admin/facilities/${encodeURIComponent(hospital._id)}`,
        }));
      const userMatches = platformUsers
        .filter(user => `${user.name} ${user.username} ${user.role} ${user.hospitalName ?? ''} ${user.orgName ?? ''}`.toLowerCase().includes(needle))
        .map(user => ({
          key: `user:${user._id}`,
          title: user.name,
          meta: `${t('topbar.searchUser')} · @${user.username} · ${getRoleConfig(user.role).label}`,
          href: `/admin/users/${encodeURIComponent(user._id)}`,
        }));
      return [...organizationMatches, ...facilityMatches, ...userMatches].slice(0, 8);
    }
    return patients
      .filter(patient => {
        const haystack = `${patientFullName(patient)} ${patient.hospitalNumber || ''} ${patient.phone || ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, 6)
      .map(patient => ({
        key: `patient:${patient._id}`,
        title: patientFullName(patient),
        meta: [patient.hospitalNumber, patientGenderAge(patient), patient.phone ? formatPhoneShared(patient.phone) : ''].filter(Boolean).join(' · '),
        href: `/patients/${encodeURIComponent(patient._id)}`,
      }));
  }, [hospitals, isPlatformAdmin, organizations, patients, platformUsers, query, t]);

  const clearSearch = () => {
    setQuery('');
    setOpen(false);
  };

  const closeMobileSearch = () => {
    clearSearch();
    setMobileSearchOpen(false);
  };

  const openSearchResult = (href: string) => {
    clearSearch();
    router.push(href);
  };

  const openModule = (href?: string) => {
    if (!href) return;
    setModuleOpen(false);
    router.push(href);
  };

  /**
   * Warm a destination before it is clicked.
   *
   * The rail navigates imperatively — every shortcut and every module row is a
   * `<button>` calling `router.push`, which is what the ~15 CSS rules keyed on
   * `.ehr-top-rail button` / `.ehr-module-menu section > button` are written
   * against. That kept the styling honest and left the whole primary
   * navigation with no prefetching at all: a route was only ever fetched after
   * the click, so every module switch paid the full round trip (~300-500ms
   * measured warm). `router.prefetch` is what `<Link>` does underneath, so
   * calling it on hover and focus buys the same head start without turning a
   * button into an anchor and taking the cascade with it.
   *
   * Each href is warmed once per mount — prefetch is idempotent, but the Set
   * keeps a hover-heavy rail from queueing the same request repeatedly.
   *
   * No-op in `next dev`, where Next disables prefetching; the effect is a
   * production one.
   */
  const prefetched = useRef(new Set<string>());
  const warm = useCallback((href?: string) => {
    if (!href || href.startsWith('http') || prefetched.current.has(href)) return;
    prefetched.current.add(href);
    try { router.prefetch(href); } catch { /* prefetch is best-effort */ }
  }, [router]);

  // The four shortcuts and the role's home are warmed as soon as the rail
  // renders, so the first click of a session is as quick as the rest.
  useEffect(() => {
    warm(homeHref);
    for (const item of headerShortcutItems) warm(item.href);
  }, [warm, homeHref, headerShortcutItems]);

  const openSettingsPage = () => {
    setUserOpen(false);
    router.push('/settings');
  };

  const userInitials = currentUser?.name ? initials(currentUser.name) : 'TH';

  const isRouteActive = (href: string) => pathname === href || (href !== '/' && pathname?.startsWith(href + '/'));
  const primaryCreateHref = ['/consultation', '/patients/new'].find(href => isHrefAllowed(href, allowedRoutes));
  const mobileTabs = [
    { href: homeHref, label: 'Dashboard', icon: LayoutDashboard },
    ...(canSearchPatients ? [{ href: '/patients', label: 'Patients', icon: Users }] : []),
    ...(isHrefAllowed('/appointments', allowedRoutes) ? [{ href: '/appointments', label: 'Calendar', icon: Calendar }] : []),
    ...(isHrefAllowed('/messages', allowedRoutes) ? [{ href: '/messages', label: 'Inbox', icon: MessageSquare }] : []),
  ];

  return (
    <>
    <header className={`ehr-top-rail ${mobileSearchOpen ? 'is-searching' : ''}`}>
      {/* The brand mark is the way home from anywhere, and it was mouse-only:
          `role="button"` and `tabIndex={0}` put it in the tab order with no key
          handler behind them, so a keyboard user could focus it and press
          Enter to nothing. */}
      <div
        className="ehr-top-brand"
        onClick={() => router.push(homeHref)}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          router.push(homeHref);
        }}
        onMouseEnter={() => warm(homeHref)}
        role="button"
        tabIndex={0}
        aria-label="Go to your dashboard"
        data-track="nav.home"
      >
        {/* One mark, every width. There used to be a second `<img>` — the
            bare dot icon — swapped in for the wordmark under 768px and hidden
            by five separate rules everywhere else. Five hide-rules and one
            show-rule for one element is a coin toss the cascade keeps losing:
            it is what put a second logo on the rail. The full mark scales. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ehr-top-brand-logo-full" src="/assets/tamamhealth-logo-full-white.svg" alt="Tamam Healthcare System" />
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
          {/* A hamburger, fixed — never the current module's icon. It stays
              constant so the trigger is always the same button in the same
              place (a changing glyph read as a mystery button), and it is the
              platform's own `menu` glyph (Icon.tsx), so it carries the same
              stroke and colour as every other icon on the rail.

              It was the dashboard glyph until the menu became a full module
              map: that glyph is also the Dashboard row's own icon inside the
              panel, so the button and one of its items were drawn identically.
              The hamburger says "everywhere you can go"; the dashboard glyph
              still says "the dashboard", one row down. */}
          <Menu className="w-5 h-5" />
        </button>

        {moduleOpen && (
          <EhrModuleMenu
            groups={navGroups}
            roleLabel={roleLabel}
            activeHref={activeModuleItem?.href}
            navLabel={navLabel}
            onOpenModule={openModule}
            onWarm={warm}
            footer={
              /* Phone-only account block — CSS hides it above 640px, where the
                 rail's own avatar menu still carries this. Keeps the profile
                 reachable once the bar drops the avatar on a phone. */
              <>
                <div className="ehr-module-account-id">
                  <span className="ehr-module-account-avatar">{userInitials}</span>
                  <span className="ehr-module-account-copy">
                    <b>{currentUser?.name || 'Tamam user'}</b>
                    <small>{roleConfig?.badgeLabel || roleLabel}</small>
                  </span>
                </div>
                <button type="button" onClick={() => { setModuleOpen(false); openSettingsPage(); }}>
                  <Settings className="w-4 h-4" /><span>Settings</span>
                </button>
                {tourAvailable && (
                  <button type="button" onClick={() => { setModuleOpen(false); startTour(); }}>
                    <HelpCircle className="w-4 h-4" /><span>Take a tour</span>
                  </button>
                )}
                <button type="button" className="danger" onClick={() => { setModuleOpen(false); logout(); }}>
                  <LogOut className="w-4 h-4" /><span>Log out</span>
                </button>
              </>
            }
          />
        )}

        <EhrTopActions
          items={headerShortcutItems}
          navLabel={navLabel}
          activeHref={activeModuleItem?.href}
          onOpenModule={openModule}
          onWarm={warm}
          badges={moduleBadges}
        />

        {isFacilityConsole && staffListHref && (
          <button
            type="button"
            className="relative"
            onClick={() => router.push(staffListHref)}
            title="View staff accounts"
            aria-label="View staff accounts"
            data-track="nav.staff_accounts"
          >
            <UserCheck className="w-4 h-4" />
          </button>
        )}
        {addMenuItems.length > 0 && (
          <EhrRailMenu
            variant="rail"
            label=""
            icon={Plus}
            hideChevron
            ariaLabel="Add a new record"
            items={addMenuItems}
          />
        )}

      </nav>

      {/* Overlaid on the rail's true center (not a grid cell), so it never
          shifts the brand/modules/search columns. */}
      {centerLabel && (
        <div className="ehr-top-center">
          <div
            className="ehr-top-facility"
            /* The two visible lines are organization · facility, so the
               tooltip carries the one thing they no longer say — the
               workspace the session is in. */
            title={[centerLabel, centerSubLabel, roleLabel !== centerSubLabel ? roleLabel : undefined]
              .filter(Boolean).join(' · ')}
          >
            <span>{centerLabel}</span>
            {centerSubLabel && <em className="ehr-top-facility-org">{centerSubLabel}</em>}
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

      {(isPlatformAdmin || canSearchPatients || isNationalRole) ? (
        <div className={`ehr-top-search ${mobileSearchOpen ? 'is-mobile-open' : ''}`} ref={boxRef} data-track="workspace.search">
          <Search className="w-4 h-4" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setOpen(event.target.value.trim().length >= 2);
            }}
            onFocus={() => setOpen(query.trim().length >= 2)}
            placeholder={isPlatformAdmin ? t('topbar.searchPlatformPlaceholder') : t('topbar.searchPatientPlaceholder')}
            type="search"
            /* Not a credential field, and browsers must stop guessing that it
               is: opening Settings puts password inputs on the page, and this
               is the text input nearest them, so Chrome was filling it with
               the signed-in username. The password dialog now carries its own
               username field; this is the other half. */
            name="workspace-search"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            data-track="workspace.search_input"
          />
          {(query || mobileSearchOpen) && (
            <button type="button" onClick={query ? clearSearch : closeMobileSearch} aria-label={query ? 'Clear patient search' : 'Close patient search'}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {open && (
            <div className="ehr-top-search-menu">
              {matches.length === 0 ? (
                <p>{t(isPlatformAdmin ? 'topbar.searchNoPlatformMatches' : 'topbar.searchNoPatientMatches')}</p>
              ) : matches.map(match => (
                <button key={match.key} type="button" onMouseDown={event => { event.preventDefault(); openSearchResult(match.href); }}>
                  <span>
                    <strong>{match.title}</strong>
                    <small>{match.meta}</small>
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
        {impersonation && (
          // Solid fill, not a translucent tint: the rail's own background is
          // the dark accent colour, and a light amber tint over a dark ground
          // renders muddy rather than amber. `--accent-orange-on` is the
          // token this design system already carries for text sitting ON a
          // solid orange fill (see globals.css's orange-token comment), so
          // contrast here is by design rather than a guess.
          <span
            className="ehr-impersonation-chip"
            role="status"
            title={t('topbar.impersonationChipTooltip', { actualRole: impersonation.actualRoleLabel, role: impersonation.activeRoleLabel })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              background: 'var(--accent-orange)',
              color: 'var(--accent-orange-on)',
            }}
          >
            {t('topbar.impersonationChip', { role: impersonation.activeRoleLabel })}
          </span>
        )}
        {(isPlatformAdmin || canSearchPatients) && (
          <button
            type="button"
            className="ehr-mobile-search-trigger"
            onClick={() => {
              setMobileSearchOpen(true);
              setOpen(query.trim().length >= 2);
            }}
            aria-label={isPlatformAdmin ? t('topbar.searchPlatformAria') : t('topbar.searchPatientsAria')}
            data-track="workspace.search_mobile"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
        {/* Not for the platform operator. `canRegisterPatients` is true for
            super_admin only because usePermissions sweeps every `can*` flag on
            for that role — it is a blanket bypass, not a statement that
            registering patients is part of the job. A governance console has no
            facility to register a patient into, so the rail offered a clinical
            intake form from every platform screen. */}
        {canRegisterPatients && !receptionRole && !isPlatformAdmin && (
          <button
            type="button"
            onClick={() => router.push('/patients/new')}
            aria-label={t('frontDesk.registerNewPatient')}
            title={t('frontDesk.registerNewPatient')}
            data-track="patient.create"
          >
            {/* The same person-plus the front-desk strip's "Register new
                patient" button wears, so the one act carries one glyph
                wherever it is offered. */}
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
