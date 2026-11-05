'use client';

/**
 * A birth or death register entry, opened in a slider from its row (they used
 * to unfold in place under the row). The footer prints the paper the facility
 * issues for it: the Notification of Birth, or the WHO Medical Certificate of
 * Cause of Death (lib/vital-certificates.ts).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { FileText, Printer } from '@/components/icons/lucide';
import type { BirthRegistrationDoc, DeathRegistrationDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { printDate } from '@/lib/print-identity';
import { printBirthNotification, printDeathCertificate } from '@/lib/vital-certificates';
import './vital-record.css';

function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'is-wide' : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const shown = (value: unknown, fallback: string) =>
  value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);

const capital = (value?: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : '');

export function BirthRecordSlider({ birth, motherChartId, onClose }: {
  birth: BirthRegistrationDoc;
  /** The mother's chart, when she is a registered patient. */
  motherChartId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const none = t('vital.notRecorded');
  const child = [birth.childFirstName, birth.childSurname].filter(Boolean).join(' ');
  return (
    <FormSlider
      title={child || t('vital.birthRecord')}
      subtitle={`${t('vital.notificationNo')} ${birth.certificateNumber}`}
      width={560}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('vital.close')}</button>
        <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={() => printBirthNotification(birth)}>
          <Printer className="w-4 h-4" /> {t('vital.printBirthNotification')}
        </button>
      </>}
    >
      <div className="vr-detail">
        <section className="vr-section">
          <h3>{t('vital.child')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.sex')}>{birth.childGender}</Fact>
            <Fact label={t('vital.dateOfBirth')}>{printDate(birth.dateOfBirth) || none}</Fact>
            <Fact label={t('vital.birthWeight')}>{birth.birthWeight ? `${birth.birthWeight} g` : none}</Fact>
            <Fact label={t('vital.birthType')}>{capital(birth.birthType) || none}</Fact>
            <Fact label={t('vital.delivery')}>{capital(birth.deliveryType) || none}</Fact>
            <Fact label={t('vital.attendedBy')}>{shown(birth.attendedBy, none)}</Fact>
          </dl>
        </section>

        <section className="vr-section">
          <h3>{t('vital.placeOfBirth')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.facility')} wide>{shown(birth.placeOfBirth || birth.facilityName, none)}</Fact>
            <Fact label={t('vital.county')}>{shown(birth.county, none)}</Fact>
            <Fact label={t('vital.state')}>{shown(birth.state, none)}</Fact>
          </dl>
        </section>

        <section className="vr-section">
          <h3>{t('vital.parents')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.mother')}>
              {motherChartId ? <Link href={`/patients/${motherChartId}`}>{birth.motherName}</Link> : shown(birth.motherName, none)}
            </Fact>
            <Fact label={t('vital.motherAgeNationality')}>
              {[birth.motherAge ? t('vital.ageYears', { count: birth.motherAge }) : '', birth.motherNationality].filter(Boolean).join(' · ') || none}
            </Fact>
            <Fact label={t('vital.father')}>{shown(birth.fatherName, none)}</Fact>
            <Fact label={t('vital.fatherNationality')}>{birth.fatherName ? shown(birth.fatherNationality, none) : none}</Fact>
          </dl>
        </section>

        <section className="vr-section">
          <h3>{t('vital.register')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.notificationNo')}>{birth.certificateNumber}</Fact>
            <Fact label={t('vital.recordedBy')}>{shown(birth.registeredBy, none)}</Fact>
          </dl>
          <p className="vr-paper">
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>
              <strong>{t('vital.birthPaperTitle')}</strong>
              {t('vital.birthPaperHint')}
            </span>
          </p>
        </section>
      </div>
    </FormSlider>
  );
}

export function DeathRecordSlider({ death, onClose }: {
  death: DeathRegistrationDoc;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const none = t('vital.notRecorded');
  const name = [death.deceasedFirstName, death.deceasedSurname].filter(Boolean).join(' ');
  const chain = [
    { line: 'a', cause: death.immediateCause, code: death.immediateICD11 },
    { line: 'b', cause: death.antecedentCause1, code: death.antecedentICD11_1 },
    { line: 'c', cause: death.antecedentCause2, code: death.antecedentICD11_2 },
    { line: 'd', cause: death.underlyingCause, code: death.underlyingICD11 },
  ].filter(step => step.cause?.trim());
  const status = death.deathRegistered ? t('vital.statusRegistered') : death.deathNotified ? t('vital.statusNotified') : t('vital.statusNotNotified');
  return (
    <FormSlider
      title={name || t('vital.deathRecord')}
      subtitle={`${t('vital.certificateNo')} ${death.certificateNumber}`}
      width={560}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('vital.close')}</button>
        <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={() => printDeathCertificate(death)}>
          <Printer className="w-4 h-4" /> {t('vital.printDeathCertificate')}
        </button>
      </>}
    >
      <div className="vr-detail">
        <section className="vr-section">
          <h3>{t('vital.deceased')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.sex')}>{death.deceasedGender}</Fact>
            <Fact label={t('vital.ageAtDeath')}>{death.ageAtDeath < 1 ? t('deaths.neonate') : t('vital.ageYears', { count: death.ageAtDeath })}</Fact>
            <Fact label={t('vital.dateOfBirth')}>{printDate(death.dateOfBirth) || none}</Fact>
            <Fact label={t('vital.dateOfDeath')}>{printDate(death.dateOfDeath) || none}</Fact>
            <Fact label={t('vital.placeOfDeath')} wide>{shown(death.placeOfDeath || death.facilityName, none)}</Fact>
            <Fact label={t('vital.county')}>{shown(death.county, none)}</Fact>
            <Fact label={t('vital.state')}>{shown(death.state, none)}</Fact>
            {death.patientId && (
              <Fact label={t('vital.chart')} wide><Link href={`/patients/${death.patientId}?tab=history`}>{t('vital.openChart')}</Link></Fact>
            )}
          </dl>
        </section>

        <section className="vr-section">
          <h3>{t('vital.causeOfDeath')}</h3>
          {chain.length > 0 ? (
            <ol className="vr-chain">
              {chain.map((step, i) => (
                <li key={step.line}>
                  <span className="vr-line">{step.line}</span>
                  <span>{i > 0 && <span className="vr-due">{t('vital.dueTo')}</span>}{step.cause}</span>
                  {step.code ? <code>{step.code}</code> : <span />}
                </li>
              ))}
            </ol>
          ) : <p className="vr-paper">{none}</p>}
          {death.contributingConditions && (
            <dl className="vr-facts">
              <Fact label={t('vital.contributing')} wide>
                {death.contributingConditions}{death.contributingICD11 ? ` (${death.contributingICD11})` : ''}
              </Fact>
            </dl>
          )}
        </section>

        <section className="vr-section">
          <h3>{t('vital.certification')}</h3>
          <dl className="vr-facts">
            <Fact label={t('vital.manner')}>{capital(death.mannerOfDeath) || none}</Fact>
            <Fact label={t('vital.maternal')}>{death.maternalDeath ? t('deaths.yes') : t('deaths.no')}</Fact>
            <Fact label={t('vital.certifiedBy')}>{[death.certifiedBy, death.certifierRole].filter(Boolean).join(' · ') || none}</Fact>
            <Fact label={t('vital.registerStatus')}>{status}</Fact>
          </dl>
          <p className="vr-paper">
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>
              <strong>{t('vital.deathPaperTitle')}</strong>
              {t('vital.deathPaperHint')}
            </span>
          </p>
        </section>
      </div>
    </FormSlider>
  );
}
