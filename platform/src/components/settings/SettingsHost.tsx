'use client';

/**
 * Settings host — lets content embedded in the Settings page navigate WITHIN
 * Settings instead of routing away from it.
 *
 * Several consoles now live only inside Settings (System administration, IT
 * Operations, the org-admin editors). Those consoles link to each other, and
 * a plain <Link> would drop the user out of Settings entirely and lose the
 * rail they were working in. So: any destination Settings can host opens as a
 * Settings panel, and the panel stack gets a back control. Anything Settings
 * cannot host — a real module page, or an off-site URL — stays a normal link,
 * because pretending to host it would strand the user in a broken shell.
 *
 * Outside Settings the context is absent and `SettingsLink` degrades to a
 * plain <Link>, so the same components still work on their own routes.
 */

import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';

/**
 * In-app routes Settings can render as one of its own panels. Keys are the
 * hrefs embedded content links to; values are `activePanel` ids. Anything not
 * listed here navigates for real — this map is the honest boundary of what
 * Settings can actually host, not a wish list.
 */
export const SETTINGS_HOSTED_ROUTES: Record<string, string> = {
  '/system-admin': 'sysadmin-apps',
  '/it': 'sysadmin-itops',
  '/facility-settings': 'facility-config',
  '/settings/manage': 'manage-screen',
  '/org-admin/users': 'org-people-editor',
  '/org-admin/hospitals': 'org-facilities-editor',
  '/org-admin/branding': 'org-branding-editor',
  '/org-admin/pricing': 'org-billing-editor',
};

/** Panel id for `href`, or null when Settings has to hand it to the router. */
export function hostedPanelFor(href: string): string | null {
  const path = href.split(/[?#]/)[0];
  return SETTINGS_HOSTED_ROUTES[path] ?? null;
}

interface SettingsHostValue {
  /** Open a Settings panel by id, pushing it onto the back stack. */
  openPanel: (panelId: string) => void;
}

const SettingsHostContext = createContext<SettingsHostValue | null>(null);

export function SettingsHostProvider({ value, children }: { value: SettingsHostValue; children: ReactNode }) {
  return <SettingsHostContext.Provider value={value}>{children}</SettingsHostContext.Provider>;
}

/** Null outside Settings — callers use that to fall back to real navigation. */
export function useSettingsHost(): SettingsHostValue | null {
  return useContext(SettingsHostContext);
}

/**
 * A link that stays inside Settings when it can. Renders a <button> that
 * swaps the Settings panel for hosted in-app routes, and a plain <Link> for
 * everything else (external URLs, module pages Settings can't host, and any
 * use outside Settings at all).
 */
export function SettingsLink({
  href,
  className,
  title,
  children,
  onNavigate,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
  /** Runs after an in-Settings panel swap — e.g. to close a popover. */
  onNavigate?: () => void;
}) {
  const host = useSettingsHost();
  const panel = host && !isExternal(href) ? hostedPanelFor(href) : null;

  if (host && panel) {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={() => { host.openPanel(panel); onNavigate?.(); }}
      >
        {children}
      </button>
    );
  }

  if (isExternal(href)) {
    return (
      <a href={href} className={className} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    );
  }

  return <Link href={href} className={className} title={title} onClick={onNavigate}>{children}</Link>;
}

/** Off-site destinations: anything with a scheme, or a protocol-relative URL. */
export function isExternal(href: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
}
