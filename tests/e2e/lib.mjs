// Shared setup for the Firefox e2e suites: temporary add-on install into a fresh profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, Browser } from 'selenium-webdriver';
import { Command } from 'selenium-webdriver/lib/command.js';
import firefox from 'selenium-webdriver/firefox.js';
import webExt from 'web-ext';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const outDir = path.join(root, 'test-results');
const distTest = path.join(root, 'dist-test');
const manifest = JSON.parse(fs.readFileSync(path.join(distTest, 'manifest.json'), 'utf8'));
export const addonId = manifest.browser_specific_settings.gecko.id;
const uuid = '5e55c0de-0000-4000-8000-000000000001';
export const extBase = `moz-extension://${uuid}`;
/** Toolbar button id Firefox derives from the add-on id. */
export const actionWidgetId = `${addonId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-browser-action`;

export const json = v => JSON.parse(JSON.stringify(v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Step runner that keeps going after a failure and reports at the end. */
export function createSteps() {
  let failures = 0;
  return {
    async step(name, fn) {
      try {
        await fn();
        console.log(`  ✔ ${name}`);
      } catch (e) {
        failures++;
        console.log(`  ✘ ${name}\n    ${String(e?.stack || e).split('\n').join('\n    ')}`);
      }
    },
    get failures() {
      return failures;
    }
  };
}

/**
 * Launch Firefox with the dist-test build installed temporarily.
 * @param {{ prefs?: Record<string, unknown>; allowPrivateBrowsing?: boolean }} [opts]
 */
export async function launch(opts = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'session-copy-e2e-'));
  const downloads = path.join(work, 'downloads');
  fs.mkdirSync(downloads);
  fs.mkdirSync(outDir, { recursive: true });

  const { extensionPath } = await webExt.cmd.build(
    { sourceDir: distTest, artifactsDir: work, overwriteDest: true, filename: 'session-copy-test.zip' },
    { showReadyMessage: false, shouldExitProgram: false }
  );

  const options = new firefox.Options()
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [addonId]: uuid }))
    .setPreference('privacy.userContext.enabled', true)
    .setPreference('browser.download.folderList', 2)
    .setPreference('browser.download.dir', downloads)
    .setPreference('browser.download.useDownloadDir', true)
    .setPreference('browser.download.always_ask_before_handling_new_types', false)
    .setPreference('browser.download.alwaysOpenPanel', false);
  for (const [k, v] of Object.entries(opts.prefs || {})) options.setPreference(k, v);
  if (!process.env.HEADED) options.addArguments('-headless');
  // Chrome-context access is needed to open moz-extension:// pages (WebDriver refuses to navigate there).
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');

  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  await driver.manage().setTimeouts({ script: 120_000 });

  await driver.execute(
    new Command('install addon')
      .setParameter('addon', fs.readFileSync(extensionPath).toString('base64'))
      .setParameter('temporary', true)
      .setParameter('allowPrivateBrowsing', !!opts.allowPrivateBrowsing)
  );

  /** Run a script in the browser chrome (privileged) context. */
  async function chrome(script, ...args) {
    await driver.setContext(firefox.Context.CHROME);
    try {
      return await driver.executeScript(script, ...args);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
  }

  /** Load an extension page into the current tab (privileged load from the chrome context). */
  async function openExtensionPage(relPath) {
    const url = `${extBase}/${relPath}`;
    await chrome(
      `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
         triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
       });`,
      url
    );
    await driver.wait(async () => (await driver.getCurrentUrl()) === url, 10_000);
    await driver.wait(async () => driver.executeScript('return document.readyState === "complete";'), 10_000);
  }

  /** Open the test harness page in the current tab. */
  async function openHarness() {
    await openExtensionPage('harness/harness.html');
    await driver.wait(async () => driver.executeScript('return !!window.sc;'), 10_000);
  }

  /** Call window.sc[fn](...args) inside the harness extension page (must be the current tab). */
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

  /** Firefox creates an empty placeholder under the final name and writes into `.part` first. */
  async function waitForDownload(previous = []) {
    for (let i = 0; i < 50; i++) {
      const files = fs.readdirSync(downloads);
      const done = files.filter(f => f.endsWith('.session') && !previous.includes(f));
      const writing = files.some(f => f.endsWith('.part'));
      if (done.length && !writing) {
        const file = path.join(downloads, done[0]);
        if (fs.statSync(file).size > 0) return file;
      }
      await sleep(200);
    }
    throw new Error('no complete .session file downloaded');
  }

  async function close() {
    await driver.quit();
    fs.rmSync(work, { recursive: true, force: true });
  }

  const version = (await driver.getCapabilities()).get('browserVersion');
  return { driver, version, downloads, chrome, openExtensionPage, openHarness, sc, waitForDownload, close };
}
