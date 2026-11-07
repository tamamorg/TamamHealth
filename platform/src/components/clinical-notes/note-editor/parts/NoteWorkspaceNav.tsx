import { Copy, Send, ClipboardList, DollarSign, Plus, ChevronLeft, ChevronRight } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** The workspace layout's section list, with its collapse toggle and the "more" actions. */
export function NoteWorkspaceNav({
  groups, workspaceGroup, navCollapsed, locked, saving, showAddSection, showCopyForward,
  onToggleNav, onGoToGroup, onAddSection, onCopyForward, onCoordination, onCarePlan,
  onCaptureCharge, onClear,
}: {
  groups: Array<{ id: string; label: string }>;
  workspaceGroup: string;
  navCollapsed: boolean;
  locked: boolean;
  saving: boolean;
  /** optionalAvailable.length > 0 */
  showAddSection: boolean;
  /** a copy-forward source exists */
  showCopyForward: boolean;
  onToggleNav: () => void;
  onGoToGroup: (id: string) => void;
  onAddSection: () => void;
  onCopyForward: () => void;
  onCoordination: () => void;
  onCarePlan: () => void;
  onCaptureCharge: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="omf-nav" aria-label={t('noteEditor.sections')}>
      <button
        type="button"
        className="omf-nav-toggle"
        aria-expanded={!navCollapsed}
        title={navCollapsed ? t('noteEditor.showSections') : t('noteEditor.hideSections')}
        aria-label={navCollapsed ? t('noteEditor.showSections') : t('noteEditor.hideSections')}
        onClick={onToggleNav}
      >
        {navCollapsed ? <ChevronRight size={16} aria-hidden /> : <><ChevronLeft size={16} aria-hidden /> {t('noteEditor.hideSections')}</>}
      </button>
      {!navCollapsed && groups.map(g => (
        <button
          key={g.id}
          type="button"
          className={workspaceGroup === g.id ? 'omf-nav-item is-active' : 'omf-nav-item'}
          aria-current={workspaceGroup === g.id ? 'true' : undefined}
          onClick={() => onGoToGroup(g.id)}
        >
          <span className="tamam-reg-navarrow" aria-hidden>↳</span>
          <span>{g.label}</span>
        </button>
      ))}
      {!navCollapsed && !locked && showAddSection && (
        <button type="button" className="omf-nav-add" onClick={onAddSection}>
          <Plus size={14} aria-hidden /> {t('noteEditor.addSection')}
        </button>
      )}
      <div className="omf-nav-more" hidden={navCollapsed}>
        {!locked && showCopyForward && (
          <button type="button" onClick={onCopyForward} disabled={saving}><Copy size={13} aria-hidden /> {t('noteEditor.copyForward')}</button>
        )}
        <button type="button" onClick={onCoordination}><Send size={13} aria-hidden /> {t('noteEditor.careCoordination')}</button>
        <button type="button" onClick={onCarePlan}><ClipboardList size={13} aria-hidden /> {t('noteEditor.carePlan')}</button>
        <button type="button" onClick={onCaptureCharge}><DollarSign size={13} aria-hidden /> {t('noteEditor.captureCharge')}</button>
        {!locked && <button type="button" onClick={onClear}>{t('noteEditor.clearNote')}</button>}
      </div>
    </nav>
  );
}
