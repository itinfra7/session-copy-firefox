import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  packToClipboardString,
  unpackFromClipboardString,
  packToFileBytes,
  unpackFromFileBytes
} from '../../src/core/pack.js';
import { CLIPBOARD_PREFIX } from '../../src/core/constants.js';

const fixture = name => new URL(`../fixtures/${name}`, import.meta.url);
const expected = JSON.parse(readFileSync(fixture('chrome-expected.json'), 'utf8'));

const session = {
  origin: 'https://example.test',
  createdAt: 1760000000000,
  localStorage: { access_token: 'a' },
  sessionStorage: { csrf_token: 'b' },
  cookies: [{ name: 'sid', value: 'c', domain: 'example.test', path: '/', secure: true, httpOnly: true, hostOnly: true }]
};

test('clipboard token round-trips', async () => {
  const token = await packToClipboardString(session);
  assert.ok(token.startsWith(CLIPBOARD_PREFIX));
  assert.deepEqual(await unpackFromClipboardString(token), session);
});

test('.session file round-trips', async () => {
  const bytes = await packToFileBytes(session);
  assert.deepEqual(await unpackFromFileBytes(bytes), session);
});

test('reads a clipboard token made by the Chrome version', async () => {
  const token = readFileSync(fixture('chrome-token.txt'), 'utf8');
  assert.deepEqual(await unpackFromClipboardString(token), expected);
});

test('reads a .session file made by the Chrome version', async () => {
  const bytes = new Uint8Array(readFileSync(fixture('chrome-file.session')));
  assert.deepEqual(await unpackFromFileBytes(bytes), expected);
});

test('rejects tampered tokens', async () => {
  const token = await packToClipboardString(session);
  const last = token.at(-2) === 'A' ? 'B' : 'A';
  await assert.rejects(unpackFromClipboardString(token.slice(0, -2) + last + token.at(-1)));
  await assert.rejects(unpackFromClipboardString('hello'), /no-token/);
});
