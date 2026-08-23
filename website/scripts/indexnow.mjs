/**
 * Tell the search engines the site exists, without waiting to be found.
 *
 * A new domain is not crawled because it is published; it is crawled because
 * something points an engine at it. Google's route to that is Search Console,
 * which needs an account and a human to verify ownership. IndexNow is the
 * route that does not: Bing, Yandex, Seznam and Naver accept a URL list from
 * anyone who can prove they control the host, and the proof is a key file
 * served from the site itself. Submitting to Bing covers Edge, DuckDuckGo,
 * Yahoo and Ecosia, all of which read its index.
 *
 * Run after a deploy, once the key file is actually being served — the API
 * fetches it before accepting anything, so submitting from a machine whose
 * changes are not live yet is refused, and correctly so.
 *
 *   node scripts/indexnow.mjs            # every URL in the sitemap
 *   node scripts/indexnow.mjs /news/x    # just these paths
 */

const HOST = 'tamamhealth.org';
const BASE = `https://${HOST}`;
/** Also served at /<key>.txt — that file IS the ownership proof. */
const KEY = 'd62e12048cc366c6d61e7a19a43aea73';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The sitemap is already the list of what should be indexed; reuse it. */
async function urlsFromSitemap() {
  const response = await fetch(`${BASE}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml answered ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** Refuse to submit against a key file that is not live: the API would reject
 *  the batch anyway, and a silent 403 reads like a submission that worked. */
async function assertKeyIsServed() {
  const response = await fetch(`${BASE}/${KEY}.txt`);
  if (!response.ok) {
    throw new Error(
      `${BASE}/${KEY}.txt answered ${response.status}. Deploy the site before submitting — IndexNow verifies ownership by fetching that file.`,
    );
  }
  const body = (await response.text()).trim();
  if (body !== KEY) throw new Error(`${KEY}.txt does not contain the key (got "${body.slice(0, 40)}").`);
}

async function main() {
  const args = process.argv.slice(2);
  const urlList = args.length
    ? args.map((path) => (path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`))
    : await urlsFromSitemap();

  await assertKeyIsServed();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${BASE}/${KEY}.txt`, urlList }),
  });

  // 200 accepted, 202 accepted pending key validation. Anything else is a
  // refusal worth reading rather than a warning worth ignoring.
  const detail = await response.text();
  console.log(`IndexNow ${response.status} for ${urlList.length} URL(s)`);
  if (detail.trim()) console.log(detail.trim().slice(0, 400));
  if (![200, 202].includes(response.status)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`IndexNow submission failed: ${err.message}`);
  process.exitCode = 1;
});
