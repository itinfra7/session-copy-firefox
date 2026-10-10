// Test-only extension page (built into dist-test by `npm run build:test`, never into dist).
// Exposes the real extension modules to the Selenium e2e runner as window.sc.
import { captureFromTab, toSessionPayload } from '../../src/core/capture.js';
import { packToClipboardString, unpackFromClipboardString, packToFileBytes } from '../../src/core/pack.js';
import { clearSiteData, tabToSite } from '../../src/core/clear-site.js';
import { downloadSessionFile } from '../../src/popup/download.ts';

function waitComplete(tabId) {
  return new Promise(resolve => {
    const check = (_id, info, tab) => {
      if (info.status === 'complete' && tab.url && tab.url !== 'about:blank') {
        browser.tabs.onUpdated.removeListener(check);
        resolve(undefined);
      }
    };
    browser.tabs.onUpdated.addListener(check, { tabId, properties: ['status'] });
  });
}

window.sc = {
  async openTab(url, cookieStoreId) {
    const tab = await browser.tabs.create({ url: 'about:blank', active: true, ...(cookieStoreId ? { cookieStoreId } : {}) });
    const done = waitComplete(tab.id);
    await browser.tabs.update(tab.id, { url });
    await done;
    return tab.id;
  },
  async navigate(tabId, url) {
    const done = waitComplete(tabId);
    await browser.tabs.update(tabId, { url });
    await done;
  },
  async readState(tabId) {
    const [{ result }] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.getElementById('state')?.textContent ?? 'null'
    });
    return JSON.parse(result);
  },
  async tabInfo(tabId) {
    const t = await browser.tabs.get(tabId);
    return { id: t.id, url: t.url, cookieStoreId: t.cookieStoreId, windowId: t.windowId };
  },
  async capture(tabId, opts) {
    return toSessionPayload(await captureFromTab(tabId, opts));
  },
  async tokenRoundTrip(session) {
    const token = await packToClipboardString(session);
    return { token, back: await unpackFromClipboardString(token) };
  },
  async clipboardRoundTrip(text) {
    await navigator.clipboard.writeText(text);
    return navigator.clipboard.readText();
  },
  async clear(tabId) {
    return clearSiteData(tabToSite(await browser.tabs.get(tabId)), {});
  },
  async restore(session, cookieStoreId) {
    const current = await browser.tabs.getCurrent();
    const before = new Set((await browser.tabs.query({})).map(t => t.id));
    const resp = await browser.runtime.sendMessage({
      action: 'openAndRestore',
      data: session,
      target: { windowId: current.windowId, cookieStoreId }
    });
    const created = (await browser.tabs.query({})).filter(t => !before.has(t.id));
    return { resp, tabIds: created.map(t => t.id) };
  },
  async cookies(url, storeId) {
    const list = await browser.cookies.getAll({ url, storeId, firstPartyDomain: null });
    return list.map(c => ({ name: c.name, value: c.value, httpOnly: c.httpOnly, hostOnly: c.hostOnly }));
  },
  async hostAccess() {
    return browser.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
  },
  async exportFile(session, host) {
    downloadSessionFile(host, await packToFileBytes(session));
  },
  async focusSelf() {
    const current = await browser.tabs.getCurrent();
    await browser.tabs.update(current.id, { active: true });
  }
};

document.getElementById('ready').textContent = 'ready';
