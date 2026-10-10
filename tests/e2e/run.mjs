// End-to-end test in a real Firefox (temporary add-on install, fresh profile).
// Run with `npm run test:e2e`; HEADED=1 shows the browser window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, createSteps, outDir, json } from './lib.mjs';
import { startSite } from './site.mjs';
import { unpackFromFileBytes } from '../../src/core/pack.js';

const site = await startSite();
const ff = await launch({ allowPrivateBrowsing: true });
const { driver, sc, openExtensionPage } = ff;
const steps = createSteps();
const { step } = steps;
const cookieNames = session => session.cookies.map(c => c.name).sort();
const waitForDownload = () => ff.waitForDownload();

try {
  console.log(`Firefox ${ff.version} — test site ${site.origin}`);
  await ff.openHarness();
  const harness = await driver.getWindowHandle();

  let session;
  let siteTab;

  await step('host access is granted at install', async () => {
    assert.equal(await sc('hostAccess'), true);
  });

  await step('capture: login-only keeps auth data, drops noise (incl. HttpOnly cookie)', async () => {
    siteTab = await sc('openTab', `${site.origin}/login?who=alice`);
    session = await sc('capture', siteTab, { loginOnlyMode: true, strictCookies: false });
    assert.equal(session.origin, site.origin);
    assert.deepEqual(cookieNames(session), ['sessionid']);
    const sid = session.cookies[0];
    assert.equal(sid.value, 'alice-secret');
    assert.equal(sid.httpOnly, true);
    assert.equal(sid.hostOnly, true);
    assert.deepEqual(session.localStorage, { access_token: 'alice-token' });
    assert.deepEqual(session.sessionStorage, { id_token: 'alice-id' });
  });

  await step('capture: full sync keeps more, still drops analytics', async () => {
    const full = await sc('capture', siteTab, { loginOnlyMode: false, strictCookies: false });
    assert.deepEqual(cookieNames(full), ['sessionid', 'ui_theme']);
    assert.equal(full.localStorage.ui_prefs, 'compact');
  });

  let token;
  await step('token pack/unpack and clipboard round-trip', async () => {
    const r = await sc('tokenRoundTrip', session);
    token = r.token;
    assert.ok(token.startsWith('sc:v2:'));
    assert.deepEqual(json(r.back), json(session));
    assert.equal(await sc('clipboardRoundTrip', token), token);
    fs.writeFileSync(path.join(outDir, 'firefox-token.txt'), `${token}\n`);
  });

  await step('export: .session download is written and decrypts', async () => {
    await sc('exportFile', session, '127.0.0.1');
    const file = await waitForDownload();
    const back = await unpackFromFileBytes(new Uint8Array(fs.readFileSync(file)));
    assert.deepEqual(json(back), json(session));
  });

  await step('clear site data signs the user out', async () => {
    const r = await sc('clear', siteTab);
    assert.equal(r.cookiesFailed, 0);
    assert.equal(r.cookiesRemoved, 3);
    assert.equal(r.localKeys, 2);
    assert.equal(r.sessionKeys, 1);
    await sc('navigate', siteTab, `${site.origin}/`);
    assert.deepEqual(await sc('readState', siteTab), {
      server: null,
      access_token: null,
      ui_prefs: null,
      id_token: null
    });
  });

  await step('restore opens the site logged in (cookie sent to server, storage restored)', async () => {
    await driver.switchTo().window(harness);
    const { resp, tabIds } = await sc('restore', session, 'firefox-default');
    assert.equal(resp.ok, true, JSON.stringify(resp));
    assert.equal(resp.cookiesFailed, 0);
    assert.equal(tabIds.length, 1);
    const state = await sc('readState', tabIds[0]);
    assert.deepEqual(state, {
      server: 'alice-secret',
      access_token: 'alice-token',
      ui_prefs: null,
      id_token: 'alice-id'
    });
    const jar = await sc('cookies', site.origin, 'firefox-default');
    const sid = jar.find(c => c.name === 'sessionid');
    assert.equal(sid.httpOnly, true);
    assert.equal(sid.hostOnly, true);
  });

  await step('containers: capture reads the tab’s own container jar', async () => {
    const tab = await sc('openTab', `${site.origin}/login?who=bob`, 'firefox-container-1');
    const info = await sc('tabInfo', tab);
    assert.equal(info.cookieStoreId, 'firefox-container-1');
    const bobSession = await sc('capture', tab, { loginOnlyMode: true });
    assert.equal(bobSession.cookies.find(c => c.name === 'sessionid')?.value, 'bob-secret');

    const { resp, tabIds } = await sc('restore', bobSession, 'firefox-container-2');
    assert.equal(resp.ok, true, JSON.stringify(resp));
    assert.equal((await sc('tabInfo', tabIds[0])).cookieStoreId, 'firefox-container-2');
    assert.equal((await sc('readState', tabIds[0])).server, 'bob-secret');

    // Other jars untouched.
    const defaultSid = (await sc('cookies', site.origin, 'firefox-default')).find(c => c.name === 'sessionid');
    assert.equal(defaultSid.value, 'alice-secret');
    const c3 = await sc('cookies', site.origin, 'firefox-container-3');
    assert.equal(c3.length, 0);
  });

  await step('private window: capture and restore stay in the private cookie store', async () => {
    const { windowId, tabId } = await sc('openPrivateWindow', `${site.origin}/login?who=erin`);
    const info = await sc('tabInfo', tabId);
    assert.equal(info.cookieStoreId, 'firefox-private');
    const erin = await sc('capture', tabId, { loginOnlyMode: true });
    assert.equal(erin.cookies.find(c => c.name === 'sessionid')?.value, 'erin-secret');

    await sc('clear', tabId);
    assert.equal((await sc('cookies', site.origin, 'firefox-private')).length, 0);

    const { resp, tabIds } = await sc('restore', erin, 'firefox-private', windowId);
    assert.equal(resp.ok, true, JSON.stringify(resp));
    const restored = await sc('tabInfo', tabIds[0]);
    assert.equal(restored.cookieStoreId, 'firefox-private');
    assert.equal(restored.windowId, windowId);
    assert.deepEqual(await sc('readState', tabIds[0]), {
      server: 'erin-secret',
      access_token: 'erin-token',
      ui_prefs: null,
      id_token: 'erin-id'
    });
    // The normal-window jar still holds alice's session.
    const defaultSid = (await sc('cookies', site.origin, 'firefox-default')).find(c => c.name === 'sessionid');
    assert.equal(defaultSid.value, 'alice-secret');
  });

  await step('restore rejects non-http origins', async () => {
    const { resp } = await sc('restore', { ...session, origin: 'file:///C:/' }, 'firefox-default');
    assert.equal(resp.ok, false);
    assert.equal(resp.error, 'bad-origin');
  });

  await step('popup and import pages render (light + dark screenshots)', async () => {
    await driver.switchTo().newWindow('window');
    await driver.manage().window().setRect({ width: 460, height: 900 });
    for (const [page, file, selector] of [
      ['popup/popup.html', 'popup', '.bottom-nav'],
      ['import/import.html?store=firefox-container-1', 'import', '.drop-zone']
    ]) {
      for (const theme of ['light', 'dark']) {
        await openExtensionPage(page);
        await driver.executeAsyncScript(
          `const done = arguments[arguments.length - 1];
           browser.storage.local.set({ themePreference: arguments[0] }).then(() => done());`,
          theme
        );
        await openExtensionPage(page);
        const ok = await driver.wait(async () =>
          driver.executeScript(`return !!document.querySelector(arguments[0]);`, selector), 10_000);
        assert.ok(ok);
        await new Promise(r => setTimeout(r, 300));
        fs.writeFileSync(path.join(outDir, `${file}-${theme}.png`), await driver.takeScreenshot(), 'base64');
      }
    }
    const text = await driver.executeScript('return document.body.innerText;');
    assert.match(text, /same container as your tab/);
  });
} finally {
  await ff.close();
  site.close();
}

const { failures } = steps;
console.log(failures ? `\n${failures} step(s) failed` : '\nAll e2e steps passed');
console.log(`Screenshots: ${outDir}`);
process.exit(failures ? 1 : 0);
