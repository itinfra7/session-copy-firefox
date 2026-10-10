import { applyCookiesToOrigin } from './core/cookies-apply.js';

/** Give up waiting for a page load after this long and continue with what we have. */
const LOAD_TIMEOUT_MS = 45_000;

/**
 * Run `trigger` (a navigation) and resolve once that navigation finishes loading.
 * A "complete" only counts after a "loading" and never for about:blank (the freshly created
 * tab), so a late event from the previous document cannot resolve early.
 * @param {number} tabId
 * @param {() => Promise<unknown>} trigger
 */
function navigateAndWait(tabId, trigger) {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    };
    const onUpdated = (_id, info, tab) => {
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading && tab.url && tab.url !== 'about:blank') {
        cleanup();
        resolve(undefined);
      }
    };
    const onRemoved = id => {
      if (id !== tabId) return;
      cleanup();
      reject(new Error('The restore tab was closed.'));
    };

    browser.tabs.onUpdated.addListener(onUpdated, { tabId, properties: ['status'] });
    browser.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, LOAD_TIMEOUT_MS);

    trigger().catch(e => {
      cleanup();
      reject(e);
    });
  });
}

/**
 * First-party isolation (privacy.firstparty.isolate) requires every cookie write to name the
 * site's firstPartyDomain, which only Firefox computes. Let the loaded page set a short-lived
 * probe cookie, read the firstPartyDomain Firefox gave it, then delete the probe.
 * @returns {Promise<string | undefined>}
 */
async function probeFirstPartyDomain(tabId, originNorm, storeId) {
  const name = `__session_copy_probe_${Date.now()}`;
  await browser.scripting.executeScript({
    target: { tabId },
    args: [name],
    func: n => {
      document.cookie = `${n}=1; path=/; max-age=60`;
    }
  });
  const [probe] = await browser.cookies.getAll({ url: originNorm, name, storeId, firstPartyDomain: null });
  if (!probe) return undefined;
  await browser.cookies.remove({ url: `${originNorm}/`, name, storeId, firstPartyDomain: probe.firstPartyDomain });
  return probe.firstPartyDomain;
}

/** Inject localStorage + sessionStorage only (cookies via the cookies API). */
function injectStorageIntoTab(tabId, data) {
  return browser.scripting.executeScript({
    target: { tabId },
    args: [{ localStorage: data.localStorage || {}, sessionStorage: data.sessionStorage || {} }],
    func: d => {
      Object.entries(d.localStorage).forEach(([k, v]) => {
        try {
          window.localStorage.setItem(k, v);
        } catch (e) {
          console.warn('[session-copy] localStorage set failed', k, e);
        }
      });
      Object.entries(d.sessionStorage).forEach(([k, v]) => {
        try {
          window.sessionStorage.setItem(k, v);
        } catch (e) {
          console.warn('[session-copy] sessionStorage set failed', k, e);
        }
      });
    }
  });
}

/**
 * Open the session's origin in a new tab of the caller's window and container, then restore.
 * @param {{ origin: string; localStorage?: object; sessionStorage?: object; cookies?: object[] }} data
 * @param {{ windowId?: number; cookieStoreId?: string }} [target]
 */
async function openAndRestore(data, target = {}) {
  let parsed;
  try {
    parsed = new URL(data.origin);
  } catch {
    throw new Error('bad-origin');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad-origin');
  const originNorm = parsed.origin;
  const cookies = data.cookies || [];

  /** @type {browser.tabs._CreateCreateProperties} */
  const createProps = { url: 'about:blank', active: true };
  if (target.windowId != null) createProps.windowId = target.windowId;
  if (target.cookieStoreId) createProps.cookieStoreId = target.cookieStoreId;
  const tab = await browser.tabs.create(createProps);
  const tabId = tab.id;
  const storeId = tab.cookieStoreId;

  // Cookies first, so the very first request to the site already carries the session.
  const early = await applyCookiesToOrigin(originNorm, cookies, storeId);
  await navigateAndWait(tabId, () => browser.tabs.update(tabId, { url: originNorm }));

  const firstPartyDomain = early.needsFirstPartyDomain
    ? await probeFirstPartyDomain(tabId, originNorm, storeId).catch(() => undefined)
    : undefined;

  // The first page load may have rotated or cleared cookies — apply again, then storage.
  const { set, failed } = await applyCookiesToOrigin(originNorm, cookies, storeId, firstPartyDomain);
  await injectStorageIntoTab(tabId, data);

  // Second navigation so NextAuth / SPA re-reads cookies + storage (critical for ChatGPT).
  await navigateAndWait(tabId, () => browser.tabs.reload(tabId));

  return { cookiesSet: set, cookiesFailed: failed };
}

browser.runtime.onMessage.addListener(msg => {
  if (msg?.action !== 'openAndRestore') return;

  return openAndRestore(msg.data, msg.target).then(
    r => ({ ok: true, ...r }),
    e => {
      console.error(e);
      return { ok: false, error: e?.message || String(e) };
    }
  );
});
