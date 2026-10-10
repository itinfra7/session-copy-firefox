// Minimal "log in" site for the e2e test. /login?who=X sets an HttpOnly session cookie, noise
// cookies and storage; every page renders what the server and the page can see in #state.
import http from 'node:http';

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(/;\s*/)
      .filter(Boolean)
      .map(c => {
        const i = c.indexOf('=');
        return [c.slice(0, i), c.slice(i + 1)];
      })
  );
}

function page(serverSession, loginScript = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test site</title></head><body>
<pre id="state"></pre>
<script>
${loginScript}
document.getElementById('state').textContent = JSON.stringify({
  server: ${JSON.stringify(serverSession ?? null)},
  access_token: localStorage.getItem('access_token'),
  ui_prefs: localStorage.getItem('ui_prefs'),
  id_token: sessionStorage.getItem('id_token')
});
</script></body></html>`;
}

export function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cookies = parseCookies(req.headers.cookie);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (url.pathname === '/login') {
      const who = (url.searchParams.get('who') || 'user').replace(/[^\w-]/g, '');
      res.setHeader('Set-Cookie', [
        `sessionid=${who}-secret; Path=/; HttpOnly; SameSite=Lax`,
        `_ga=GA1.2.${who}; Path=/`,
        `ui_theme=dark; Path=/`
      ]);
      const script = `localStorage.setItem('access_token', '${who}-token');
localStorage.setItem('ui_prefs', 'compact');
sessionStorage.setItem('id_token', '${who}-id');`;
      res.end(page(`${who}-secret`, script));
      return;
    }

    if (url.pathname === '/') {
      res.end(page(cookies.sessionid ?? null));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
