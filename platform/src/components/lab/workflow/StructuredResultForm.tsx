'use client';

import { useEffect, useMemo, useState } from 'react';
import Select from '@/components/Select';
import { CheckCircle2 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultProfile } from './lab-result-catalog';

export default function StructuredResultForm({
  profile,
  values,
  onChange,
}: {
  profile: LabResultProfile;
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const [activeSectionId, setActiveSectionId] = useState(profile.sections[0]?.id || '');

  useEffect(() => {
    setActiveSectionId(profile.sections[0]?.id || '');
  }, [profile.id, profile.sections[0]?.id]);

  const allFields = useMemo(() => profile.sections.flatMap(section => section.fields), [profile]);
  const completed = allFields.filter(field => values[field.id]?.trim()).length;
  const activeSection = profile.sections.find(section => section.id === activeSectionId) || profile.sections[0];

  if (!activeSection) return null;

  return (
    <div className="lab-result-workspace">
      <aside className="lab-result-nav" aria-label={t('labStructured.sections')}>
        <div className="lab-result-progress">
          <span>{t('labStructured.completion')}</span>
          <strong>{completed}/{allFields.length}</strong>
          <div className="lab-result-progress-track" aria-hidden>
            <span style={{ width: `${allFields.length ? (completed / allFields.length) * 100 : 0}%` }} />
          </div>
        </div>
        {profile.sections.map(section => {
          const sectionDone = section.fields.filter(field => values[field.id]?.trim()).length;
          const active = section.id === activeSection.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`lab-result-nav-item${active ? ' lab-result-nav-item--active' : ''}`}
              onClick={() => setActiveSectionId(section.id)}
              aria-current={active ? 'page' : undefined}
            >
              <span>{section.label}</span>
              <small>{sectionDone}/{section.fields.length}</small>
            </button>
          );
        })}
      </aside>

      <div className="lab-result-panel">
        <div className="lab-result-panel-head">
          <div>
            <strong>{activeSection.label}</strong>
            <span>{t('labStructured.enterOnlyReported')}</span>
          </div>
          {activeSection.fields.every(field => values[field.id]?.trim()) && (
            <CheckCircle2 className="w-4 h-4" aria-label={t('labStructured.sectionComplete')} />
          )}
        </div>
        <div className="lab-result-field-grid">
          {activeSection.fields.map(field => {
            const controlId = `lab-result-${field.id.replaceAll('.', '-')}`;
            return (
              <div key={field.id} className="lab-result-field">
                <label htmlFor={controlId}>{field.label}</label>
                <div className="lab-result-control">
                  {field.kind === 'select' ? (
                    <Select id={controlId} value={values[field.id] || ''} onChange={event => onChange(field.id, event.target.value)}>
                      <option value="">{t('labStructured.notReported')}</option>
                      {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  ) : (
                    <input
                      id={controlId}
                      type="text"
                      inputMode={field.kind === 'number' ? 'decimal' : 'text'}
                      value={values[field.id] || ''}
                      onChange={event => onChange(field.id, event.target.value)}
                      placeholder={field.kind === 'number' ? t('labStructured.enterValue') : t('labStructured.enterFinding')}
                    />
                  )}
                  {field.unit && <span className="lab-result-unit">{field.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
