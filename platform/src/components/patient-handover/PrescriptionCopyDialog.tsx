'use client';

/**
 * Give the patient their prescription — on paper, or as a text message.
 *
 * This is the handover for a script filled outside the facility (no
 * dispensary here, or the shelf could not fill it), and it doubles as the way
 * to give a patient a copy of any active order. It always works from the
 * SAVED prescription documents, so what the patient holds matches the chart.
 *
 * Each copy is recorded on the prescription. For an outside-pharmacy script
 * that record is what releases the order from the checkout gate; printing
 * records it at once, a text records it when the gateway accepts it.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useToast } from '@/components/Toast';
import { Printer, MessageSquare } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { PatientTextDialog } from '@/modules/communication/client';
import type { PatientDoc, PharmacyInventoryDoc, PrescriptionDoc } from '@/lib/db-types';
import { patientAgeLabel, patientDisplayName, patientFullName } from '@/lib/patient-utils';
import { formatRxSig } from '@/lib/format-utils';
import { openIsolatedHtmlWindow } from '@/lib/safe-html';
import { stockPositionFor } from '@/lib/pharmacy-stock-position';
import { isControlledMedicine } from '@/lib/data/formulary';
import {
  buildPrescriptionScriptHtml, buildPrescriptionText, canRerouteToOutsidePharmacy, scriptDate, scriptReference,
  scriptableOnly, type ScriptContext,
} from '@/lib/prescription-script';
import './patient-handover.css';

export interface PrescriptionCopyDialogProps {
  /** The orders to hand over — ticked when the dialog opens. */
  prescriptions: PrescriptionDoc[];
  /** Other active orders offered unticked, so one script can carry the visit. */
  alsoOffer?: PrescriptionDoc[];
  patientId: string;
  /** Used until the patient record loads, and if it cannot be read. */
  patientName: string;
  currentUser: {
    _id: string; name?: string; username?: string;
    orgId?: string; hospitalId?: string; hospitalName?: string;
  } | null;
  onClose: () => void;
  /** Fired after a copy is recorded or an order is re-routed. */
  onChanged?: () => void;
}

/** On-site orders that may still be sent out with the patient instead. */
function isReroutable(rx: PrescriptionDoc): boolean {
  return rx.fulfilment !== 'external' && canRerouteToOutsidePharmacy(rx);
}

export default function PrescriptionCopyDialog({
  prescriptions, alsoOffer, patientId, patientName, currentUser, onClose, onChanged,
}: PrescriptionCopyDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const settings = useSettings();
  const titleId = useId();
  const descId = useId();

  const [offered, setOffered] = useState<PrescriptionDoc[]>(() => {
    const chosen = scriptableOnly(prescriptions);
    const ids = new Set(chosen.map(rx => rx._id));
    return [...chosen, ...scriptableOnly(alsoOffer || []).filter(rx => !ids.has(rx._id))];
  });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(scriptableOnly(prescriptions).map(rx => rx._id)));
  /** The orders this handover acts on. */
  const items = useMemo(() => offered.filter(rx => picked.has(rx._id)), [offered, picked]);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [inventory, setInventory] = useState<PharmacyInventoryDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [texting, setTexting] = useState(false);
  // With no dispensary here every order leaves the building; otherwise the
  // prescriber says so per handover.
  const [outside, setOutside] = useState(!settings.clinicalPolicy.onSitePharmacy);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getPatientById } = await import('@/lib/services/patient-service');
        const doc = await getPatientById(patientId, scope);
        if (!cancelled) setPatient(doc);
      } catch { /* the script still prints with the name the caller gave */ }
      try {
        const { getAllInventory } = await import('@/lib/services/pharmacy-inventory-service');
        const lines = await getAllInventory(scope);
        if (!cancelled) setInventory(lines);
      } catch { /* nothing is known to be controlled; the prescriber decides */ }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  const userName = currentUser?.name || currentUser?.username || '';
  const facilityName = currentUser?.hospitalName || items[0]?.hospitalName || t('patientCopy.thisFacility');
  const reroutable = useMemo(() => items.filter(isReroutable), [items]);

  const context = useCallback((nameForText: boolean): ScriptContext => ({
    patient: {
      name: patient
        ? (nameForText ? patientDisplayName(patient) : patientFullName(patient))
        : patientName,
      hospitalNumber: patient?.hospitalNumber,
      ageLabel: patient ? patientAgeLabel(patient) : undefined,
      sex: patient?.gender,
      allergies: patient?.structuredAllergies
        ? patient.structuredAllergies.filter(a => a.status === 'active').map(a => a.substance)
        : patient?.allergies,
      preferredPharmacy: patient?.preferredPharmacy,
    },
    facilityName,
    prescriberName: items[0]?.prescribedBy || userName,
    issuedAt: new Date().toISOString(),
  }), [patient, patientName, facilityName, items, userName]);

  const isControlled = useCallback((rx: PrescriptionDoc) => {
    // The medicine's own class first: the shelf only knows what it stocks, and
    // the script is sent out precisely when the shelf has nothing — a facility
    // with no dispensary has no inventory at all, so every opioid read as
    // uncontrolled and could be texted.
    if (isControlledMedicine(rx.medication)) return true;
    const position = stockPositionFor(rx.medication, inventory, 1, { facilityId: rx.hospitalId });
    return Boolean(position.controlledSchedule) || position.requiresWitness;
  }, [inventory]);

  const text = useMemo(() => buildPrescriptionText(items, context(true), isControlled), [items, context, isControlled]);

  /** Re-read the orders so the copies just recorded show in the list. */
  const refresh = useCallback(async () => {
    try {
      const { getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
      const all = await getPrescriptionsByPatient(patientId, scope);
      const fresh = new Map(all.map(rx => [rx._id, rx]));
      setOffered(prev => scriptableOnly(prev.map(rx => fresh.get(rx._id) || rx)));
    } catch { /* the list keeps its last known state */ }
    onChanged?.();
  }, [patientId, scope, onChanged]);

  /**
   * Send the selected on-site orders out with the patient. `handedOver` limits
   * it to the orders the patient actually received a copy of: a text leaves
   * controlled medicines out, and re-routing those as well pulled them from
   * the pharmacy queue with no script in the patient's hand.
   */
  const applyReroute = useCallback(async (handedOver?: PrescriptionDoc[]) => {
    const given = handedOver ? new Set(handedOver.map(rx => rx._id)) : null;
    const targets = given ? reroutable.filter(rx => given.has(rx._id)) : reroutable;
    if (!outside || targets.length === 0) return;
    const { rerouteToOutsidePharmacy } = await import('@/lib/services/prescription-service');
    for (const rx of targets) {
      await rerouteToOutsidePharmacy(rx._id, { id: currentUser?._id, name: userName });
    }
  }, [outside, reroutable, currentUser?._id, userName]);

  const handlePrint = async () => {
    if (items.length === 0) return;
    setBusy(true);
    try {
      await applyReroute();
      openIsolatedHtmlWindow(buildPrescriptionScriptHtml(items, context(false)), '', true);
      const { recordPrescriptionPatientCopy } = await import('@/lib/services/prescription-service');
      const at = new Date().toISOString();
      for (const rx of items) {
        await recordPrescriptionPatientCopy(rx._id, {
          channel: 'print', at, byId: currentUser?._id, byName: userName,
        });
      }
      showToast(t('patientCopy.printed'), 'success');
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('patientCopy.printFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLine = (rx: PrescriptionDoc): string => (rx.patientCopies || [])
    .map(copy => t(copy.channel === 'sms' ? 'patientCopy.copyTexted' : 'patientCopy.copyPrinted', {
      date: scriptDate(copy.at), by: copy.byName, to: copy.to || '',
    }))
    .join(' · ');

  return (
    <>
      <Modal onClose={() => { if (!busy) onClose(); }} size="md" labelledBy={titleId} describedBy={descId}>
        <DialogFrame busy={busy}>
          <DialogHeader
            titleId={titleId}
            descriptionId={descId}
            title={t('patientCopy.title')}
            description={t('patientCopy.description', { name: patient ? patientFullName(patient) : patientName })}
            onClose={onClose}
          />
          <DialogBody>
            <div className="ph-stack">
              {!settings.clinicalPolicy.onSitePharmacy && (
                <InlineBanner tone="info" title={t('patientCopy.noPharmacyTitle')}>
                  {t('patientCopy.noPharmacyBody')}
                </InlineBanner>
              )}
              {offered.length === 0 ? (
                <InlineBanner tone="warning">{t('patientCopy.nothingActive')}</InlineBanner>
              ) : (
                <ul className="ph-list">
                  {offered.map(rx => (
                    <li key={rx._id}>
                      <div className="ph-item-head">
                        {offered.length > 1 ? (
                          <label className="ph-check">
                            <input
                              type="checkbox"
                              checked={picked.has(rx._id)}
                              onChange={e => setPicked(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(rx._id); else next.delete(rx._id);
                                return next;
                              })}
                            />
                            <span className="ph-item-name">{rx.medication}</span>
                          </label>
                        ) : (
                          <span className="ph-item-name">{rx.medication}</span>
                        )}
                        <span className="ph-item-ref">{scriptReference(rx)}</span>
                      </div>
                      <p className="ph-item-sig">{formatRxSig(rx)}</p>
                      <p className="ph-item-meta">
                        <span className="ph-tag" data-tone={rx.fulfilment === 'external' ? 'outside' : undefined}>
                          {rx.fulfilment === 'external'
                            ? t('patientCopy.tagOutside')
                            : t('patientCopy.tagOnSite', { facility: facilityName })}
                        </span>
                        {isControlled(rx) && <> <span className="ph-tag" data-tone="outside">{t('patientCopy.tagControlled')}</span></>}
                        {rx.patientCopies?.length ? <> <span className="ph-tag" data-tone="given">{copyLine(rx)}</span></> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {settings.clinicalPolicy.onSitePharmacy && reroutable.length > 0 && (
                <label className="ph-check">
                  <input type="checkbox" checked={outside} onChange={e => setOutside(e.target.checked)} />
                  <span>{t('patientCopy.outsideChoice')}</span>
                </label>
              )}
              {text.withheld.length > 0 && (
                <InlineBanner tone="warning" compact>
                  {t('patientCopy.controlledWithheld', { names: text.withheld.map(rx => rx.medication).join(', ') })}
                </InlineBanner>
              )}
            </div>
          </DialogBody>
          <DialogFooter note={t('patientCopy.footNote')}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              {t('action.close')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTexting(true)}
              disabled={busy || text.included.length === 0}
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> {t('patientCopy.text')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handlePrint()} disabled={busy || items.length === 0}>
              <Printer className="w-3.5 h-3.5" aria-hidden="true" /> {t('patientCopy.print')}
            </button>
          </DialogFooter>
        </DialogFrame>
      </Modal>
      {texting && currentUser && (
        <PatientTextDialog
          patient={{ _id: patientId, name: patient ? patientDisplayName(patient) : patientName, phone: patient?.phone }}
          sender={{
            _id: currentUser._id, name: userName,
            hospitalId: currentUser.hospitalId, hospitalName: currentUser.hospitalName, orgId: currentUser.orgId,
          }}
          title={t('patientCopy.textTitle')}
          subject={t('patientCopy.textSubject')}
          kind="prescription"
          text={text.text}
          prescriptionIds={text.included.map(rx => rx._id)}
          onClose={() => setTexting(false)}
          onDone={result => {
            // The sender committed to texting it: a queued text will still go.
            if (result.outcome === 'sent' || result.outcome === 'queued') {
              void applyReroute(text.included).then(refresh).catch(() => { /* surfaced by the list on reopen */ });
            }
          }}
        />
      )}
    </>
  );
}
