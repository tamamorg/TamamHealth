import { useRef, useState } from 'react';
import type { NoteSectionId } from '@/lib/clinical-notes/note-catalog';
import { NOTE_NAV_KEY } from './helpers';

/**
 * Navigation state of the note: the workspace layout's section list (current
 * group, collapsed rail, folded groups, scroll pane) and the active section
 * both layouts highlight.
 */
export function useNoteWorkspaceNav() {
  // Workspace layout: which group the section list marks as current, and
  // which groups the clinician has folded away.
  const [workspaceGroup, setWorkspaceGroup] = useState<string>('visit-details');
  // The workspace's section list can be folded away for more room to write;
  // the choice is kept for the next note. Read lazily: the editor only renders
  // in the browser, once the note has loaded.
  const [navCollapsed, setNavCollapsed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(NOTE_NAV_KEY) === '1');
  const toggleNav = () => setNavCollapsed(prev => {
    const next = !prev;
    try { window.localStorage.setItem(NOTE_NAV_KEY, next ? '1' : '0'); } catch { /* private mode: the toggle still works */ }
    return next;
  });
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(() => new Set());
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<NoteSectionId | null>(null);

  const toggleGroup = (id: string) => setFoldedGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const goToGroup = (id: string) => {
    setWorkspaceGroup(id);
    setFoldedGroups(prev => { const next = new Set(prev); next.delete(id); return next; });
    workspaceScrollRef.current?.querySelector(`[data-omf-group="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  // The section list follows the reader: the last group whose top has
  // passed the top of the scroll pane is the current one.
  const onWorkspaceScroll = (firstGroupId: string) => {
    const pane = workspaceScrollRef.current;
    if (!pane) return;
    const top = pane.getBoundingClientRect().top + 8;
    let current = firstGroupId;
    pane.querySelectorAll<HTMLElement>('[data-omf-group]').forEach(el => {
      if (el.getBoundingClientRect().top <= top) current = el.dataset.omfGroup || current;
    });
    if (current !== workspaceGroup) setWorkspaceGroup(current);
  };

  return {
    workspaceGroup, navCollapsed, toggleNav, foldedGroups, workspaceScrollRef,
    activeSection, setActiveSection, toggleGroup, goToGroup, onWorkspaceScroll,
  };
}
