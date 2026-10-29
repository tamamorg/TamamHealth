'use client';
import Modal from '@/components/Modal';
import { X } from '@/components/icons/lucide';
import { toIsoDate } from '@/lib/date-utils';
import { locationLabel, states as SOUTH_SUDAN_STATES, tribes } from '@/lib/data/south-sudan-reference';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientEditModal({ editSubmitting, setShowEditModal, editForm, setEditForm, editErrors, setEditErrors, t, editCounties, editPayams, editBomas, handleEditSubmit }: {
  editSubmitting: boolean;
  setShowEditModal: Dispatch<SetStateAction<boolean>>;
  editForm: { firstName: string; middleName: string; surname: string; phone: string; state: string; county: string; payam: string; boma: string; tribe: string; dateOfBirth: string; gender: "Male" | "Female"; };
  setEditForm: Dispatch<SetStateAction<{ firstName: string; middleName: string; surname: string; phone: string; state: string; county: string; payam: string; boma: string; tribe: string; dateOfBirth: string; gender: "Male" | "Female"; }>>;
  editErrors: Record<string, string>;
  setEditErrors: Dispatch<SetStateAction<Record<string, string>>>;
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  editCounties: string[];
  editPayams: string[];
  editBomas: string[];
  handleEditSubmit: () => Promise<void>;
}) {
  return (
        <Modal variant="slider" className="tamam-dialog" onClose={() => !editSubmitting && setShowEditModal(false)}>
          {/* No max-width here: Modal already sizes the dialog panel (600px) and
              paints it opaque, so a narrower child left ~90px of empty panel
              showing past the form's right edge. Matches the message modal above. */}
          <div className="modal-content card-elevated p-5 w-full" {...stopsClickPropagation}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{t('ptDetail.editDemographics')}</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="edit-first-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.firstName')}</label>
                  <input id="edit-first-name" type="text" value={editForm.firstName} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-middle-name" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('patientNew.middleName')}</label>
                  <input id="edit-middle-name" type="text" value={editForm.middleName} onChange={e => setEditForm({ ...editForm, middleName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-surname" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Surname</label>
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
                  <label htmlFor="edit-gender" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Gender</label>
                  <Select id="edit-gender" value={editForm.gender} onChange={e => setEditForm({ ...editForm, gender: e.target.value as 'Male' | 'Female' })}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-phone" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Phone</label>
                  <input id="edit-phone" type="tel" value={editForm.phone} onChange={e => { setEditForm({ ...editForm, phone: e.target.value }); if (editErrors.phone) setEditErrors({}); }} aria-invalid={!!editErrors.phone} />
                  {editErrors.phone && <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--color-danger-text)' }}>{editErrors.phone}</p>}
                </div>
                <div>
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
                </div>
              </div>
              {/* State/county are pick-lists, not free text: registration writes
                  from these same lists, and every geographic rollup (surveillance,
                  vital statistics, the ADM1 maps) joins on the exact name. A typo
                  typed here would quietly drop the patient out of their county.
                  A value already on the record that isn't in the list is kept as
                  an option so editing a phone number can't silently rewrite it. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-state" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>State</label>
                  <Select
                    id="edit-state"
                    value={editForm.state}
                    searchThreshold={0}
                    searchPlaceholder={t('patientNew.searchLocations')}
                    onChange={e => setEditForm({ ...editForm, state: e.target.value, county: '', payam: '', boma: '' })}
                  >
                    <option value="">Select state…</option>
                    {editForm.state && !SOUTH_SUDAN_STATES.includes(editForm.state) && (
                      <option value={editForm.state}>{editForm.state} (on record)</option>
                    )}
                    {SOUTH_SUDAN_STATES.map(s => <option key={s} value={s}>{locationLabel(s)}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor="edit-county" className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>County</label>
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
                      <option value={editForm.county}>{editForm.county} (on record)</option>
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
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowEditModal(false)} className="btn btn-sm btn-secondary" disabled={editSubmitting}>Cancel</button>
              <button onClick={handleEditSubmit} className="btn btn-sm btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
  );
}
