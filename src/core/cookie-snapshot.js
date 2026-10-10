/**
 * Minimal fields needed for cookies.set (and round-trip from getAll).
 * Same wire shape as the Chrome build; `hostOnly` is an optional extra the Chrome build ignores.
 * @typedef {object} CookieSnapshot
 * @property {string} name
 * @property {string} value
 * @property {string} domain
 * @property {string} path
 * @property {boolean} secure
 * @property {boolean} httpOnly
 * @property {boolean} [hostOnly]
 * @property {browser.cookies.SameSiteStatus} [sameSite]
 * @property {number} [expirationDate] // Unix seconds
 */

/** @param {browser.cookies.Cookie} c */
export function cookieToSnapshot(c) {
  const snap = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    hostOnly: !!c.hostOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate
    // storeId / partitionKey / firstPartyDomain intentionally omitted —
    // cookies must land in the target tab's store (container / private window).
  };
  return snap;
}
