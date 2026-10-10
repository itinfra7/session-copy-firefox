import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCookieSetDetails } from '../../src/core/cookies-apply.js';

const base = { value: 'v', path: '/', secure: false, httpOnly: true };

test('domain cookie keeps Domain and targets the origin', () => {
  const d = buildCookieSetDetails('https://www.example.com', {
    ...base,
    name: 'sid',
    domain: '.example.com',
    hostOnly: false
  });
  assert.equal(d.url, 'https://www.example.com/');
  assert.equal(d.domain, '.example.com');
});

test('host-only cookie is set without Domain on its own host', () => {
  const d = buildCookieSetDetails('https://example.com', {
    ...base,
    name: 'sid',
    domain: 'auth.example.com',
    hostOnly: true
  });
  assert.equal(d.url, 'https://auth.example.com/');
  assert.equal('domain' in d, false);
});

test('host-only cookie on an IP origin keeps the port-carrying origin URL', () => {
  const d = buildCookieSetDetails('http://127.0.0.1:8080', {
    ...base,
    name: 'sid',
    domain: '127.0.0.1',
    hostOnly: true
  });
  assert.equal(d.url, 'http://127.0.0.1:8080/');
  assert.equal('domain' in d, false);
});

test('Chrome tokens (no hostOnly field) keep the upstream Domain behaviour', () => {
  const d = buildCookieSetDetails('https://example.com', { ...base, name: 'sid', domain: 'example.com' });
  assert.equal(d.domain, 'example.com');
});

test('__Host- cookies: secure, path /, no Domain', () => {
  const d = buildCookieSetDetails('https://example.com', {
    ...base,
    name: '__Host-token',
    domain: 'example.com',
    path: '/app'
  });
  assert.equal(d.secure, true);
  assert.equal(d.path, '/');
  assert.equal(d.url, 'https://example.com/');
  assert.equal('domain' in d, false);
});

test('__Secure- cookies are forced secure', () => {
  const d = buildCookieSetDetails('https://example.com', { ...base, name: '__Secure-x', domain: '.example.com' });
  assert.equal(d.secure, true);
});

test('sameSite: Firefox values pass, Chrome "unspecified" is dropped', () => {
  for (const v of ['no_restriction', 'lax', 'strict']) {
    assert.equal(buildCookieSetDetails('https://e.com', { ...base, name: 'a', sameSite: v }).sameSite, v);
  }
  assert.equal('sameSite' in buildCookieSetDetails('https://e.com', { ...base, name: 'a', sameSite: 'unspecified' }), false);
});

test('target storeId (container / private window) is applied, never the source one', () => {
  const d = buildCookieSetDetails(
    'https://e.com',
    { ...base, name: 'a', storeId: 'firefox-container-9' },
    'firefox-container-2'
  );
  assert.equal(d.storeId, 'firefox-container-2');
  assert.equal('storeId' in buildCookieSetDetails('https://e.com', { ...base, name: 'a' }), false);
});

test('nameless cookies are skipped', () => {
  assert.equal(buildCookieSetDetails('https://e.com', { ...base, name: '' }), null);
});
