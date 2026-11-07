import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** The addendum slider: a correction to a signed note, appended rather than edited in. */
export function AddendumSlider({ text, onTextChange, onClose, onSubmit }: {
  text: string;
  onTextChange: (text: string) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <FormSlider
      title={t('noteEditor.addendumTitle')}
      subtitle={t('noteEditor.addendumHelp')}
      width={520}
      onClose={onClose}
      footer={<>
          <button type="button" className="cn-btn" onClick={onClose}>{t('noteEditor.cancel')}</button>
          <button
            type="button"
            className="cn-btn cn-btn-primary"
            onClick={onSubmit}
            disabled={!text.trim()}
          >
            {t('noteEditor.addAddendum')}
          </button>
      </>}
    >
      <div className="space-y-4">
        <textarea
          className="cn-textarea"
          value={text}
          onChange={e => onTextChange(e.target.value)}
          placeholder={t('noteEditor.addendumPlaceholder')}
          aria-label={t('noteEditor.addendumText')}
        />
      </div>
    </FormSlider>
  );
}
