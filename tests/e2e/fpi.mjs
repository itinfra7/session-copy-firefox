// Capture / clear / restore with first-party isolation on (privacy.firstparty.isolate),
// where every cookies API write must name the cookie's firstPartyDomain.
import assert from 'node:assert/strict';
import { launch, createSteps } from './lib.mjs';
import { startSite } from './site.mjs';

const site = await startSite();
const ff = await launch({ prefs: { 'privacy.firstparty.isolate': true } });
const { sc } = ff;
const steps = createSteps();
const { step } = steps;

try {
  console.log(`Firefox ${ff.version} — first-party isolation on — test site ${site.origin}`);
  await ff.openHarness();
  let session;
  let siteTab;
  let firstPartyDomain;

  await step('capture reads the isolated cookie jar', async () => {
    siteTab = await sc('openTab', `${site.origin}/login?who=fay`);
    await sc('navigate', siteTab, `${site.origin}/`);
    const jar = await sc('cookies', site.origin, 'firefox-default');
    firstPartyDomain = jar.find(c => c.name === 'sessionid')?.firstPartyDomain;
    assert.ok(firstPartyDomain, 'cookie carries a firstPartyDomain');
    session = await sc('capture', siteTab, { loginOnlyMode: true });
    assert.equal(session.cookies.find(c => c.name === 'sessionid')?.value, 'fay-secret');
  });

  await step('clear removes isolated cookies', async () => {
    const r = await sc('clear', siteTab);
    assert.equal(r.cookiesFailed, 0);
    assert.ok(r.cookiesRemoved >= 1);
    assert.equal((await sc('cookies', site.origin, 'firefox-default')).length, 0);
  });

  await step('restore sets cookies in the site’s first-party jar and signs in', async () => {
    const { resp, tabIds } = await sc('restore', session, 'firefox-default');
    assert.equal(resp.ok, true, JSON.stringify(resp));
    assert.equal(resp.cookiesFailed, 0, `cookies failed: ${resp.cookiesFailed}`);
    assert.equal((await sc('readState', tabIds[0])).server, 'fay-secret');
    const jar = await sc('cookies', site.origin, 'firefox-default');
    const sid = jar.find(c => c.name === 'sessionid');
    assert.equal(sid?.firstPartyDomain, firstPartyDomain);
    assert.ok(!jar.some(c => c.name.startsWith('__session_copy_probe')), 'probe cookie removed');
  });
} finally {
  await ff.close();
  site.close();
}

const { failures } = steps;
console.log(failures ? `\n${failures} FPI step(s) failed` : '\nAll FPI steps passed');
process.exit(failures ? 1 : 0);
