import { Check, ChevronRight } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import InlineBanner from '@/components/overlay/InlineBanner';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { sectionLabel } from '@/lib/clinical-notes/note-labels';
import type { NoteSectionId } from '@/lib/clinical-notes/note-catalog';

/** The sign confirmation: lists blank required sections, offers a co-sign request. */
export function SignConfirm({
  missingSections, cosignCandidates, cosignFromId, onCosignFromChange, onClose, onSign, onJumpToSection,
}: {
  missingSections: NoteSectionId[];
  cosignCandidates: Array<{ _id: string; name: string }>;
  cosignFromId: string;
  onCosignFromChange: (id: string) => void;
  onClose: () => void;
  onSign: () => void | Promise<void>;
  /** Pressing a missing section closes the dialog and scrolls the note to it. */
  onJumpToSection: (id: NoteSectionId) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal variant="slider" labelledBy="clinicalnoteeditor-tsx-dlg-1185" onClose={onClose} width={560}>
      <DialogFrame>
        <DialogHeader titleId="clinicalnoteeditor-tsx-dlg-1185" title={t('noteEditor.signTitle')} description={t('noteEditor.signBody')} onClose={onClose} />
        <DialogBody className="space-y-4">
        {missingSections.length > 0 && (
          <InlineBanner tone="danger" title={t('noteEditor.missingTitle')}>
            {/* Each missing section is the way to it: pressing one closes
                this dialog and scrolls the note to that section. */}
            <ul className="cn-sign-missing">
              {missingSections.map(id => (
                <li key={id}>
                  <button
                    type="button"
                    className="cn-sign-missing__link"
                    onClick={() => onJumpToSection(id)}
                  >
                    {sectionLabel(t, id)}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </InlineBanner>
        )}
        {missingSections.length === 0 && cosignCandidates.length > 0 && (
          <label className="cn-field" style={{ margin: '0 0 14px', display: 'block' }}>
            <span className="cn-label">{t('noteEditor.requestCosign')}</span>
            <Select
              className="cn-select"
              value={cosignFromId}
              onChange={e => onCosignFromChange(e.target.value)}
              aria-label={t('noteEditor.requestCosign')}
            >
              <option value="">{t('noteEditor.noCosign')}</option>
              {cosignCandidates.map(u => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
            </Select>
          </label>
        )}
        </DialogBody>
        <DialogFooter>
          <button type="button" className="cn-btn" onClick={onClose}>{t('noteEditor.cancel')}</button>
          <button
            type="button"
            className="cn-btn cn-btn-primary"
            onClick={onSign}
            disabled={missingSections.length > 0}
          >
            <Check size={14} /> {cosignFromId ? t('noteEditor.signRequestCosign') : t('noteEditor.signNote')}
          </button>
        </DialogFooter>
      </DialogFrame>
    </Modal>
  );
}
