'use client';
import type { ChartVitalsLike } from './chart-constants';
import { formatPrintedAt, printDate } from '@/lib/print-identity';
import { patientFullName, patientAgeLabel } from '@/lib/patient-utils';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, MedicalRecordDoc, PatientDoc, PrescriptionDoc, ProblemDoc } from '@/lib/db-types';
import { PrintSectionId } from './chart-constants';
import type { HospitalDoc } from '@/lib/db-types';
import type { AppUser } from '@/lib/context/types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { roleLabel } from '@/lib/role-display';
export default function PatientPrintDocument({ patient, patientProblems, allPrescriptions, allLabResults, allImmunizations, patientAppointments, regHospital, printSections, latestRecord, latestVitals, printSignature, currentUser }: {
  patient: PatientDoc;
  patientProblems: ProblemDoc[];
  allPrescriptions: PrescriptionDoc[];
  allLabResults: LabResultDoc[];
  allImmunizations: ImmunizationDoc[];
  patientAppointments: AppointmentDoc[];
  regHospital: HospitalDoc | undefined;
  printSections: Set<PrintSectionId>;
  latestRecord: MedicalRecordDoc | undefined;
  latestVitals: ChartVitalsLike | undefined;
  printSignature: string;
  currentUser: AppUser | null;
}) {
  const { t } = useTranslation();
            const activeAllergies = (patient.structuredAllergies || []).filter((a: { status: string }) => a.status === 'active');
            const legacyAllergies = !patient.structuredAllergies ? (patient.allergies || []).filter(Boolean) : [];
            const activeProblems = patientProblems.filter(p => p.status === 'active' || p.status === 'chronic');
            // "Current" = anything not stopped, matching the Medications tab
            // and the facesheet. Excluding dispensed left the printed sheet —
            // the copy the patient walks out with — missing exactly the drugs
            // they had just collected and were actually taking.
            const currentMeds = (allPrescriptions || []).filter(rx => rx.patientId === patient._id && rx.status !== 'discontinued');
            const patientLabs = (allLabResults || []).filter(l => l.patientId === patient._id).slice(0, 12);
            const patientImms = (allImmunizations || []).filter(i => i.patientId === patient._id);
            const upcomingPrint = (patientAppointments || [])
              .filter(a => a.status !== 'cancelled' && a.status !== 'no_show' && new Date(`${a.appointmentDate}T${a.appointmentTime || '00:00'}`).getTime() >= Date.now())
              .sort((x, y) => `${x.appointmentDate}T${x.appointmentTime || '00:00'}`.localeCompare(`${y.appointmentDate}T${y.appointmentTime || '00:00'}`))[0];
            const printedAt = formatPrintedAt(new Date());
            // `registrationHospital` holds the facility ID, not its name — the
            // printed record was headed "hosp-001" instead of the hospital.
            // `regHospital` is the same lookup the Demographics tab already does.
            const printFacilityName = regHospital?.name || patient.registrationHospital || 'Tamam Facility';
            return (
              <div className="print-only print-doc-root">

                {/* ── Heading ── */}
                <div className="rx-header">
                  <div className="rx-header-left">
                    <div className="rx-logo-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/assets/tamam-icon.svg" alt="" />
                    </div>
                    <div className="rx-facility-name">{printFacilityName}</div>
                  </div>
                  <div className="rx-doc-label">
                    <div className="rx-doc-title">{t('ptDetail.printTitle')}</div>
                    <div className="rx-doc-meta">{printDate(new Date())}</div>
                  </div>
                </div>

                {/* ── Patient information ── */}
                <div className="rx-patient-banner">
                  <div className="rx-patient-name">{t('print.patientInformation')}</div>
                  <div className="rx-patient-grid">
                    <div className="rx-patient-field"><label>{t('print.patientName')}</label><span>{patientFullName(patient)}</span></div>
                    <div className="rx-patient-field"><label>{t('print.patientId')}</label><span>{patient.hospitalNumber || patient.geocodeId || '—'}</span></div>
                    <div className="rx-patient-field"><label>{t('births.dateOfBirth')}</label><span>{printDate(patient.dateOfBirth) || '—'}</span></div>
                    <div className="rx-patient-field"><label>{t('labOrder.fieldAgeSex')}</label><span>{patientAgeLabel(patient)} · {patient.gender || '—'}</span></div>
                    <div className="rx-patient-field"><label>{t('print.phone')}</label><span>{patient.phone || '—'}</span></div>
                    <div className="rx-patient-field"><label>{t('ptDetail.printStateCounty')}</label><span>{patient.state || '—'}{patient.county ? ` · ${patient.county}` : ''}</span></div>
                    <div className="rx-patient-field"><label>{t('anc.bloodGroup')}</label><span>{(patient as unknown as Record<string, string>).bloodGroup || '—'}</span></div>
                    {patient.nationalId && <div className="rx-patient-field"><label>{t('print.nationalId')}</label><span>{patient.nationalId}</span></div>}
                  </div>
                </div>

                {/* ── Document body ── */}
                <div className="rx-body">

                  {/* Consultation Note */}
                  {printSections.has('consultation') && latestRecord && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('ptDetail.printConsultationNote')}</div>
                      <div className="rx-section-body">
                        <div className="rx-two-col" style={{ marginBottom: 6 }}>
                          <div className="rx-field"><b>Date:</b> {formatPrintedAt(new Date(latestRecord.consultedAt || latestRecord.visitDate)).slice(0, 16)}</div>
                          <div className="rx-field"><b>Visit type:</b> {latestRecord.visitType}</div>
                          <div className="rx-field"><b>Provider:</b> {latestRecord.providerName}</div>
                          <div className="rx-field"><b>Department:</b> {latestRecord.department}</div>
                        </div>
                        {latestRecord.chiefComplaint && <div className="rx-field"><b>Chief complaint:</b> {latestRecord.chiefComplaint}</div>}
                        {latestRecord.historyOfPresentIllness && <div className="rx-field" style={{ marginTop: 4 }}><b>History of present illness:</b> {latestRecord.historyOfPresentIllness}</div>}
                        {latestRecord.physicalExamination && Object.entries(latestRecord.physicalExamination).filter(([, v]) => v).length > 0 && (
                          <div className="rx-field" style={{ marginTop: 4 }}>
                            <b>Physical examination:</b>{' '}
                            {Object.entries(latestRecord.physicalExamination)
                              .filter(([, v]) => v)
                              .map(([sys, v]) => `${sys.charAt(0).toUpperCase()}${sys.slice(1)}: ${v}`)
                              .join('; ')}
                          </div>
                        )}
                        {latestRecord.treatmentPlan && <div className="rx-field" style={{ marginTop: 4 }}><b>Treatment plan:</b> {latestRecord.treatmentPlan}</div>}
                      </div>
                    </div>
                  )}

                  {/* Diagnoses + Active Problems side by side */}
                  {printSections.has('problems') && <div className="rx-two-col">
                    {latestRecord?.diagnoses && latestRecord.diagnoses.length > 0 && (
                      <div className="rx-section">
                        <div className="rx-section-title">Diagnoses (This Visit)</div>
                        <div className="rx-section-body">
                          {latestRecord.diagnoses.map((d, i) => (
                            <div key={i} className="rx-dx-row">
                              {d.icd10Code && <span className="rx-dx-code">{d.icd10Code}</span>}
                              <span className="rx-dx-name">{d.name}</span>
                              {d.type && <span className="rx-dx-type">{d.type}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {activeProblems.length > 0 && (
                      <div className="rx-section">
                        <div className="rx-section-title">{t('ptDetail.printProblemList')}</div>
                        <div className="rx-section-body">
                          {activeProblems.map(p => (
                            <div key={p._id} className="rx-dx-row">
                              {(p.icd10Code || p.icd11Code) && <span className="rx-dx-code">{p.icd10Code || p.icd11Code}</span>}
                              <span className="rx-dx-name">{p.name}</span>
                              {p.status === 'chronic' && <span className="rx-dx-type">chronic</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>}

                  {/* Vital Signs */}
                  {printSections.has('vitals') && latestVitals && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('consultation.sectionVitalSigns')}</div>
                      <div className="rx-section-body">
                        <div className="rx-patient-grid">
                          {latestVitals.systolic && <div className="rx-patient-field"><label>{t('vitals.bloodPressure')}</label><span>{latestVitals.systolic}/{latestVitals.diastolic} mmHg</span></div>}
                          {latestVitals.pulse && <div className="rx-patient-field"><label>{t('print.pulse')}</label><span>{latestVitals.pulse} beats/min</span></div>}
                          {latestVitals.temperature && <div className="rx-patient-field"><label>{t('print.temperature')}</label><span>{latestVitals.temperature} °C</span></div>}
                          {latestVitals.weight && <div className="rx-patient-field"><label>{t('print.weight')}</label><span>{latestVitals.weight} kg</span></div>}
                          {latestVitals.oxygenSaturation && <div className="rx-patient-field"><label>{t('print.spo2')}</label><span>{latestVitals.oxygenSaturation} %</span></div>}
                          {latestVitals.respiratoryRate && <div className="rx-patient-field"><label>{t('print.respiratoryRate')}</label><span>{latestVitals.respiratoryRate} breaths/min</span></div>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Prescriptions */}
                  {printSections.has('medications') && currentMeds.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">Prescriptions</div>
                      <div className="rx-section-body">
                        {currentMeds.map((rx, i) => (
                          <div key={rx._id} className="rx-row" style={{ display: 'flex', gap: 12 }}>
                            <span style={{ minWidth: 18, color: '#6b7f96', fontSize: '7.5pt', paddingTop: 1 }}>{i + 1}.</span>
                            <span><b>{rx.medication}</b></span>
                            <span style={{ color: '#555' }}>{rx.dose} · {rx.frequency}{rx.duration ? ` · ${rx.duration}` : ''}{rx.route ? ` · ${rx.route}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Allergies */}
                  {printSections.has('allergies') && (activeAllergies.length > 0 || legacyAllergies.length > 0) && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('print.allergies')}</div>
                      <div className="rx-section-body">
                        {activeAllergies.map((a: { id: string; substance: string; criticality?: string; classification?: string; reaction?: string }) => (
                          <div key={a.id} className="rx-allergy-row">
                            {a.criticality && (
                              <span className={`rx-allergy-sev ${a.criticality.toLowerCase()}`}>{a.criticality}</span>
                            )}
                            <b>{a.substance}</b>
                            {a.classification && <span style={{ color: '#555', fontSize: '8pt' }}>{a.classification}</span>}
                            {a.reaction && <span style={{ color: '#555', fontSize: '8pt' }}>— Reaction: {a.reaction}</span>}
                          </div>
                        ))}
                        {legacyAllergies.map((a: string, i: number) => (
                          <div key={i} className="rx-allergy-row"><b>{a}</b></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lab Results */}
                  {printSections.has('labs') && patientLabs.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('ptDetail.printLabResults')}</div>
                      <div className="rx-section-body">
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                          <thead>
                            <tr style={{ background: 'var(--color-slate-50)' }}>
                              <th style={{ textAlign: 'start', padding: '3pt 8pt', borderBottom: '1pt solid #cfd6dd', fontWeight: 700 }}>Test</th>
                              <th style={{ textAlign: 'start', padding: '3pt 8pt', borderBottom: '1pt solid #cfd6dd', fontWeight: 700 }}>Result</th>
                              <th style={{ textAlign: 'start', padding: '3pt 8pt', borderBottom: '1pt solid #cfd6dd', fontWeight: 700 }}>Unit</th>
                              <th style={{ textAlign: 'start', padding: '3pt 8pt', borderBottom: '1pt solid #cfd6dd', fontWeight: 700 }}>Reference</th>
                              <th style={{ textAlign: 'start', padding: '3pt 8pt', borderBottom: '1pt solid #cfd6dd', fontWeight: 700 }}>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {patientLabs.map((l, i) => (
                              <tr key={i} style={{ borderBottom: '0.5pt solid #e2e6eb', background: l.abnormal ? '#fceeed' : 'transparent' }}>
                                <td style={{ padding: '3pt 8pt', fontWeight: 600 }}>{l.testName}</td>
                                <td style={{ padding: '3pt 8pt', color: l.abnormal ? '#d92b20' : '#001d3f', fontWeight: l.abnormal ? 700 : 400 }}>{l.result}{l.abnormal ? ' ↑' : ''}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{l.unit || '—'}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{l.referenceRange || '—'}</td>
                                <td style={{ padding: '3pt 8pt', color: '#555' }}>{printDate(l.completedAt || l.orderedAt || l.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Immunizations */}
                  {printSections.has('immunizations') && patientImms.length > 0 && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('ptDetail.printImmunizationRecord')}</div>
                      <div className="rx-section-body">
                        <div className="rx-three-col">
                          {patientImms.map((im, i) => (
                            <div key={i} className="rx-row" style={{ borderBottom: 'none', paddingBottom: 2 }}>
                              <b>{im.vaccine}</b>{im.doseNumber ? ` (Dose ${im.doseNumber})` : ''}<br />
                              <span style={{ color: '#555', fontSize: '7.5pt' }}>{printDate(im.dateGiven)}{im.batchNumber ? ` · Batch: ${im.batchNumber}` : ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Next Appointment */}
                  {printSections.has('appointments') && upcomingPrint && (
                    <div className="rx-section">
                      <div className="rx-section-title">{t('patientPortal.nextAppointment')}</div>
                      <div className="rx-section-body rx-two-col">
                        <div className="rx-field"><b>Date &amp; Time:</b> {upcomingPrint.appointmentDate}{upcomingPrint.appointmentTime ? ` ${upcomingPrint.appointmentTime}` : ''}</div>
                        {upcomingPrint.reason && <div className="rx-field"><b>Reason:</b> {upcomingPrint.reason}</div>}
                        {upcomingPrint.providerName && <div className="rx-field"><b>Provider:</b> {upcomingPrint.providerName}</div>}
                        <div className="rx-field"><b>Facility:</b> {printFacilityName}</div>
                      </div>
                    </div>
                  )}

                  {/* Signature block */}
                  <div className="rx-sig-block">
                    <div>
                      <div className="rx-sig-label">{t('ptDetail.printClinicianSignature')}</div>
                      <div className="rx-sig-line" />
                      <div className="rx-sig-name">{printSignature}</div>
                      <div className="rx-sig-role">{currentUser?.role ? roleLabel(currentUser.role) : ''}</div>
                      <div className="rx-sig-role">Signed: {printedAt}</div>
                    </div>
                    <div>
                      <div className="rx-sig-label">{t('ptDetail.printGuardianSignature')}</div>
                      <div className="rx-sig-line" />
                      <div className="rx-sig-role">Date: ______________________</div>
                      <div className="rx-sig-role" style={{ marginTop: 4 }}>Relationship: ______________</div>
                    </div>
                  </div>

                </div>{/* end rx-body */}

                {/* Fixed footer on every page */}
                <div className="rx-footer">
                  <span className="rx-footer-conf">CONFIDENTIAL — Patient Medical Record</span>
                  <span>Tamam · {patient.hospitalNumber || patient.geocodeId} · {printFacilityName}</span>
                  <span>Printed: {printedAt}</span>
                </div>

              </div>
            );
}
