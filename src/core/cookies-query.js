/**
 * All unpartitioned cookies visible to `origin` (plus domain-matched ones) in one cookie store.
 * Firefox: `storeId` selects the container / private-window jar; `firstPartyDomain: null`
 * keeps the query working when first-party isolation is enabled.
 * @param {string} host
 * @param {string} origin
 * @param {string} [storeId]
 * @param {string[]} [domains] defaults to host and .host
 * @returns {Promise<browser.cookies.Cookie[]>}
 */
export async function getCookiesForOrigin(host, origin, storeId, domains) {
  const domainList = domains ?? [host, host.startsWith('.') ? host : `.${host}`];
  const scope = { firstPartyDomain: null, ...(storeId ? { storeId } : {}) };

  const byKey = new Map();
  const add = list => {
    for (const c of list) {
      const k = `${c.name}\0${c.domain}\0${c.path}`;
      if (!byKey.has(k)) byKey.set(k, c);
    }
  };

  add(await browser.cookies.getAll({ ...scope, url: origin }));
  for (const d of domainList) {
    try {
      add(await browser.cookies.getAll({ ...scope, domain: d }));
    } catch {
      /* domain query can fail for invalid patterns */
    }
  }

  return [...byKey.values()];
}
