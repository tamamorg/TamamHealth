/**
 * Load / save / live-subscribe the per-facility settings document.
 *
 * Storage: one `facility_settings:<hospitalId>` doc in the already-synced
 * `tamamhealth_hospitals` database. Reusing that DB means settings replicate
 * to every device at the facility with no new sync wiring and no SEED_VERSION
 * bump. Saving updates the singleton store immediately (snappy UI) and the
 * PouchDB change feed propagates to other tabs/devices.
 */
import { hospitalsDB } from '../db';
import {
  facilitySettingsId,
  mergeFacilitySettings,
  type FacilitySettings,
  type FacilitySettingsDoc,
} from './facility-settings';
import { setSettings } from './settings-store';

/** Read the facility settings doc, merged over defaults. */
export async function getFacilitySettings(hospitalId: string): Promise<FacilitySettings> {
  try {
    const doc = await hospitalsDB().get(facilitySettingsId(hospitalId)) as FacilitySettingsDoc;
    return mergeFacilitySettings(doc);
  } catch {
    // No doc yet → defaults.
    return mergeFacilitySettings(null);
  }
}

/** Read the raw doc (or null) — used when we need _rev for an update. */
async function getDocOrNull(hospitalId: string): Promise<FacilitySettingsDoc | null> {
  try {
    return await hospitalsDB().get(facilitySettingsId(hospitalId)) as FacilitySettingsDoc;
  } catch {
    return null;
  }
}

/**
 * Upsert the facility settings. Accepts a partial patch which is merged over
 * the current stored settings (and defaults). When the save targets the
 * session's own facility it also updates the in-memory store synchronously, so
 * the change is reflected platform-wide right away.
 */
export async function saveFacilitySettings(
  hospitalId: string,
  patch: Partial<FacilitySettings>,
  orgId?: string,
  /**
   * The facility the *current session* belongs to. The in-memory store holds
   * one facility's settings — the signed-in user's — so it may only be updated
   * when this save targets that same facility.
   *
   * Super-admins and org-admins have no facility of their own and edit other
   * hospitals through the facility picker. Pushing those values into the store
   * used to overwrite their session with a facility they don't work at, which
   * then drove currency, SLAs, and the lab catalogue everywhere else in the
   * app. Pass `undefined` (the default) from those callers and the store is
   * left alone; the editor re-renders from the returned value instead.
   */
  sessionHospitalId?: string,
): Promise<FacilitySettings> {
  const existing = await getDocOrNull(hospitalId);
  const current = mergeFacilitySettings(existing);
  const merged = mergeFacilitySettings({ ...current, ...patch });
  const now = new Date().toISOString();

  const doc: FacilitySettingsDoc = {
    ...merged,
    _id: facilitySettingsId(hospitalId),
    _rev: existing?._rev,
    type: 'facility_settings',
    hospitalId,
    orgId: orgId ?? existing?.orgId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await hospitalsDB().put(doc);
  // Immediate platform-wide propagation — but only for the facility this
  // session actually belongs to (see `sessionHospitalId` above).
  if (sessionHospitalId && sessionHospitalId === hospitalId) setSettings(merged);
  return merged;
}

/**
 * Live-subscribe to changes of this facility's settings doc. Fires `onChange`
 * whenever the doc is written (locally or via sync from another device).
 * Returns a cancel function.
 */
export function subscribeFacilitySettingsDoc(
  hospitalId: string,
  onChange: () => void,
): () => void {
  const id = facilitySettingsId(hospitalId);
  // Mirror the proven live-subscription pattern used elsewhere (usePatients):
  // a plain live changes feed, filtered to our doc id in the handler. Avoids
  // the finicky `doc_ids` changes option and is fully guarded so a feed error
  // can never bubble into React render.
  let feed: { cancel: () => void } | null = null;
  try {
    feed = hospitalsDB()
      .changes({ since: 'now', live: true, include_docs: false })
      .on('change', (change: { id?: string }) => {
        if (change?.id === id) onChange();
      })
      .on('error', () => { /* swallow — best effort */ }) as unknown as { cancel: () => void };
  } catch {
    feed = null;
  }
  return () => { try { feed?.cancel(); } catch { /* noop */ } };
}
