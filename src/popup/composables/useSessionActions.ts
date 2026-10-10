import { captureFromTab, toSessionPayload } from '../../core/capture.js';
import {
  packToClipboardString,
  unpackFromClipboardString,
  packToFileBytes,
  unpackFromFileBytes
} from '../../core/pack.js';
import { CLIPBOARD_PREFIX, CLIPBOARD_MAX_CHARS } from '../../core/constants.js';
import { tabToSite } from '../../core/clear-site.js';
import { downloadSessionFile } from '../download';
import { useStatus } from './useStatus.js';
import { usePreferences } from './usePreferences.js';

/** Where a restored session opens: the caller's window and cookie store (container / private). */
export interface RestoreTarget {
  windowId?: number;
  cookieStoreId?: string;
}

type SessionLike = {
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: unknown[];
};

function sessionToRestorePayload(session: SessionLike) {
  return {
    origin: session.origin,
    localStorage: session.localStorage,
    sessionStorage: session.sessionStorage,
    cookies: session.cookies
  };
}

/** Firefox API errors → messages a user can act on. */
function firefoxErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (/missing host permission|cannot access/i.test(message)) {
    return 'Firefox does not allow access to this page. Allow site access for Session Copy, or try a normal website tab.';
  }
  if (/cookieStoreId|contextual identit/i.test(message)) {
    return 'Could not open the session in this container or private window.';
  }
  return undefined;
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no-tab');
  return tab;
}

/** Capture-able active tab (http/https), or a readable error. */
async function getActiveSiteTab() {
  const tab = await getActiveTab();
  const site = tabToSite(tab);
  if (site && 'unsupported' in site) throw new Error(site.reason);
  return tab as browser.tabs.Tab & { id: number };
}

export async function getRestoreTargetFromActiveTab(): Promise<RestoreTarget> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { windowId: tab?.windowId, cookieStoreId: tab?.cookieStoreId };
}

async function restoreSession(session: SessionLike, target: RestoreTarget) {
  const bgResp = await browser.runtime.sendMessage({
    action: 'openAndRestore',
    data: sessionToRestorePayload(session),
    target
  });
  if (!bgResp?.ok) throw new Error(bgResp?.error || 'bg-failed');
  return bgResp as { ok: true; cookiesSet: number; cookiesFailed: number };
}

export function useSessionActions() {
  const { setStatus } = useStatus();
  const { getCaptureOpts } = usePreferences();

  async function copySession() {
    setStatus('Capturing session from this tab…', 'loading');
    try {
      const tab = await getActiveSiteTab();

      const capOpts = await getCaptureOpts();
      const cap = await captureFromTab(tab.id, capOpts);
      const session = toSessionPayload(cap);
      const token = await packToClipboardString(session);

      if (token.length > CLIPBOARD_MAX_CHARS) {
        const bytes = await packToFileBytes(session);
        downloadSessionFile(cap.host, bytes);
        setStatus(
          `Session saved as an encrypted file (${Math.round(token.length / 1024)} KB). Share the file securely.`,
          'ok'
        );
        return;
      }

      await navigator.clipboard.writeText(token);
      setStatus('Encrypted session copied to clipboard.', 'ok');
    } catch (e) {
      console.error(e);
      const err = e as Error;
      setStatus(firefoxErrorMessage(err?.message) || err?.message || 'Could not copy session.', 'err');
    }
  }

  async function exportFile() {
    setStatus('Preparing encrypted file…', 'loading');
    try {
      const tab = await getActiveSiteTab();
      const capOpts = await getCaptureOpts();
      const cap = await captureFromTab(tab.id, capOpts);
      const session = toSessionPayload(cap);
      const bytes = await packToFileBytes(session);
      downloadSessionFile(cap.host, bytes);
      setStatus('Encrypted session file downloaded.', 'ok');
    } catch (e) {
      console.error(e);
      const err = e as Error;
      setStatus(firefoxErrorMessage(err?.message) || err?.message || 'Export failed.', 'err');
    }
  }

  async function pasteSession() {
    setStatus('Applying session…', 'loading');
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text.startsWith(CLIPBOARD_PREFIX)) throw new Error('no-token');

      const session = await unpackFromClipboardString(text);
      const bgResp = await restoreSession(session, await getRestoreTargetFromActiveTab());

      const extra =
        bgResp.cookiesFailed > 0
          ? ` ${bgResp.cookiesSet} cookies applied, ${bgResp.cookiesFailed} skipped.`
          : '';
      setStatus(`Session restored. The site was reloaded.${extra}`, 'ok');
    } catch (e) {
      console.error(e);
      const err = e as Error;
      const map: Record<string, string> = {
        'no-token': 'Nothing to paste — copy a session first, or import a file.',
        'bad-version': 'Unsupported session format.',
        truncated: 'Session data looks incomplete.',
        'bg-failed': 'Could not apply session.',
        'bad-origin': 'Invalid site in session data.',
        'no-tab': 'No active tab found.'
      };
      setStatus(
        map[err?.message] || firefoxErrorMessage(err?.message) || err?.message || 'Paste failed.',
        'err'
      );
    }
  }

  async function importFile(file: File, target: RestoreTarget) {
    setStatus('Reading session file…', 'loading');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const session = await unpackFromFileBytes(buf);
      const bgResp = await restoreSession(session, target);
      const extra =
        bgResp.cookiesFailed > 0
          ? ` ${bgResp.cookiesSet} cookies applied, ${bgResp.cookiesFailed} skipped.`
          : '';
      setStatus(`Session imported and site opened.${extra}`, 'ok');
    } catch (e) {
      console.error(e);
      const err = e as Error;
      const map: Record<string, string> = {
        'bad-magic': 'Not a valid Session Copy file.',
        'truncated-file': 'File appears corrupt or incomplete.',
        truncated: 'File appears corrupt or incomplete.',
        'bad-version': 'Unsupported file format.',
        'bad-origin': 'Invalid site in session data.',
        'bg-failed': 'Could not apply session.'
      };
      setStatus(
        map[err?.message] || firefoxErrorMessage(err?.message) || err?.message || 'Import failed.',
        'err'
      );
    }
  }

  /**
   * Firefox closes the toolbar popup as soon as a file picker opens, so importing happens in a
   * tab. The active tab's container is passed along so the session opens in the same jar.
   */
  async function openImportPage() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const params = new URLSearchParams();
    if (tab?.cookieStoreId) params.set('store', tab.cookieStoreId);
    await browser.tabs.create({
      url: browser.runtime.getURL(`import/import.html?${params}`),
      windowId: tab?.windowId
    });
    window.close();
  }

  return { copySession, pasteSession, exportFile, importFile, openImportPage };
}
