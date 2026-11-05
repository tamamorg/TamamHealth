'use client';
import { useMemo } from 'react';
import { activeCountry, usesAddressLists } from '@/lib/country/country-pack';
import { IDENTITY_DOCUMENT_TYPES } from '@/lib/country/patient-identity';
import { worldCountries } from '@/lib/country/world-lists';
import type { PatientDoc } from '@/lib/db-types';
import FormSlider from '@/components/overlay/FormSlider';
import { toIsoDate } from '@/lib/date-utils';
import { locationLabel, states as SOUTH_SUDAN_STATES, tribes } from '@/lib/data/south-sudan-reference';
import Select from '@/components/Select';
import type { Dispatch, SetStateAction } from 'react';
export interface PatientEditForm {
  firstName: string; middleName: string; surname: string; phone: string;
  state: string; county: string; payam: string; boma: string; tribe: string;
  dateOfBirth: string; gender: PatientDoc['gender']; email: string;
  residenceCountry: string; citizenship: string;
  idType: string; idNumber: string; idCountry: string;
}

export default function PatientEditModal({ editSubmitting, setShowEditModal, editForm, setEditForm, editErrors, setEditErrors, t, editCounties, editPayams, editBomas, handleEditSubmit }: {
  editSubmitting: boolean;
  setShowEditModal: Dispatch<SetStateAction<boolean>>;
  editForm: PatientEditForm;
  setEditForm: Dispatch<SetStateAction<PatientEditForm>>;
  editErrors: Record<string, string>;
  setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  editCounties: string[];
  editPayams: string[];
  editBomas: string[];
  handleEditSubmit: () => Promise<void>;
}) {
  const pack = activeCountry();
  const listed = usesAddressLists(editForm.residenceCountry);
  const countries = useMemo(() => worldCountries(), []);
  return (
    <FormSlider
      title={t('ptDetail.editDemographics')}
      width={600}
      busy={editSubmitting}
      onClose={() => setShowEditModal(false)}
      footer={<>
        <button type="button" onClick={() => setShowEditModal(false)} className="btn btn-secondary" disabled={editSubmitting}>{t('action.cancel')}</button>
        <button type="button" onClick={handleEditSubmit} className="btn btn-primary" disabled={editSubmitting}>
          {editSubmitting ? 'Saving…' : 'Save changes'}
        </button>
      </>}
    >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-first-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.firstName')}</label>
                  <input id="edit-first-name" type="text" value={editForm.firstName} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-middle-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.middleName')}</label>
                  <input id="edit-middle-name" type="text" value={editForm.middleName} onChange={e => setEditForm({ ...editForm, middleName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-surname" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.surname')}</label>
                  <input id="edit-surname" type="text" value={editForm.surname} onChange={e => setEditForm({ ...editForm, surname: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {/* Capped at today — registration already does this, and a
                      future date of birth is never a correction. */}
                  <label htmlFor="edit-dob" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('births.dateOfBirth')}</label>
                  <input id="edit-dob" type="date" max={toIsoDate(new Date())} value={editForm.dateOfBirth} onChange={e => setEditForm({ ...editForm, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-gender" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('deaths.gender')}</label>
                  <Select id="edit-gender" value={editForm.gender} onChange={e => setEditForm({ ...editForm, gender: e.target.value as 'Male' | 'Female' })}>
                    <option value="Male">{t('deaths.male')}</option>
                    <option value="Female">{t('deaths.female')}</option>
                    <option value="Other">{t('patient.other')}</option>
                    <option value="Unknown">{t('patient.unknown')}</option>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-phone" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('noteEditor.type.phone')}</label>
                  <input id="edit-phone" type="tel" value={editForm.phone} onChange={e => { setEditForm({ ...editForm, phone: e.target.value }); if (editErrors.phone) setEditErrors({}); }} aria-invalid={!!editErrors.phone} />
                  {editErrors.phone && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{editErrors.phone}</p>}
                </div>
                {(pack.asksTribe || editForm.tribe) && <div>
                  <label htmlFor="edit-tribe" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.tribe')}</label>
                  <Select id="edit-tribe" value={editForm.tribe} searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchTribes')}
                    onChange={e => setEditForm({ ...editForm, tribe: e.target.value })}>
                    <option value="">{t('patientNew.selectTribe')}</option>
                    {editForm.tribe && !tribes.some(option => option.value === editForm.tribe) && (
                      <option value={editForm.tribe}>{editForm.tribe}</option>
                    )}
                    {tribes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </div>}
              </div>
              {/* State/county are pick-lists, not free text: registration writes
                  from these same lists, and every geographic rollup (surveillance,
                  vital statistics, the ADM1 maps) joins on the exact name. A typo
                  typed here would quietly drop the patient out of their county.
                  A value already on the record that isn't in the list is kept as
                  an option so editing a phone number can't silently rewrite it. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-email" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.email')}</label>
                  <input id="edit-email" type="email" inputMode="email" value={editForm.email} onChange={e => { setEditForm({ ...editForm, email: e.target.value }); setEditErrors({ ...editErrors, email: '' }); }}  />
                  {editErrors.email && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{editErrors.email}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-country" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.residenceCountry')}</label>
                  <Select id="edit-country" value={editForm.residenceCountry} searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchCountries')}
                    onChange={e => setEditForm({ ...editForm, residenceCountry: e.target.value, state: '', county: '', payam: '', boma: '' })}>
                    {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-citizenship" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.citizenship')}</label>
                  <Select id="edit-citizenship" value={editForm.citizenship} searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchCountries')}
                    onChange={e => setEditForm({ ...editForm, citizenship: e.target.value })}>
                    <option value="">{t('patientNew.selectCountry')}</option>
                    {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </Select>
                </div>
              </div>
              {listed ? (<>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-state" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('births.colState')}</label>
                  <Select
                    id="edit-state"
                    value={editForm.state}
                    searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchLocations')}
                    onChange={e => setEditForm({ ...editForm, state: e.target.value, county: '', payam: '', boma: '' })}
                  >
                    <option value="">{t('ui.selectState')}</option>
                    {editForm.state && !SOUTH_SUDAN_STATES.includes(editForm.state) && (
                      <option value={editForm.state}>{editForm.state} {t('ui.onRecord')}</option>
                    )}
                    {SOUTH_SUDAN_STATES.map(s => <option key={s} value={s}>{locationLabel(s)}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-county" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('births.county')}</label>
                  <Select
                    id="edit-county"
                    value={editForm.county}
                    searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchLocations')}
                    onChange={e => setEditForm({ ...editForm, county: e.target.value, payam: '', boma: '' })}
                    disabled={!editForm.state}
                  >
                    <option value="">{editForm.state ? 'Select county…' : 'Select a state first'}</option>
                    {editForm.county && !editCounties.includes(editForm.county) && (
                      <option value={editForm.county}>{editForm.county} {t('ui.onRecord')}</option>
                    )}
                    {editCounties.map(c => <option key={c} value={c}>{locationLabel(c)}</option>)}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-payam" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.payam')}</label>
                  <Select id="edit-payam" value={editForm.payam} disabled={!editForm.county}
                    searchThreshold={0} searchPlaceholder={t('patientNew.searchLocations')}
                    onChange={e => setEditForm({ ...editForm, payam: e.target.value, boma: '' })}>
                    <option value="">{editForm.county ? t('patientNew.selectPayam') : t('patientNew.selectCountyFirst')}</option>
                    {editForm.payam && !editPayams.includes(editForm.payam) && (
                      <option value={editForm.payam}>{editForm.payam}</option>
                    )}
                    {editPayams.map(payam => <option key={payam} value={payam}>{locationLabel(payam)}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-boma" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.boma')}</label>
                  <Select id="edit-boma" value={editForm.boma} disabled={!editForm.payam}
                    searchThreshold={0} searchPlaceholder={t('patientNew.searchLocations')}
                    onChange={e => setEditForm({ ...editForm, boma: e.target.value })}>
                    <option value="">{editForm.payam ? t('patientNew.selectBoma') : t('patientNew.selectPayamFirst')}</option>
                    {editForm.boma && !editBomas.includes(editForm.boma) && (
                      <option value={editForm.boma}>{editForm.boma}</option>
                    )}
                    {editBomas.map(boma => <option key={boma} value={boma}>{locationLabel(boma)}</option>)}
                  </Select>
                </div>
              </div>
              </>) : (<>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-region" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.region')}</label>
                  <input id="edit-region" type="text" value={editForm.state} onChange={e => setEditForm({ ...editForm, state: e.target.value })}  />
                </div>
                <div>
                  <label htmlFor="edit-district" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.district')}</label>
                  <input id="edit-district" type="text" value={editForm.county} onChange={e => setEditForm({ ...editForm, county: e.target.value })}  />
                </div>
              </div>
              </>)}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-id-type" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.idType')}</label>
                  <Select id="edit-id-type" value={editForm.idType} onChange={e => setEditForm({ ...editForm, idType: e.target.value })}>
                    <option value="">{t('patientNew.selectIdType')}</option>
                    {IDENTITY_DOCUMENT_TYPES.map(type => <option key={type} value={type}>{t(`idType.${type}`)}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-id-number" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.idNumber')}</label>
                  <input id="edit-id-number" type="text" value={editForm.idNumber} onChange={e => setEditForm({ ...editForm, idNumber: e.target.value })}  />
                </div>
                <div>
                  <label htmlFor="edit-id-country" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.idCountry')}</label>
                  <Select id="edit-id-country" value={editForm.idCountry} searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchCountries')}
                    onChange={e => setEditForm({ ...editForm, idCountry: e.target.value })}>
                    <option value="">{t('patientNew.selectCountry')}</option>
                    {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </Select>
                </div>
              </div>
            </div>
    </FormSlider>
  );
}
