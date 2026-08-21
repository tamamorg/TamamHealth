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

/**
 * Read the settings of several facilities at once (one `allDocs` round trip).
 * Missing docs resolve to defaults, so the returned map always has an entry
 * for every id asked for.
 *
 * Used by the network-defaults editor, which has to know what each facility
 * currently holds before it can say how many of them a shared value differs at.
 */
export async function getFacilitySettingsMany(
  hospitalIds: string[],
): Promise<Record<string, FacilitySettings>> {
  const out: Record<string, FacilitySettings> = {};
  if (hospitalIds.length === 0) return out;
  let rows: Array<{ doc?: unknown }> = [];
  try {
    const res = await hospitalsDB().allDocs({
      keys: hospitalIds.map(facilitySettingsId),
      include_docs: true,
    });
    rows = res.rows as Array<{ doc?: unknown }>;
  } catch {
    rows = [];
  }
  hospitalIds.forEach((id, i) => {
    const doc = rows[i]?.doc as FacilitySettingsDoc | undefined;
    out[id] = mergeFacilitySettings(doc ?? null);
  });
  return out;
}

/**
 * Write the same shared configuration to every facility in `hospitalIds`.
 *
 * The network-defaults editor holds the settings that are policy for the whole
 * network rather than a property of one hospital (billing, HMIS rules, IT
 * operations, consultation templates…). Rather than invent an inheritance
 * layer — which would silently neuter the per-facility editors that already
 * write these same keys — a save here fans the values out to each facility's
 * own document. One save, every facility, and every existing reader keeps
 * reading exactly one place: its own facility's settings.
 *
 * `patchFor` receives each facility's current settings so a shared save can
 * still preserve the fields inside a shared block that are facility-specific
 * (the DHIS2 org-unit id being the one that matters).
 */
export async function saveFacilitySettingsToMany(
  hospitalIds: string[],
  patchFor: (current: FacilitySettings, hospitalId: string) => Partial<FacilitySettings>,
  orgIdByHospital: (hospitalId: string) => string | undefined,
  /** The session's own facility — its singleton store is refreshed in place. */
  sessionHospitalId?: string,
): Promise<{ saved: number; failed: number }> {
  if (hospitalIds.length === 0) return { saved: 0, failed: 0 };

  const existingRows = await hospitalsDB().allDocs({
    keys: hospitalIds.map(facilitySettingsId),
    include_docs: true,
  });
  const now = new Date().toISOString();

  const docs: FacilitySettingsDoc[] = hospitalIds.map((hospitalId, i) => {
    const existing = (existingRows.rows[i] as { doc?: unknown } | undefined)?.doc as FacilitySettingsDoc | undefined;
    const current = mergeFacilitySettings(existing ?? null);
    const merged = mergeFacilitySettings({ ...current, ...patchFor(current, hospitalId) });
    return {
      ...merged,
      _id: facilitySettingsId(hospitalId),
      _rev: existing?._rev,
      type: 'facility_settings',
      hospitalId,
      orgId: orgIdByHospital(hospitalId) ?? existing?.orgId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });

  const results = await hospitalsDB().bulkDocs(docs) as Array<{ ok?: boolean; error?: unknown; id?: string }>;
  const failedIds = new Set(results.filter(r => r.error || !r.ok).map(r => r.id));
  const failed = failedIds.size;

  // Keep the signed-in user's own facility live in the singleton store, the
  // same way a single-facility save does.
  if (sessionHospitalId && hospitalIds.includes(sessionHospitalId) && !failedIds.has(facilitySettingsId(sessionHospitalId))) {
    const own = docs.find(d => d.hospitalId === sessionHospitalId);
    if (own) setSettings(mergeFacilitySettings(own));
  }

  return { saved: docs.length - failed, failed };
}
