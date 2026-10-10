import { getCookiesForOrigin } from './cookies-query.js';

/**
 * @param {browser.cookies.Cookie} cookie
 * @param {string} origin
 */
function cookieRemovalUrl(cookie, origin) {
  const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
  let host = cookie.domain || '';
  if (host.startsWith('.')) host = host.slice(1);
  if (!host) {
    try {
      return new URL(path, origin).href;
    } catch {
      return `${origin}${path}`;
    }
  }
  const scheme = cookie.secure ? 'https' : 'http';
  return `${scheme}://${host}${path}`;
}

/**
 * Active tab of the current window as a site target.
 * @returns {Promise<{ tabId: number; origin: string; host: string; display: string; favIconUrl: string; cookieStoreId?: string } | { unsupported: true; reason: string } | null>}
 */
export async function getActiveTabSite() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return tabToSite(tab);
}

/**
 * @param {browser.tabs.Tab} tab
 */
export function tabToSite(tab) {
  // Without host access Firefox hides the URL of most tabs.
  if (!tab.url) {
    return { unsupported: true, reason: 'This page cannot be accessed. Open a normal website tab.' };
  }

  try {
    const u = new URL(tab.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { unsupported: true, reason: 'Only http(s) sites are supported. Open a normal website tab.' };
    }
    return {
      tabId: tab.id,
      origin: u.origin,
      host: u.hostname,
      display: u.hostname,
      favIconUrl: tab.favIconUrl || '',
      cookieStoreId: tab.cookieStoreId
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ tabId: number; origin: string; host: string; cookieStoreId?: string }} target
 * @param {{ cookies?: boolean; localStorage?: boolean; sessionStorage?: boolean }} scope
 */
export async function clearSiteData(target, scope = {}) {
  const cookies = scope.cookies !== false;
  const localStorage = scope.localStorage !== false;
  const sessionStorage = scope.sessionStorage !== false;

  /** @type {{ cookiesRemoved: number; cookiesFailed: number; localKeys: number; sessionKeys: number }} */
  const result = { cookiesRemoved: 0, cookiesFailed: 0, localKeys: 0, sessionKeys: 0 };

  if (localStorage || sessionStorage) {
    const [{ result: counts }] = await browser.scripting.executeScript({
      target: { tabId: target.tabId },
      func: opts => {
        let localKeys = 0;
        let sessionKeys = 0;
        if (opts.localStorage) {
          localKeys = window.localStorage.length;
          window.localStorage.clear();
        }
        if (opts.sessionStorage) {
          sessionKeys = window.sessionStorage.length;
          window.sessionStorage.clear();
        }
        return { localKeys, sessionKeys };
      },
      args: [{ localStorage, sessionStorage }]
    });
    result.localKeys = counts?.localKeys ?? 0;
    result.sessionKeys = counts?.sessionKeys ?? 0;
  }

  if (cookies) {
    const list = await getCookiesForOrigin(target.host, target.origin, target.cookieStoreId);
    for (const c of list) {
      try {
        /** @type {browser.cookies._RemoveDetails} */
        const details = {
          url: cookieRemovalUrl(c, target.origin),
          name: c.name,
          storeId: c.storeId
        };
        if (c.partitionKey) details.partitionKey = c.partitionKey;
        // Required when first-party isolation is on; "" is valid when it is off.
        if (typeof c.firstPartyDomain === 'string') details.firstPartyDomain = c.firstPartyDomain;

        const removed = await browser.cookies.remove(details);
        if (removed) result.cookiesRemoved++;
        else result.cookiesFailed++;
      } catch {
        result.cookiesFailed++;
      }
    }
  }

  return result;
}
