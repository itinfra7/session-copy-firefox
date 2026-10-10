/** Values Firefox accepts for cookies.set({ sameSite }). Chrome's "unspecified" is dropped. */
const FIREFOX_SAME_SITE = new Set(['no_restriction', 'lax', 'strict']);

/**
 * Build cookies.set details with correct rules for __Host- / __Secure- cookies.
 * Never applies the source storeId — cookies must land in the target store
 * (container tab or private window), passed in by the caller.
 * @param {string} originNorm
 * @param {import('./cookie-snapshot.js').CookieSnapshot} snap
 * @param {string} [storeId] target cookie store (tab.cookieStoreId)
 * @returns {browser.cookies._SetDetails | null}
 */
export function buildCookieSetDetails(originNorm, snap, storeId) {
  const name = snap.name || '';
  if (!name) return null;

  const isHost = name.startsWith('__Host-');
  const isSecurePrefix = name.startsWith('__Secure-');

  let path = snap.path && snap.path.startsWith('/') ? snap.path : '/';
  if (isHost) path = '/';

  // Host-only cookies (Firefox → Firefox transfers) must be set without Domain on their own host,
  // otherwise they turn into domain cookies — and IP / localhost hosts reject Domain entirely.
  const hostOnly = isHost || snap.hostOnly === true;
  const cookieHost = (snap.domain || '').replace(/^\./, '');
  const { protocol, hostname } = new URL(originNorm);
  const url =
    hostOnly && cookieHost && cookieHost !== hostname
      ? `${protocol}//${cookieHost}${path}`
      : `${originNorm}${path}`;

  /** @type {browser.cookies._SetDetails} */
  const details = {
    url,
    name: snap.name,
    value: snap.value,
    path,
    secure: isHost || isSecurePrefix ? true : !!snap.secure,
    httpOnly: !!snap.httpOnly
  };

  if (snap.expirationDate) details.expirationDate = snap.expirationDate;

  // __Host- cookies must not include Domain.
  if (!hostOnly && snap.domain) details.domain = snap.domain;

  if (snap.sameSite && FIREFOX_SAME_SITE.has(snap.sameSite)) {
    details.sameSite = snap.sameSite;
  }

  if (storeId) details.storeId = storeId;

  return details;
}

/**
 * @param {string} origin Page origin e.g. https://chatgpt.com
 * @param {import('./cookie-snapshot.js').CookieSnapshot[]} snapshots
 * @param {string} [storeId] target cookie store (tab.cookieStoreId)
 * @returns {Promise<{ set: number; failed: number }>}
 */
export async function applyCookiesToOrigin(origin, snapshots, storeId) {
  let originNorm;
  try {
    originNorm = new URL(origin).origin;
  } catch {
    throw new Error('bad-origin');
  }

  const seen = new Set();
  let set = 0;
  let failed = 0;

  for (const snap of snapshots) {
    const key = `${snap.name}\0${snap.domain || ''}\0${snap.path || '/'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const details = buildCookieSetDetails(originNorm, snap, storeId);
    if (!details) {
      failed++;
      continue;
    }

    try {
      const ok = await browser.cookies.set(details);
      if (ok) set++;
      else failed++;
    } catch (e) {
      failed++;
      console.warn('[session-copy] cookie set failed', snap.name, e?.message || e);
    }
  }

  return { set, failed };
}
