'use client';

/**
 * New lab request — the lab's own front door. Everything a request needs on one
 * O3 form: who it is for (found, or registered here), who sent it, which tests,
 * and whether the specimen still has to be drawn. A clinician's order takes the
 * wizard; this is for the work that never saw one.
 */

import { useMemo, useState } from 'react';
import { X } from '@/components/icons/lucide';
import { ObfQuestion, ObfSection, ObfSelectField, ObfTextField } from '@/components/ehr/chart/panels/order-basket/ObfFields';
import FormNotices from '@/components/overlay/FormNotices';
import FormSlider from '@/components/overlay/FormSlider';
import { FormError } from '@/components/overlay/FormNotices';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { describeError } from '@/lib/user-facing-error';
import { countiesFor, languages, locationLabel, states } from '@/lib/data/south-sudan-reference';
import { RELATIONSHIP_OPTIONS } from '@/components/patients/registration/registration-form';
import LabOrderPatientPicker from './LabOrderPatientPicker';
import { catalogFor, searchCatalog, toOrderedTest } from './lab-order-catalog';
import type { OrderedTest } from './lab-order-types';
import { submitLabIntake, type LabRequestSource, type NewLabPatient } from './lab-intake';
import './lab-order.css';
import '@/components/lab/workflow/lab-workflow.css';

const EMPTY_PERSON: NewLabPatient = {
  firstName: '', surname: '', gender: '', dateOfBirth: '', estimatedAge: '', phone: '',
  state: '', county: '', primaryLanguage: '', nokName: '', nokRelationship: '', nokPhone: '',
};

export default function LabIntakeSlider({ presetPatientId, onClose, onPlaced }: {
  presetPatientId?: string;
  onClose: () => void;
  /** Opens the bench on the first test placed. */
  onPlaced: (firstOrderId: string, patientName: string) => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { patients } = usePatients();
  const { labCatalog } = useSettings();

  const [patientId, setPatientId] = useState(presetPatientId || '');
  const [registering, setRegistering] = useState(false);
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [source, setSource] = useState<LabRequestSource>('external_facility');
  const [facility, setFacility] = useState('');
  const [requester, setRequester] = useState('');
  const [reference, setReference] = useState('');
  const [testQuery, setTestQuery] = useState('');
  const [tests, setTests] = useState<OrderedTest[]>([]);
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [specimenState, setSpecimenState] = useState('collect_here');
  const [collectedAt, setCollectedAt] = useState('');
  const [collectedBy, setCollectedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    if (!testQuery.trim()) return [];
    const picked = new Set(tests.map(test => test.name));
    return searchCatalog(catalogFor(labCatalog, 'labs'), testQuery).filter(entry => !picked.has(entry.name)).slice(0, 6);
  }, [labCatalog, testQuery, tests]);

  const personReady = !!person.firstName.trim() && !!person.surname.trim() && !!person.gender
    && (!!person.dateOfBirth || !!person.estimatedAge)
    && !!person.state && !!person.county && !!person.primaryLanguage
    && !!person.nokName.trim() && !!person.nokRelationship && !!person.nokPhone.trim();
  const outside = source === 'external_facility';
  const ready = (registering ? personReady : !!patientId) && tests.length > 0 && (!outside || !!facility.trim());

  const save = async () => {
    if (!scope || !currentUser) return;
    setSaving(true);
    setError('');
    try {
      const { patient, receipt } = await submitLabIntake({
        patient: registering ? undefined : patients.find(p => p._id === patientId),
        newPatient: registering ? person : undefined,
        source, facility, requester, reference, tests, priority,
        arrivedCollected: specimenState === 'arrived', collectedAt, collectedBy, notes,
      }, currentUser, scope);
      onPlaced(receipt.createdIds[0], `${patient.firstName} ${patient.surname}`);
    } catch (err) {
      console.error('[lab-intake]', err);
      setError(describeError(err, t('labIntake.errSave')));
      setSaving(false);
    }
  };

  const patientBody = registering ? (<>
    <ObfTextField id="intake-first" label={t('labIntake.firstName')} required value={person.firstName} onChange={firstName => setPerson({ ...person, firstName })} />
    <ObfTextField id="intake-surname" label={t('labIntake.surname')} required value={person.surname} onChange={surname => setPerson({ ...person, surname })} />
    <ObfSelectField
      id="intake-gender" label={t('labIntake.gender')} required value={person.gender}
      options={[{ value: 'Male', label: t('labIntake.male') }, { value: 'Female', label: t('labIntake.female') }]}
      onChange={gender => setPerson({ ...person, gender })}
    />
    <ObfQuestion label={t('labIntake.dateOfBirth')} htmlFor="intake-dob">
      <input id="intake-dob" type="date" value={person.dateOfBirth} onChange={e => setPerson({ ...person, dateOfBirth: e.target.value })} />
    </ObfQuestion>
    <ObfTextField id="intake-age" label={t('labIntake.estimatedAge')} inputMode="numeric" value={person.estimatedAge} onChange={estimatedAge => setPerson({ ...person, estimatedAge })} />
    <ObfTextField id="intake-phone" label={t('labIntake.phone')} value={person.phone} onChange={phone => setPerson({ ...person, phone })} />
    <ObfSelectField
      id="intake-state" label={t('labIntake.state')} required value={person.state}
      options={states.map(state => ({ value: state, label: locationLabel(state) }))}
      onChange={state => setPerson({ ...person, state, county: '' })}
    />
    <ObfSelectField
      id="intake-county" label={t('labIntake.county')} required value={person.county} disabled={!person.state}
      options={countiesFor(person.state).map(county => ({ value: county, label: locationLabel(county) }))}
      onChange={county => setPerson({ ...person, county })}
    />
    <ObfSelectField
      id="intake-language" label={t('labIntake.language')} required value={person.primaryLanguage}
      options={languages.map(language => ({ value: language, label: language }))}
      onChange={primaryLanguage => setPerson({ ...person, primaryLanguage })}
    />
    <ObfTextField id="intake-nok-name" label={t('labIntake.nokName')} required value={person.nokName} onChange={nokName => setPerson({ ...person, nokName })} />
    <ObfSelectField
      id="intake-nok-relationship" label={t('labIntake.nokRelationship')} required value={person.nokRelationship}
      options={RELATIONSHIP_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))}
      onChange={nokRelationship => setPerson({ ...person, nokRelationship })}
    />
    <ObfTextField id="intake-nok-phone" label={t('labIntake.nokPhone')} required value={person.nokPhone} onChange={nokPhone => setPerson({ ...person, nokPhone })} />
    <button type="button" className="lab-intake-switch" onClick={() => setRegistering(false)}>{t('labIntake.findExisting')}</button>
  </>) : (<>
    <div className="lab-intake-matches-host" style={{ flex: '1 1 100%', minWidth: 0 }}>
      <LabOrderPatientPicker patients={patients} selectedId={patientId} onSelect={setPatientId} />
    </div>
    {!presetPatientId && !patientId && <button type="button" className="lab-intake-switch" onClick={() => setRegistering(true)}>{t('labIntake.registerNew')}</button>}
  </>);

  const sections = [
      { id: 'patient', label: t('labIntake.patient'), body: patientBody },
      {
        id: 'source',
        label: t('labIntake.source'),
        body: (<>
          <ObfSelectField
            id="intake-source" label={t('labIntake.sentBy')} value={source} placeholder={null}
            options={(['external_facility', 'walk_in', 'facility'] as const).map(value => ({ value, label: t(`labIntake.source_${value}`) }))}
            onChange={value => setSource(value as LabRequestSource)}
          />
          {outside && <ObfTextField id="intake-facility" label={t('labIntake.facility')} required value={facility} onChange={setFacility} />}
          {source !== 'walk_in' && <ObfTextField id="intake-requester" label={t('labIntake.requester')} value={requester} onChange={setRequester} />}
          {outside && <ObfTextField id="intake-reference" label={t('labIntake.reference')} value={reference} onChange={setReference} />}
        </>),
      },
      {
        id: 'tests',
        label: t('labIntake.tests'),
        body: (<>
          <ObfTextField id="intake-test" label={t('labIntake.findTest')} value={testQuery} onChange={setTestQuery} />
          {matches.length > 0 && (
            <ul className="lab-intake-matches">
              {matches.map(entry => (
                <li key={entry.name}>
                  <button type="button" onClick={() => { setTests([...tests, toOrderedTest(entry)]); setTestQuery(''); }}>{entry.name}</button>
                </li>
              ))}
            </ul>
          )}
          {tests.length > 0 && (
            <ul className="lab-intake-tests">
              {tests.map(test => (
                <li key={test.name}>
                  <span>{test.name}<small>{test.specimen}</small></span>
                  <button type="button" aria-label={t('action.remove')} onClick={() => setTests(tests.filter(other => other.name !== test.name))}><X aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
          <ObfSelectField
            id="intake-priority" label={t('labOrder.priority')} value={priority} placeholder={null}
            options={[
              { value: 'routine', label: t('appointments.priorityRoutine') },
              { value: 'urgent', label: t('appointments.priorityUrgent') },
              { value: 'stat', label: t('lab.priorityStat') },
            ]}
            onChange={value => setPriority(value as typeof priority)}
          />
        </>),
      },
      {
        id: 'specimen',
        label: t('labFlow.specimen'),
        body: (<>
          <ObfSelectField
            id="intake-specimen" label={t('labIntake.specimenState')} value={specimenState} placeholder={null}
            options={[
              { value: 'collect_here', label: t('labIntake.collectHere') },
              { value: 'arrived', label: t('labIntake.arrivedCollected') },
            ]}
            onChange={setSpecimenState}
          />
          {specimenState === 'arrived' && <>
            <ObfQuestion label={t('labFlow.collectedAt')} htmlFor="intake-collected-at">
              <input id="intake-collected-at" type="datetime-local" value={collectedAt} onChange={e => setCollectedAt(e.target.value)} />
            </ObfQuestion>
            <ObfTextField id="intake-collected-by" label={t('labFlow.collectedBy')} value={collectedBy} onChange={setCollectedBy} />
          </>}
          <ObfTextField id="intake-notes" label={t('labOrder.notesToLab')} multiline value={notes} onChange={setNotes} />
        </>),
      },
  ];

  return (
    <FormSlider title={t('labIntake.title')} className="tamam-dialog" width={560} flush busy={saving} onClose={onClose}>
      <div className="station-form-slider obk-root lwf lab-intake">
        <div className="obf-form">
          <div className="obf-form-body">
            <div className="obf-pad">
              {error && <FormError message={error} />}
              {sections.map(section => <ObfSection key={section.id} title={section.label}>{section.body}</ObfSection>)}
            </div>
          </div>
          <FormNotices />
          <div className="obk-footer">
            <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={saving} onClick={onClose}>{t('action.cancel')}</button>
            <button type="button" className="obk-footer-btn obk-footer-btn--primary lab-intake-save" disabled={saving || !ready} onClick={save}>{t('labIntake.save')}</button>
          </div>
        </div>
      </div>
    </FormSlider>
  );
}
