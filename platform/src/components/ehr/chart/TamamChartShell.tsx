'use client';

/**
 * TamamChartShell — the visual shell for the Tamam O3-style patient
 * chart. Owns the left nav rail, the right action icon rail + slide-in
 * workspace drawer, and the scrolling main column that hosts the sticky
 * header/vitals slots plus the (unmodified) tab content.
 *
 * Tab content itself is NOT touched here — callers pass it in as `children`
 * and it renders inside `.tamam-content` exactly as it did before this shell
 * existed.
 *
 * Stage 2: the right-rail drawer now renders real, functional workspace
 * panels (src/components/ehr/chart/panels/**) instead of placeholders. The
 * panels reuse existing hooks/services/modals — this shell just threads the
 * patient/current-user/permission/router context they need down to them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  ShoppingCart, Stethoscope, ClipboardCheck, FileText, Users, X, Maximize2,
} from '@/components/icons/lucide';
import type { PatientDoc } from '@/lib/db-types';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { useUsers } from '@/lib/hooks/useUsers';
import OrderBasketPanel from './panels/OrderBasketPanel';
import VisitNotePanel from './panels/VisitNotePanel';
import TaskListPanel from './panels/TaskListPanel';
import ClinicalFormsPanel from './panels/ClinicalFormsPanel';
import PatientListsPanel from './panels/PatientListsPanel';
import type { ChartPanelRouter, ChartPanelUser } from './panels/types';
import './tamam-chart.css';
import { dismissBackdrop } from '@/lib/a11y';

export interface OmrsRailItem {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
}

interface DrawerPanelDef {
  id: string;
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  /** The panel shows clinical detail about this patient (drug/lab orders,
   *  diagnoses, when they were last consulted or admitted), so it belongs to
   *  the same minimum-necessary set as the clinical chart tabs. The rail is
   *  rendered for every role that can open a chart — reception, cashiers and
   *  the lab bench included — so without this flag those roles read a
   *  patient's medication list out of a drawer the tab gating denies them. */
  clinical?: boolean;
}

// Right-rail workspace panels — icon + title only; the actual body is
// resolved per-id in renderPanelBody() below.
const DRAWER_PANELS: DrawerPanelDef[] = [
  { id: 'order-basket', title: 'Order basket', icon: ShoppingCart, clinical: true },
  // Stethoscope, not a pencil: this panel's primary action starts a
  // consultation, so it should read as clinical work rather than note-taking.
  { id: 'visit-note', title: 'Visit note', icon: Stethoscope, clinical: true },
  // Recall reminders, not clinical detail — the front desk works this queue
  // (ADMIN_TAB_IDS carries 'recall' for exactly that reason), so it stays.
  { id: 'task-list', title: 'Task list', icon: ClipboardCheck },
  { id: 'clinical-forms', title: 'Clinical forms', icon: FileText, clinical: true },
  { id: 'patient-lists', title: 'Patient lists', icon: Users },
];

/** The workspace panels a viewer may open, in rail order. Exported so the
 *  minimum-necessary rule is unit-testable without rendering the chart. */
export function visibleDrawerPanels(canViewClinical: boolean): DrawerPanelDef[] {
  return DRAWER_PANELS.filter(panel => canViewClinical || !panel.clinical);
}

/**
 * The clinical-note editor panel is deliberately NOT on the right icon rail:
 * it always edits a specific note, so it only opens via an id-carrying panel
 * request (`clinical-note:<noteId>`) — the header's "+ Note", a Notes-tab row.
 * A bare rail button would have no note to open.
 */
const CLINICAL_NOTE_PANEL: DrawerPanelDef = { id: 'clinical-note', title: 'Clinical note', icon: FileText };

interface TamamChartShellProps {
  activeTab: string;
  setActiveTab: (id: string) => void;
  /** Primary Tamam-mapped rail items, already permission-filtered. */
  railItems: OmrsRailItem[];
  /** Existing tabs that don't have an Tamam-rail slot. They render straight
   *  after `railItems` in the same single list — the two arrays stay separate
   *  only to preserve that ordering. */
  moreItems: OmrsRailItem[];
  header: ReactNode;
  vitalsBand?: ReactNode;
  children: ReactNode;

  // ── Stage 2: context the right-drawer workspace panels need ──
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  canPrescribe: boolean;
  canOrderLabs: boolean;
  canConsult: boolean;
  /** Gates the clinical workspace panels on the right rail — see
   *  `visibleDrawerPanels`. */
  canViewClinical: boolean;
  router: ChartPanelRouter;
  onOpenPrescribeModal: () => void;
  onOpenOrderLabModal: () => void;
  onNoteSaved?: () => void;
  /** One-shot request from the page to open a drawer panel by id (e.g. the
   *  header's "+ Note" opening 'visit-note'); acknowledged via
   *  onPanelRequestHandled so the same panel can be requested again. */
  panelRequest?: string | null;
  onPanelRequestHandled?: () => void;
}

export default function TamamChartShell({
  activeTab, setActiveTab, railItems, moreItems, header, vitalsBand, children,
  patient, currentUser, canPrescribe, canOrderLabs, canConsult, canViewClinical, router,
  onOpenPrescribeModal, onOpenOrderLabModal, onNoteSaved,
  panelRequest, onPanelRequestHandled,
}: TamamChartShellProps) {

  const [openPanel, setOpenPanel] = useState<string | null>(null);
  // Note being edited by the clinical-note panel, set by an id-carrying request.
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);
  // Providers the note editor's "Assigned to" picker offers. Scoped by
  // useUsers, so a clinician can only hand a note to their own facility.
  const { users } = useUsers();
  const assignableUsers = useMemo(
    () => (users || []).map(u => ({ _id: u._id, name: u.name || u.username })),
    [users],
  );
  // Drawer expand toggle — widens the workspace drawer to near-full-width.
  const [drawerMaximized, setDrawerMaximized] = useState(false);

  useEffect(() => {
    if (panelRequest) {
      if (panelRequest.startsWith('clinical-note:')) {
        setDrawerNoteId(panelRequest.slice('clinical-note:'.length));
        setOpenPanel('clinical-note');
        // The editor is a full documentation workspace with its own section
        // canvas — it opens wide by default rather than in the 420px drawer.
        setDrawerMaximized(true);
      } else {
        setOpenPanel(panelRequest);
        setDrawerMaximized(false);
      }
      onPanelRequestHandled?.();
    }
  }, [panelRequest, onPanelRequestHandled]);
  // Resolve from the permitted set, not the full list: a panel this role may
  // not open must not render even if something asked for it by id.
  const railPanels = useMemo(() => visibleDrawerPanels(canViewClinical), [canViewClinical]);
  const activePanel = railPanels.find(p => p.id === openPanel)
    || (openPanel === CLINICAL_NOTE_PANEL.id && canViewClinical ? CLINICAL_NOTE_PANEL : null);

  // One list, not two. `moreItems` used to hide behind a collapsed "More
  // sections" toggle, which meant half the chart's sections were one click away
  // for no reason a clinician could see — the split reflects which tabs happen
  // to map onto Tamam's rail, which is our history, not their task. The
  // ordering still puts the mapped sections first.
  const allRailItems = [...railItems, ...moreItems];

  // The editor autosaves as it goes, so "the note drawer went away" is the
  // moment the Notes tab under it may be stale — reuse onNoteSaved as that
  // refresh signal however the drawer closes (X, backdrop, or a rail switch).
  const notifyIfNoteClosing = (next: string | null) => {
    if (openPanel === CLINICAL_NOTE_PANEL.id && next !== CLINICAL_NOTE_PANEL.id) onNoteSaved?.();
  };

  const togglePanel = (id: string) => {
    notifyIfNoteClosing(openPanel === id ? null : id);
    setOpenPanel(prev => (prev === id ? null : id));
    setDrawerMaximized(false);
  };
  const closeDrawer = () => { notifyIfNoteClosing(null); setOpenPanel(null); setDrawerMaximized(false); };

  // A `?tab=` link inside the note editor (e.g. "go to Vitals") switches
  // tabs but leaves the editor mounted underneath — the drawer then covers
  // the tab it just navigated to. Leaving the note drawer is the one thing a
  // tab switch should always do; it autosaves, so nothing is lost by closing.
  useEffect(() => {
    if (openPanel === CLINICAL_NOTE_PANEL.id) closeDrawer();
    // Only the tab switch itself should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Escape closes the workspace drawer, the way every other dialog in the app
  // behaves. Without it the only ways out were the X and the backdrop, and the
  // note editor opens maximized over the whole chart.
  //
  // Tab is confined to the drawer while it is open. It declares aria-modal, so
  // a screen reader is already told the chart behind it is inert — letting the
  // keyboard walk out into that chart contradicts the announcement and strands
  // the caret on controls the user cannot see.
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openPanel) return;
    const focusable = () => Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(el => el.offsetParent !== null);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Wrap at both ends, and pull focus back in if it escaped some other way.
      if (!drawerRef.current?.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    // Move focus in on open, and hand it back to whatever opened the drawer on
    // close, so a keyboard user doesn't restart from the top of the document.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstItem = focusable()[0];
    (firstItem ?? drawerRef.current)?.focus();

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // closeDrawer is recreated each render; keying on the open panel is what
    // actually decides whether the listener should be attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanel]);

  const goToRecallTab = () => {
    // Recall reminders render on the Care plan tab (RemindersPanel), not
    // Appointments — pointing there landed the task-list "recall" link on an
    // empty tab.
    setActiveTab('careChecklist');
    closeDrawer();
  };

  const renderPanelBody = (id: string) => {
    switch (id) {
      case 'order-basket':
        return (
          <OrderBasketPanel
            patient={patient}
            canPrescribe={canPrescribe}
            canOrderLabs={canOrderLabs}
            onAddDrugOrder={() => { onOpenPrescribeModal(); closeDrawer(); }}
            onAddLabOrder={() => { onOpenOrderLabModal(); closeDrawer(); }}
            onClose={closeDrawer}
          />
        );
      case 'visit-note':
        return (
          <VisitNotePanel
            patient={patient}
            currentUser={currentUser}
            router={router}
            canConsult={canConsult}
            onClose={closeDrawer}
            onSaved={onNoteSaved}
          />
        );
      case 'clinical-note':
        return drawerNoteId ? (
          <div className="tamam-drawer-note-body">
            <ClinicalNoteEditor
              noteId={drawerNoteId}
              // Without this the drawer's "Assigned to" picker has nobody to
              // offer — the standalone /notes route passes the same list.
              assignableUsers={assignableUsers}
              // ChartPanelUser allows a missing _id; the editor does not — an
              // id-less session gets the editor's own signed-out handling.
              currentUser={currentUser?._id ? {
                _id: currentUser._id,
                name: currentUser.name,
                username: currentUser.username,
                role: currentUser.role,
                orgId: currentUser.orgId,
              } : null}
              onClose={closeDrawer}
            />
          </div>
        ) : null;
      case 'task-list':
        return (
          <TaskListPanel
            patient={patient}
            currentUser={currentUser}
            onClose={closeDrawer}
            onGoToRecall={goToRecallTab}
          />
        );
      case 'clinical-forms':
        return (
          <ClinicalFormsPanel
            patient={patient}
            router={router}
            canConsult={canConsult}
            currentUser={currentUser}
            onClose={closeDrawer}
          />
        );
      case 'patient-lists':
        return (
          <PatientListsPanel
            currentUser={currentUser}
            router={router}
            onClose={closeDrawer}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="tamam-root">
      {/* ══ Left vertical nav rail ══
          The column and the nav are separate elements on purpose: the column
          stretches to the shell's full height so the rail's surface and its
          divider run the length of the chart, while the nav inside it stays
          sticky and only as tall as its own list. */}
      <div className="tamam-rail-col no-print">
      <nav className="tamam-left-rail" aria-label="Patient chart sections">
        {/* One flat list of sections. The rail used to split into "Clinical"
            and "Record" cards, but the headings named where a tab came from
            rather than anything a clinician chooses by, and the break in the
            middle made the second half read as secondary. */}
        <div className="tamam-rail-card">
          <div className="tamam-rail-cardbody">
            {allRailItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={isActive ? 'tamam-rail-item is-active' : 'tamam-rail-item'}
                  onClick={() => setActiveTab(item.id)}
                  onMouseDown={e => e.preventDefault()}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.label}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="tamam-rail-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
      </div>

      {/* ══ Main column: sticky header/vitals + scrolling tab content ══ */}
      <div className="tamam-main-col">
        <div className="tamam-sticky-zone no-print">
          {header}
          {vitalsBand}
        </div>
        <div className="tamam-content">
          {children}
        </div>
      </div>

      {/* ══ Right action icon rail ══ */}
      <aside className="tamam-right-rail no-print" aria-label="Chart workspace panels">
        {railPanels.map(panel => (
          <button
            key={panel.id}
            type="button"
            className={openPanel === panel.id ? 'tamam-right-rail-btn is-active' : 'tamam-right-rail-btn'}
            onClick={() => togglePanel(panel.id)}
            title={panel.title}
            aria-pressed={openPanel === panel.id}
          >
            <panel.icon className="w-4 h-4" />
          </button>
        ))}
      </aside>

      {/* ══ Slide-in workspace drawer ══ */}
      {activePanel && (
        <>
          <div className="tamam-drawer-backdrop no-print" {...dismissBackdrop(closeDrawer)} />
          <div
            ref={drawerRef}
            tabIndex={-1}
            className={`tamam-drawer no-print ${drawerMaximized ? 'is-maximized' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={activePanel.title}
          >
            <div className="tamam-drawer-header">
              <span className="tamam-drawer-title">{activePanel.title}</span>
              <div className="tamam-drawer-controls">
                <button
                  type="button"
                  title={drawerMaximized ? 'Restore panel size' : 'Maximize'}
                  aria-label={drawerMaximized ? 'Restore panel size' : 'Maximize panel'}
                  aria-pressed={drawerMaximized}
                  onClick={() => setDrawerMaximized(v => !v)}
                >
                  <Maximize2 />
                </button>
                <button type="button" title="Close" aria-label="Close panel" onClick={closeDrawer}>
                  <X />
                </button>
              </div>
            </div>
            {renderPanelBody(activePanel.id)}
          </div>
        </>
      )}
    </div>
  );
}
