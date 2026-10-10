import { shouldKeepStorageEntry, shouldKeepCookie } from '../utils/filters.js';
import { cookieToSnapshot } from './cookie-snapshot.js';
import { getCookiesForOrigin } from './cookies-query.js';
import { getSiteProfile, cookieMatchesSiteProfile } from './site-profiles.js';

/**
 * @typedef {object} CapturedSession
 * @property {string} origin
 * @property {string} host
 * @property {Record<string, string>} localStorage
 * @property {Record<string, string>} sessionStorage
 * @property {import('./cookie-snapshot.js').CookieSnapshot[]} cookies
 */

/**
 * @param {number} tabId
 * @param {{ strictCookies?: boolean; loginOnlyMode?: boolean }} [opts] loginOnlyMode defaults to true (auth-sized payload).
 * @returns {Promise<CapturedSession>}
 */
export async function captureFromTab(tabId, opts = {}) {
  const loginOnlyMode = opts.loginOnlyMode !== false;
  const tab = await browser.tabs.get(tabId);
  const [{ result: page }] = await browser.scripting.executeScript({
    target: { tabId },
    // Must use window.* — esbuild minify renames outer `localStorage` vars and breaks injected func.
    func: () => ({
      localStorage: Object.fromEntries(Object.entries(window.localStorage)),
      sessionStorage: Object.fromEntries(Object.entries(window.sessionStorage)),
      origin: location.origin,
      host: location.hostname
    })
  });

  const profile = getSiteProfile(page.host);
  // Read from the tab's own cookie store (container tab / private window), not the default one.
  const cookiesRaw = await getCookiesForOrigin(
    page.host,
    page.origin,
    tab.cookieStoreId,
    profile?.cookieDomains
  );

  const storageOpts = { loginOnlyMode, host: page.host };

  const localStorage = {};
  if (profile && loginOnlyMode) {
    for (const key of profile.localStorageExact) {
      if (page.localStorage[key] != null) localStorage[key] = page.localStorage[key];
    }
  } else {
    for (const [k, v] of Object.entries(page.localStorage)) {
      if (shouldKeepStorageEntry(k, v, 'local', storageOpts)) localStorage[k] = v;
    }
  }

  const sessionStorage = {};
  for (const [k, v] of Object.entries(page.sessionStorage)) {
    if (shouldKeepStorageEntry(k, v, 'session', storageOpts)) sessionStorage[k] = v;
  }

  const cookieOpts = { strict: !!opts.strictCookies, loginOnlyMode, host: page.host };
  const cookies = cookiesRaw
    .filter(c => {
      if (profile && loginOnlyMode) return cookieMatchesSiteProfile(c.name, profile);
      return shouldKeepCookie(c, cookieOpts);
    })
    .map(cookieToSnapshot);

  return {
    origin: page.origin,
    host: page.host,
    localStorage,
    sessionStorage,
    cookies
  };
}

/**
 * Shape expected by pack/apply (no host field).
 * @param {CapturedSession} cap
 */
export function toSessionPayload(cap) {
  return {
    origin: cap.origin,
    createdAt: Date.now(),
    localStorage: cap.localStorage,
    sessionStorage: cap.sessionStorage,
    cookies: cap.cookies
  };
}
