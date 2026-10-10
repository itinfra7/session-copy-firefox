// Drives the real toolbar popup (opened with browser.action.openPopup()).
// Extensions run in-process here (extensions.webextensions.remote=false) so the test can read
// and click inside the popup document; clicks are dispatched as user input (user activation).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { By } from 'selenium-webdriver';
import { launch, createSteps, extBase, sleep } from './lib.mjs';
import { startSite } from './site.mjs';
import { unpackFromFileBytes } from '../../src/core/pack.js';

const POPUP = `document.querySelector('browser.webextension-popup-browser')`;

const site = await startSite();
const ff = await launch({
  prefs: {
    'extensions.webextensions.remote': false,
    'extensions.openPopupWithoutUserGesture.enabled': true
  }
});
const { driver, chrome, sc } = ff;
const { step } = (globalThis.steps = createSteps());

async function waitFor(fn, what, timeout = 15_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

const popupIsOpen = () => chrome(`return !!${POPUP};`);

/** Text of an element in the popup, or null when the popup or element is missing. */
const popupText = selector =>
  chrome(
    `const d = ${POPUP}?.contentDocument; const el = d?.querySelector(arguments[0]);
     return el && el.offsetParent !== null ? el.textContent.trim() : null;`,
    selector
  );

const popupEnabled = selector =>
  chrome(`const el = ${POPUP}?.contentDocument?.querySelector(arguments[0]); return !!el && !el.disabled;`, selector);

/** Click in the popup document, handled as user input (user activation), like a real click. */
const popupClick = selector =>
  chrome(
    `const win = ${POPUP}.contentWindow; const el = win.document.querySelector(arguments[0]);
     if (!el) throw new Error('not in popup: ' + arguments[0]);
     const input = win.windowUtils.setHandlingUserInput(true);
     try { el.click(); } finally { input.destruct(); }`,
    selector
  );

async function openPopup() {
  if (await popupIsOpen()) await closePopup();
  await sc('openPopup');
  await waitFor(() => popupText('.bottom-nav'), 'popup to render');
}

async function closePopup() {
  await chrome(`${POPUP}?.closest('panel')?.hidePopup();`);
  await waitFor(async () => !(await popupIsOpen()), 'popup to close');
}

const siteTabs = async () => sc('findTabs', `${site.origin.replace(/:\d+$/, '')}/*`);

try {
  console.log(`Firefox ${ff.version} — real toolbar popup — test site ${site.origin}`);
  await ff.openHarness();
  const harness = await driver.getWindowHandle();
  let token;
  let siteTab;

  await step('Copy session: encrypted token lands on the clipboard', async () => {
    siteTab = await sc('openTab', `${site.origin}/login?who=dave`);
    // Leave the login URL so later reloads do not sign in again.
    await sc('navigate', siteTab, `${site.origin}/`);
    await openPopup();
    await popupClick('[data-action=copy]');
    await waitFor(async () => /copied to clipboard/.test((await popupText('.status-text')) || ''), 'copy status');
    token = await sc('readClipboard');
    assert.ok(token.startsWith('sc:v2:'));
    const session = await sc('unpack', token);
    assert.equal(session.origin, site.origin);
    assert.equal(session.cookies.find(c => c.name === 'sessionid')?.value, 'dave-secret');
    await closePopup();
  });

  await step('Clear tab: "Clear site data" → "Yes, clear" signs the site out', async () => {
    await openPopup();
    await popupClick('.bottom-nav .nav-btn:nth-child(2)');
    await waitFor(() => popupEnabled('.btn-danger-soft'), 'clear button');
    assert.equal(await popupText('.site-pill-host'), '127.0.0.1');
    await popupClick('.btn-danger-soft');
    await waitFor(() => popupText('.cleanup-confirm .btn-danger'), 'confirm row');
    await popupClick('.cleanup-confirm .btn-danger');
    await waitFor(async () => /Tab reloaded/.test((await popupText('.cleanup-status')) || ''), 'clear status');
    await closePopup();
    await sleep(500);
    assert.equal((await sc('readState', siteTab)).server, null);
  });

  await step('Paste session: a new tab opens signed in', async () => {
    const before = new Set((await siteTabs()).map(t => t.id));
    await openPopup();
    await popupClick('[data-action=paste]');
    const created = await waitFor(async () => (await siteTabs()).find(t => !before.has(t.id)), 'restore tab');
    await waitFor(async () => (await sc('readState', created.id).catch(() => null))?.id_token, 'restored page', 30_000);
    assert.deepEqual(await sc('readState', created.id), {
      server: 'dave-secret',
      access_token: 'dave-token',
      ui_prefs: null,
      id_token: 'dave-id'
    });
    // Whether Firefox keeps the popup open after the tab switch varies; if open, it must report success.
    if (await popupIsOpen()) {
      await waitFor(async () => /Session restored/.test((await popupText('.status-text')) || ''), 'paste status');
      await closePopup();
    }
    siteTab = created.id;
  });

  let exported;
  await step('Export: .session file is downloaded from the popup and decrypts', async () => {
    const previous = fs.readdirSync(ff.downloads);
    await openPopup();
    await popupClick('[data-action=export]');
    exported = await ff.waitForDownload(previous);
    const session = await unpackFromFileBytes(new Uint8Array(fs.readFileSync(exported)));
    assert.equal(session.cookies.find(c => c.name === 'sessionid')?.value, 'dave-secret');
    if (await popupIsOpen()) await closePopup();
  });

  await step('Import: popup opens the import tab, the exported file restores the session', async () => {
    await sc('clear', siteTab);
    await openPopup();
    await popupClick('[data-action=import]');
    const importTab = await waitFor(async () => {
      const t = await sc('activeTab');
      return t.url.startsWith(`${extBase}/import/`) ? t : null;
    }, 'import tab');
    assert.match(importTab.url, /[?&]store=firefox-default\b/);
    assert.equal(await popupIsOpen(), false);

    const before = new Set((await siteTabs()).map(t => t.id));
    let importHandle;
    for (const h of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(h);
      if ((await driver.getCurrentUrl()).startsWith(`${extBase}/import/`)) importHandle = h;
    }
    await driver.switchTo().window(importHandle);
    await driver.findElement(By.css('#fileInput')).sendKeys(exported);
    await waitFor(
      async () => /Session imported/.test(await driver.executeScript(`return document.querySelector('.status-text')?.textContent || '';`)),
      'import status',
      30_000
    );
    await driver.switchTo().window(harness);
    const created = (await siteTabs()).find(t => !before.has(t.id));
    assert.ok(created, 'import opened a site tab');
    assert.equal((await sc('readState', created.id)).server, 'dave-secret');
  });

  await step('Website access off: banner shows, "Allow access" asks Firefox and restores access', async () => {
    assert.equal(await sc('removeHostAccess'), true);
    assert.equal(await sc('hostAccess'), false);
    await sc('openTab', `${site.origin}/`);
    await openPopup();
    await waitFor(() => popupText('.access-banner'), 'access banner');
    await popupClick('.access-banner-btn');
    await waitFor(() => chrome(`return !!PopupNotifications.getNotification('addon-webext-permissions');`), 'Firefox permission prompt');
    await chrome(`document.getElementById('addon-webext-permissions-notification').button.click();`);
    await waitFor(() => sc('hostAccess'), 'host access to be granted');
  });
} finally {
  await ff.close();
  site.close();
}

const { failures } = globalThis.steps;
console.log(failures ? `\n${failures} popup step(s) failed` : '\nAll popup steps passed');
process.exit(failures ? 1 : 0);
