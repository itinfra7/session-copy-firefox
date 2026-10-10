/** Save encrypted session bytes as `session-<host>-<timestamp>.session`. */
export function downloadSessionFile(host: string, bytes: Uint8Array) {
  const safeHost = (host || 'site').replace(/[^\w.-]+/g, '_').slice(0, 80);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${safeHost}-${new Date().toISOString().replace(/[:.]/g, '-')}.session`;
  // Firefox reads the blob after click() returns: keep the link in the document and the URL alive.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
