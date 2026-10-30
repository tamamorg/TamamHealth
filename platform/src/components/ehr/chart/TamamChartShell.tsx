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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  ShoppingCart, Stethoscope, Pencil, ClipboardCheck, FileText, Users, X, ArrowRight, Maximize2, Minimize2,
  Utensils, ScanLine, FlaskConical, Pill, Activity, HeartPulse, BedDouble,
} from '@/components/icons/lucide';
import type { PatientDoc } from '@/lib/db-types';
import DrawerResizeHandle from './DrawerResizeHandle';
import RailResizeHandle from './RailResizeHandle';
import { useHistoryLayer } from '@/lib/navigation/history-layer';
// One dropdown look for every workspace form (O3 select).
import './workspace-fields.css';
import ClinicalNoteEditor from '@/components/clinical-notes/ClinicalNoteEditor';
import { useUsers } from '@/lib/hooks/useUsers';
import OrderBasketPanel from './panels/OrderBasketPanel';
import type { BasketContext, BasketRequest, BasketView } from './panels/order-basket/basket-types';
import VisitNotePanel from './panels/VisitNotePanel';
import TaskListPanel from './panels/TaskListPanel';
import ClinicalFormsPanel from './panels/ClinicalFormsPanel';
import PatientListsPanel from './panels/PatientListsPanel';
import NutritionScreeningPanel from './panels/NutritionScreeningPanel';
import ImagingReportPanel from './panels/ImagingReportPanel';
import { DispensePanel, LabOrdersPanel } from './panels/StationOrdersPanel';
import WardAdmissionPanel from './panels/WardAdmissionPanel';
import TriageWorkflow from '@/components/nurse/TriageWorkflow';
import AncVisitForm from '@/components/anc/AncVisitForm';
import { ROLE_FORM_RULES, roleFormAllowed } from './panels/role-form-access';
import { getDefaultDashboard } from '@/lib/role-routes';
import type { ChartPanelRouter, ChartPanelUser } from './panels/types';
import './tamam-chart.css';
import { isAnyModalOpen } from '@/components/Modal';

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
  // A pencil, as O3 draws its visit note: the panel writes a note (it no
  // longer starts a consultation).
  { id: 'visit-note', title: 'Visit note', icon: Pencil, clinical: true },
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
/** One open workspace in the stack: a rail panel (with the note it holds, if
 *  it is the note editor) or the page's own workspace. */
type WorkspaceEntry =
  | { kind: 'rail'; id: string; noteId?: string | null; noteTitle?: string | null }
  | { kind: 'page' };

/** Drawer slot id for a page-owned workspace (see the `workspace` prop). */
const PAGE_WORKSPACE_ID = 'page-workspace';

const CLINICAL_NOTE_PANEL: DrawerPanelDef = { id: 'clinical-note', title: 'Clinical note', icon: FileText };

/**
 * Role forms — the record a service role comes to the chart to make. They
 * sit on the rail for the roles that may make them and open from Clinical
 * forms (or a dashboard's `?form=` link) for everyone else allowed.
 *
 * Gated on the record, not on `canViewClinical`: a nutritionist or a
 * radiologist does not get the clinical chart, but screening and reporting
 * are exactly their work. A nutrition screening may also be taken by the
 * clinical and nursing roles (the `nutrition_screening` sync grant is
 * NURSING_AND_CLINICIANS + nutritionist); an imaging report only by whoever
 * holds the radiology station. The rules live in `panels/role-form-access`,
 * which the Clinical forms list reads too.
 */
const ROLE_FORM_PANELS: (DrawerPanelDef & { wide?: boolean })[] = [
  { id: 'nutrition-screening', title: 'Nutrition screening', icon: Utensils },
  { id: 'imaging-report', title: 'Imaging report', icon: ScanLine },
  // The bench and the counter: the lab's and the pharmacy's six-step
  // workflows, worked beside the record. Wide, as the note editor is — the
  // step chevrons need the room.
  { id: 'lab-orders', title: 'Lab orders', icon: FlaskConical, wide: true },
  { id: 'dispense', title: 'Dispense', icon: Pill, wide: true },
  // Clinical forms that used to leave the chart for their module's page.
  { id: 'triage-form', title: 'Triage / ETAT assessment', icon: Activity, wide: true },
  { id: 'anc-visit', title: 'ANC visit', icon: HeartPulse, wide: true },
  { id: 'ward-admission', title: 'Ward admission', icon: BedDouble },
];

function isWideRoleForm(id: string): boolean {
  return !!ROLE_FORM_PANELS.find(panel => panel.id === id)?.wide;
}

/** The role forms `role` may open in the chart. Exported for tests. */
export function allowedRoleFormPanels(role: string | undefined, canViewClinical: boolean): DrawerPanelDef[] {
  if (!role) return [];
  return ROLE_FORM_PANELS.filter(panel => roleFormAllowed(panel.id, role, canViewClinical));
}

/** Role forms that get their own rail button: the form IS the role's work,
 *  i.e. the station that owns it is the role's home dashboard. */
export function railRoleFormPanels(role: string | undefined): DrawerPanelDef[] {
  if (!role) return [];
  const home = getDefaultDashboard(role);
  return ROLE_FORM_PANELS.filter(panel => ROLE_FORM_RULES[panel.id]?.station === home);
}

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
  onNoteSaved?: () => void;
  /** One-shot request from the page to open a drawer panel by id (e.g. the
   *  header's "+ Note" opening 'visit-note', or 'order-basket:drug' /
   *  'order-basket:lab' for the header's Prescribe / Order labs);
   *  acknowledged via onPanelRequestHandled so the same panel can be
   *  requested again. */
  panelRequest?: string | null;
  onPanelRequestHandled?: () => void;
  /** A page-owned workspace (Record vitals) shown in the same docked slot as
   *  the rail panels, so it squeezes the chart the same way. Opening it closes
   *  any rail panel; opening a rail panel closes it. */
  /** `wide` gives the workspace the note editor's wider column (Prescribe). */
  workspace?: { title: string; content: ReactNode; onClose: () => void; wide?: boolean } | null;
  /** The order a `?form=…&focus=` link named, for the station forms. */
  formFocusId?: string;
}

export default function TamamChartShell({
  activeTab, setActiveTab, railItems, moreItems, header, vitalsBand, children,
  patient, currentUser, canPrescribe, canOrderLabs, canConsult, canViewClinical, router,
  onNoteSaved,
  panelRequest, onPanelRequestHandled, workspace, formFocusId,
}: TamamChartShellProps) {

  // Workspaces stack. Opening one while another is open keeps the earlier one
  // underneath; closing the top one (✕, Cancel, Back, Escape) shows the one
  // below it, and so on down. The top entry is what the drawer shows. A rail
  // panel already in the stack moves to the top instead of appearing twice.
  const [stack, setStack] = useState<WorkspaceEntry[]>([]);
  const top = stack[stack.length - 1];
  const openPanel = top?.kind === 'rail' ? top.id : null;
  // Note being edited by the clinical-note panel, and the form name it was
  // opened as from Clinical forms ("Consultation"), shown as the title.
  const drawerNoteId = top?.kind === 'rail' && top.id === CLINICAL_NOTE_PANEL.id ? top.noteId ?? null : null;
  const drawerNoteTitle = top?.kind === 'rail' && top.id === CLINICAL_NOTE_PANEL.id ? top.noteTitle ?? null : null;
  // Providers the note editor's "Assigned to" picker offers. Scoped by
  // useUsers, so a clinician can only hand a note to their own facility.
  const { users } = useUsers();
  const assignableUsers = useMemo(
    () => (users || []).map(u => ({ _id: u._id, name: u.name || u.username })),
    [users],
  );
  // Full screen (the header's expand): the workspace covers the chart, up to
  // the icon rail. Only the user's own expand sets it — every workspace,
  // note forms included, opens as the docked slider on the right — and it
  // carries over as panels stack on one another.
  const [drawerMaximized, setDrawerMaximized] = useState(false);
  const pushRail = useCallback((entry: { id: string; noteId?: string | null; noteTitle?: string | null }) => {
    setStack(prev => [...prev.filter(e => !(e.kind === 'rail' && e.id === entry.id)), { kind: 'rail', ...entry }]);
  }, []);
  // The order basket opens on a screen (Add drug order, Add test order) when
  // asked from a header button or the note editor; a request from a note also
  // carries the note, so orders signed from it are filed under its visit.
  const [basketRequest, setBasketRequest] = useState<BasketRequest | null>(null);
  const [basketContext, setBasketContext] = useState<BasketContext | undefined>(undefined);
  // The drawer title follows the basket's screen ("Add drug order").
  const [basketTitle, setBasketTitle] = useState<string | null>(null);
  const openOrderBasket = useCallback((view: BasketView, context?: BasketContext) => {
    setBasketContext(context);
    setBasketRequest({ view });
    pushRail({ id: 'order-basket' });
  }, [pushRail]);
  const clearBasketRequest = useCallback(() => setBasketRequest(null), []);
  // Nothing open: the next workspace starts at its docked width again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the last workspace closes
    if (stack.length === 0) setDrawerMaximized(false);
  }, [stack.length]);

  // Resolve from the permitted set, not the full list: a panel this role may
  // not open must not render even if something asked for it by id.
  const railPanels = useMemo(() => visibleDrawerPanels(canViewClinical), [canViewClinical]);
  const roleFormPanels = useMemo(
    () => allowedRoleFormPanels(currentUser?.role, canViewClinical),
    [currentUser?.role, canViewClinical],
  );

  useEffect(() => {
    if (panelRequest) {
      if (panelRequest.startsWith('clinical-note:')) {
        pushRail({ id: CLINICAL_NOTE_PANEL.id, noteId: panelRequest.slice('clinical-note:'.length) });
      } else if (panelRequest === 'order-basket:drug' || panelRequest === 'order-basket:lab') {
        openOrderBasket(panelRequest === 'order-basket:drug' ? 'drug' : 'lab');
      } else if (railPanels.some(p => p.id === panelRequest) || roleFormPanels.some(p => p.id === panelRequest)) {
        // A request this viewer may not open (a shared `?form=imaging-report`
        // link reaching a doctor) is dropped, not pushed: it would never
        // render, and as an invisible top entry it hid the workspace beneath.
        pushRail({ id: panelRequest });
      }
      onPanelRequestHandled?.();
    }
  }, [panelRequest, onPanelRequestHandled, pushRail, openOrderBasket, railPanels, roleFormPanels]);
  const railPanel = railPanels.find(p => p.id === openPanel)
    || roleFormPanels.find(p => p.id === openPanel)
    || (openPanel === CLINICAL_NOTE_PANEL.id && canViewClinical ? CLINICAL_NOTE_PANEL : null);
  // A page workspace (Record vitals, Start a visit) joins the stack when the
  // page opens one and leaves it when the page closes it; whatever was open
  // before it is still underneath.
  const hasWorkspace = !!workspace;
  // Keyed on the workspace's title so a newly opened one (Start a visit over
  // Record vitals) comes to the top even while a rail panel was showing.
  const workspaceKey = workspace?.title ?? null;
  useEffect(() => {
    setStack(prev => {
      const rest = prev.filter(e => e.kind !== 'page');
      return workspaceKey ? [...rest, { kind: 'page' }] : rest;
    });
  }, [workspaceKey]);
  const activePanel: { id: string; title: string } | null = top?.kind === 'page' && workspace
    ? { id: PAGE_WORKSPACE_ID, title: workspace.title }
    : railPanel && railPanel.id === CLINICAL_NOTE_PANEL.id && drawerNoteTitle
      ? { id: railPanel.id, title: drawerNoteTitle }
      : railPanel && railPanel.id === 'order-basket' && basketTitle
        ? { id: railPanel.id, title: basketTitle }
        : railPanel;

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

  // A rail button opens its panel on top of the stack; pressing the button of
  // the panel already showing closes it (back to the one beneath).
  const togglePanel = (id: string) => {
    if (openPanel === id) { closeDrawer(); return; }
    notifyIfNoteClosing(id);
    pushRail({ id });
  };
  // Close the top workspace only. A page workspace is closed by the page
  // (the effect above then drops it); a rail panel is popped here.
  const closeDrawer = () => {
    if (top?.kind === 'page') { workspace?.onClose(); return; }
    notifyIfNoteClosing(null);
    setStack(prev => prev.slice(0, -1));
  };
  // Leave the workspaces altogether (the header's →): every stacked panel
  // closes, not just the top one, and the chart gets its full width back.
  const closeAllWorkspaces = () => {
    if (stack.some(e => e.kind === 'rail' && e.id === CLINICAL_NOTE_PANEL.id)) onNoteSaved?.();
    if (stack.some(e => e.kind === 'page')) workspace?.onClose();
    setStack([]);
  };

  // A `?tab=` link inside the note editor (e.g. "go to Vitals") switches
  // tabs but leaves the editor mounted underneath — the drawer then covers
  // the tab it just navigated to. Leaving the note drawer is the one thing a
  // tab switch should always do; it autosaves, so nothing is lost by closing.
  useEffect(() => {
    if (openPanel === CLINICAL_NOTE_PANEL.id) closeDrawer();
    // Only the tab switch itself should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // The drawer is a workspace docked beside the chart, not a dialog over it
  // (OpenMRS O3's workspace model): the chart narrows to make room and stays
  // usable, so there is no backdrop and Tab is not confined — a clinician can
  // read the chart while filling the panel. Escape still closes it, focus
  // moves in on open, and it goes back to whatever opened the drawer.
  const drawerRef = useRef<HTMLDivElement>(null);
  // The docked drawer is as tall as the area the chart scrolls in (below the
  // top rail AND the breadcrumb bar), so its footer is never pushed under the
  // window's bottom edge. CSS alone only knows the top rail's height.
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!openPanel && !hasWorkspace) return;
    const measure = () => {
      let node = drawerRef.current?.parentElement ?? null;
      while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
      // Less the chart shell's 1px top border, so the bottom edge lands on the window's.
      setDrawerHeight(node ? node.clientHeight - 1 : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [openPanel, hasWorkspace]);
  // The latest closeDrawer, read when Escape fires: the stack's top can change
  // (one page workspace replacing another) without re-binding the listener,
  // and a stale closure would close the workspace that is no longer on top.
  const closeDrawerRef = useRef(closeDrawer);
  useEffect(() => { closeDrawerRef.current = closeDrawer; });
  useEffect(() => {
    if (!openPanel && !hasWorkspace) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A popup open over the workspace (prescribe, lab order, a confirm)
      // takes Escape itself; closing it must not also close the panel.
      if (isAnyModalOpen() || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      closeDrawerRef.current();
    };
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstItem = drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstItem ?? drawerRef.current)?.focus();

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // closeDrawer is recreated each render; keying on the open panel is what
    // actually decides whether the listener should be attached.
  }, [openPanel, hasWorkspace]);

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
            currentUser={currentUser}
            canPrescribe={canPrescribe}
            canOrderLabs={canOrderLabs}
            request={basketRequest}
            onRequestHandled={clearBasketRequest}
            context={basketContext}
            onTitleChange={setBasketTitle}
            onClose={closeDrawer}
          />
        );
      case 'visit-note':
        return (
          <VisitNotePanel
            patient={patient}
            currentUser={currentUser}
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
              showContextSidebar={false}
              // Notes in the chart are O3 forms: a section list with Save /
              // Sign / Cancel, collapsible groups, and a way back to the list.
              layout="workspace"
              // Back = close this form; Clinical forms is beneath it.
              onBack={closeDrawer}
              // Changing the note type renames the note; the drawer title
              // follows it rather than keeping the name it opened with.
              onNoteTypeChange={label => setStack(prev => prev.map(entry => (
                entry.kind === 'rail' && entry.id === CLINICAL_NOTE_PANEL.id && entry.noteId === drawerNoteId
                  ? { ...entry, noteTitle: label }
                  : entry
              )))}
              // Without this the drawer's "Assigned to" picker has nobody to
              // offer — the standalone /notes route passes the same list.
              assignableUsers={assignableUsers}
              // ChartPanelUser allows a missing _id; the editor does not — an
              // id-less session gets the editor's own signed-out handling.
              // The facility travels with the user: everything written from the
              // note (prescriptions, orders) is stamped with it. Without it a
              // prescription had no hospitalId, and the scope filter then
              // showed it to every facility in the organisation.
              currentUser={currentUser?._id ? {
                _id: currentUser._id,
                name: currentUser.name,
                username: currentUser.username,
                role: currentUser.role,
                orgId: currentUser.orgId,
                hospitalId: currentUser.hospitalId,
                hospitalName: currentUser.hospitalName,
              } : null}
              onClose={closeDrawer}
              // The chart is already on screen: switch its section and close
              // the drawer. The tab-change effect above only closes it when
              // the section actually changes, so close it here as well.
              onOpenChartTab={(tabId) => { setActiveTab(tabId); closeDrawer(); }}
              // Prescribe / Order labs from the note go to the order basket on
              // top of it, carrying the note's visit; closing the basket
              // brings the note back.
              onOpenOrderBasket={(view, ctx) => openOrderBasket(view, { ...ctx, noteId: drawerNoteId || undefined })}
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
            canConsult={canConsult}
            currentUser={currentUser}
            onOpenNote={(noteId, title) => pushRail({ id: CLINICAL_NOTE_PANEL.id, noteId, noteTitle: title })}
            onOpenForm={id => pushRail({ id })}
          />
        );
      case 'nutrition-screening':
        return <NutritionScreeningPanel patient={patient} currentUser={currentUser} onClose={closeDrawer} />;
      case 'imaging-report':
        return <ImagingReportPanel patient={patient} currentUser={currentUser} onClose={closeDrawer} />;
      case 'triage-form':
        return (
          <div className="tamam-drawer-body">
            <TriageWorkflow lockedPatientId={patient._id} lockedPatient={patient} onSaved={closeDrawer} embedded />
          </div>
        );
      case 'anc-visit':
        return <AncVisitForm layout="workspace" lockedPatient={patient} onClose={closeDrawer} />;
      case 'ward-admission':
        return <WardAdmissionPanel patient={patient} currentUser={currentUser} onClose={closeDrawer} />;
      case 'lab-orders':
        return <LabOrdersPanel patient={patient} focusId={formFocusId} />;
      case 'dispense':
        return <DispensePanel patient={patient} focusId={formFocusId} />;
      case 'patient-lists':
        return (
          <PatientListsPanel
            currentUser={currentUser}
            router={router}
            onClose={closeDrawer}
          />
        );
      case PAGE_WORKSPACE_ID:
        // The workspace owns its own scroll and pinned footer (Save, Discard),
        // so it gets the drawer's full height rather than a scrolling body.
        return <div className="tamam-drawer-workspace">{workspace?.content}</div>;
      default:
        return null;
    }
  };

  return (
    <div className="tamam-root">
      {/* One Back entry per open workspace: the phone / tablet / browser Back
          closes the top one and shows the one beneath, like its ✕. */}
      {stack.map((entry, index) => (
        <WorkspaceBackLayer
          key={`${index}-${entry.kind === 'rail' ? `${entry.id}-${entry.noteId ?? ''}` : 'page'}`}
          onBack={() => closeDrawerRef.current()}
        />
      ))}
      {/* ══ Left vertical nav rail ══
          The column and the nav are separate elements on purpose: the column
          stretches to the shell's full height so the rail's surface and its
          divider run the length of the chart, while the nav inside it stays
          sticky and only as tall as its own list. */}
      <div className="tamam-rail-col no-print">
      {/* Drag the list's edge to resize it; squeezed far enough it becomes icons only. */}
      <RailResizeHandle />
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

      {/* ══ Workspace drawer — docked between the chart and the icon rail ══
          An in-flow column: the main column narrows to make room for it, so
          the chart stays visible beside the panel instead of under it. */}
      {activePanel && (
        <>
          <div
            ref={drawerRef}
            tabIndex={-1}
            className={`tamam-drawer no-print ${activePanel.id === CLINICAL_NOTE_PANEL.id || (activePanel.id === PAGE_WORKSPACE_ID && workspace?.wide) || isWideRoleForm(activePanel.id) ? 'is-note-editor' : ''} ${drawerMaximized ? 'is-maximized' : ''}`}
            style={drawerHeight ? { height: drawerHeight } : undefined}
            role="dialog"
            aria-modal="false"
            aria-label={activePanel.title}
          >
            {/* Drag the inner edge to resize (DrawerResizeHandle): note-width
                and panel-width workspaces each remember their own width.
                Hidden in full screen, where there is no edge to drag. */}
            {!drawerMaximized && (
              <DrawerResizeHandle storageKey={activePanel.id === CLINICAL_NOTE_PANEL.id || (activePanel.id === PAGE_WORKSPACE_ID && workspace?.wide) || isWideRoleForm(activePanel.id) ? 'tamam-drawer-w:note' : 'tamam-drawer-w:panel'} />
            )}
            <div className="tamam-drawer-header">
              <span className="tamam-drawer-title">{activePanel.title}</span>
              <div className="tamam-drawer-controls">
                {/* → leaves the workspaces (every stacked panel closes);
                    ✕ closes only this one and goes back to the one beneath. */}
                <button
                  type="button"
                  title={drawerMaximized ? 'Exit full screen' : 'Full screen'}
                  aria-label={drawerMaximized ? 'Exit full screen' : 'Full screen'}
                  aria-pressed={drawerMaximized}
                  onClick={() => setDrawerMaximized(v => !v)}
                >
                  {drawerMaximized ? <Minimize2 /> : <Maximize2 />}
                </button>
                <button type="button" className="tamam-drawer-leave" title="Close all panels" aria-label="Close all panels" onClick={closeAllWorkspaces}>
                  <ArrowRight />
                </button>
                <button type="button" title={stack.length > 1 ? 'Back' : 'Close'} aria-label={stack.length > 1 ? 'Back to the previous panel' : 'Close panel'} onClick={closeDrawer}>
                  <X />
                </button>
              </div>
            </div>
            {renderPanelBody(activePanel.id)}
          </div>
        </>
      )}

      {/* ══ Right action icon rail ══ */}
      <aside className="tamam-right-rail no-print" aria-label="Chart workspace panels">
        {[...railPanels, ...railRoleFormPanels(currentUser?.role)].map(panel => (
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

    </div>
  );
}

/** Holds one history entry while its workspace is open (history-layer.ts). */
function WorkspaceBackLayer({ onBack }: { onBack: () => void }) {
  useHistoryLayer(true, onBack);
  return null;
}
