// End-to-end test in a real Firefox (temporary add-on install, fresh profile).
// Run with `npm run test:e2e`; HEADED=1 shows the browser window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, Browser } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import webExt from 'web-ext';
import { startSite } from './site.mjs';
import { unpackFromFileBytes } from '../../src/core/pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distTest = path.join(root, 'dist-test');
const outDir = path.join(root, 'test-results');
const manifest = JSON.parse(fs.readFileSync(path.join(distTest, 'manifest.json'), 'utf8'));
const addonId = manifest.browser_specific_settings.gecko.id;
const uuid = '5e55c0de-0000-4000-8000-000000000001';
const extBase = `moz-extension://${uuid}`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'session-copy-e2e-'));
const downloads = path.join(work, 'downloads');
fs.mkdirSync(downloads);
fs.mkdirSync(outDir, { recursive: true });

const { extensionPath } = await webExt.cmd.build(
  { sourceDir: distTest, artifactsDir: work, overwriteDest: true, filename: 'session-copy-test.zip' },
  { showReadyMessage: false, shouldExitProgram: false }
);

const site = await startSite();
const options = new firefox.Options()
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [addonId]: uuid }))
  .setPreference('privacy.userContext.enabled', true)
  .setPreference('browser.download.folderList', 2)
  .setPreference('browser.download.dir', downloads)
  .setPreference('browser.download.useDownloadDir', true)
  .setPreference('browser.download.always_ask_before_handling_new_types', false)
  .setPreference('browser.download.alwaysOpenPanel', false);
if (!process.env.HEADED) options.addArguments('-headless');
// Chrome-context access is needed to open moz-extension:// pages (WebDriver refuses to navigate there).
const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');

const driver = await new Builder()
  .forBrowser(Browser.FIREFOX)
  .setFirefoxOptions(options)
  .setFirefoxService(service)
  .build();
let failures = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✘ ${name}\n    ${String(e?.stack || e).split('\n').join('\n    ')}`);
  }
}

/** Call window.sc[fn](...args) inside the harness extension page. */
async function sc(fn, ...args) {
  const r = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.sc[arguments[0]](...arguments[1]).then(
       v => done({ ok: true, v: v === undefined ? null : v }),
       e => done({ ok: false, e: String((e && e.stack) || e) })
     );`,
    fn,
    args
  );
  if (!r.ok) throw new Error(`${fn}: ${r.e}`);
  return r.v;
}

/** Load an extension page into the current tab (privileged load from the chrome context). */
async function openExtensionPage(relPath) {
  const url = `${extBase}/${relPath}`;
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
       triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
     });`,
    url
  );
  await driver.setContext(firefox.Context.CONTENT);
  await driver.wait(async () => (await driver.getCurrentUrl()) === url, 10_000);
  await driver.wait(async () => driver.executeScript('return document.readyState === "complete";'), 10_000);
}

const json = v => JSON.parse(JSON.stringify(v));
const cookieNames = session => session.cookies.map(c => c.name).sort();

/** Firefox creates an empty placeholder under the final name and writes into `.part` first. */
async function waitForDownload() {
  for (let i = 0; i < 50; i++) {
    const files = fs.readdirSync(downloads);
    const done = files.filter(f => f.endsWith('.session'));
    const writing = files.some(f => f.endsWith('.part'));
    if (done.length && !writing) {
      const file = path.join(downloads, done[0]);
      if (fs.statSync(file).size > 0) return file;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('no complete .session file downloaded');
}

try {
  console.log(`Firefox ${(await driver.getCapabilities()).get('browserVersion')} — test site ${site.origin}`);
  await driver.installAddon(extensionPath, true);
  await driver.manage().setTimeouts({ script: 120_000 });
  await openExtensionPage('harness/harness.html');
  await driver.wait(async () => driver.executeScript('return !!window.sc;'), 10_000);
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
  await driver.quit();
  site.close();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} step(s) failed` : '\nAll e2e steps passed');
console.log(`Screenshots: ${outDir}`);
process.exit(failures ? 1 : 0);
