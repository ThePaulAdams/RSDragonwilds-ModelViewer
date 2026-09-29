// Tiny web server for hosting the viewer (Railway). No dependencies.
//   SITE_PASSWORD  optional: when set, the site asks for this password; when unset, the site is public
//   UPLOAD_TOKEN   token deploy.ps1 uses to upload model data (required for uploads)
//   DATA_DIR       where the model data lives (a Railway volume), default /data
//   SITE_NAME      name shown on the login page and tab
//   SITE_CLOSED    when set, visitors see a short "coming soon" page (uploads still work)
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, mkdir, rename, readdir } from 'node:fs/promises';
import { dirname, join, normalize, sep, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const SITE_NAME = process.env.SITE_NAME || 'Relic Atlas';
const PASSWORD = process.env.SITE_PASSWORD || '';
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';
const CLOSED = !!process.env.SITE_CLOSED;
const DATA = normalize(process.env.DATA_DIR || '/data');
const APP = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const COOKIE = 'atlas';
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.webp': 'image/webp', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
// The cookie is signed with the password, so changing SITE_PASSWORD logs everyone out.
const sign = v => createHmac('sha256', 'atlas:' + PASSWORD).update(v).digest('base64url');
function authed(req) {
  if (!PASSWORD) return true;   // public site
  const c = (req.headers.cookie || '').split(/;\s*/).find(s => s.startsWith(COOKIE + '='));
  if (!c || !PASSWORD) return false;
  const [exp, mac] = c.slice(COOKIE.length + 1).split('.');
  return !!mac && same(mac, sign(exp)) && Number(exp) > Date.now();
}
const bearer = req => !!UPLOAD_TOKEN && same(req.headers.authorization || '', 'Bearer ' + UPLOAD_TOKEN);

// Resolves a request path inside a folder, refusing anything that escapes it.
function inside(base, rel) {
  const p = normalize(join(base, decodeURIComponent(rel)));
  return p.startsWith(base + sep) ? p : null;
}

let thumbsList = null;   // cached list of saved previews, reset on upload
async function listFiles(dir, base = dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, base, out);
    else if (!e.name.endsWith('.tmp')) out.push([p.slice(base.length + 1).split(sep).join('/'), p]);
  }
  return out;
}

async function sendFile(req, res, file, cache) {
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) return send(res, 404, 'Not found');
  const etag = `"${s.size.toString(36)}-${s.mtimeMs.toString(36)}"`;
  const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (/\.(json|html)$/.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const body = gzipSync(await readFile(file));
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(200, { ...headers, 'Content-Length': s.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
function send(res, code, text, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}
async function receive(req, file) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await pipeline(req, createWriteStream(tmp));
  await rename(tmp, file);
  thumbsList = null;
}

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function loginPage(error) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SITE_NAME)}</title><style>
:root{color-scheme:dark;--bg:#0f1115;--panel:#181b21;--line:#2a2f38;--text:#e6e8ec;--muted:#9aa3b2;--accent:#e0b04a}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 20%,#1c2029,var(--bg));color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:16px}
form{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{margin:0 0 4px;font-size:22px;letter-spacing:.5px}h1 span{color:var(--accent)}p{margin:0 0 20px;color:var(--muted);font-size:13px}
input[type=password]{width:100%;padding:11px 12px;border-radius:8px;border:1px solid var(--line);background:#0f1115;color:var(--text);font-size:15px}
input[type=password]:focus{outline:2px solid var(--accent);border-color:transparent}
label{display:flex;gap:8px;align-items:center;margin:14px 0 18px;color:var(--muted);font-size:13px}
button{width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#1a1405;font-weight:600;font-size:15px;cursor:pointer}
.err{color:#ff8a80;margin:-8px 0 14px;font-size:13px}</style></head><body>
<form method="post" action="/login"><h1>&#9670; <span>${esc(SITE_NAME)}</span></h1><p>A private library of 3D models.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
<label><input type="checkbox" name="remember" checked> Remember me on this device</label>
<button>Enter</button></form></body></html>`;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path === '/healthz') return send(res, 200, 'ok');

    // Data upload (deploy.ps1), authenticated by UPLOAD_TOKEN.
    if (path.startsWith('/_data/')) {
      if (!bearer(req)) return send(res, 401, 'Unauthorized');
      if (path === '/_data/list' && req.method === 'GET') {
        const files = {};
        for (const [rel, p] of await listFiles(DATA)) files[rel] = (await stat(p)).size;
        return send(res, 200, JSON.stringify(files), { 'Content-Type': 'application/json' });
      }
      const file = path.startsWith('/_data/file/') && req.method === 'PUT' && inside(DATA, path.slice(12));
      if (!file) return send(res, 400, 'Bad request');
      await receive(req, file);
      return send(res, 204, '');
    }

    if (CLOSED) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600' });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(SITE_NAME)}</title>`+
        `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e8ec;font:16px system-ui,sans-serif">`+
        `<p>${esc(SITE_NAME)} is coming soon.</p></body>`);
    }

    if (path === '/login') {
      if (!PASSWORD) { res.writeHead(303, { Location: '/' }); return res.end(); }
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) break; }
        const form = new URLSearchParams(body);
        if (!same(form.get('password') || '', PASSWORD)) {
          await new Promise(r => setTimeout(r, 800));   // slow down guessing
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(loginPage('That password is not right.'));
        }
        const remember = form.get('remember') === 'on';
        const exp = String(Date.now() + (remember ? 90 : 1) * 86400e3);
        const cookie = `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax` + (remember ? `; Max-Age=${90 * 86400}` : '');
        res.writeHead(303, { Location: '/', 'Set-Cookie': cookie });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loginPage());
    }

    if (!authed(req)) {
      if (req.method === 'GET' && (path === '/' || path.endsWith('.html'))) { res.writeHead(303, { Location: '/login' }); return res.end(); }
      return send(res, 401, 'Log in first');
    }
    if (path === '/logout') {
      res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
      return res.end();
    }

    if (path === '/site-config.json') return send(res, 200, JSON.stringify({ name: SITE_NAME, login: !!PASSWORD }), { 'Content-Type': 'application/json' });
    if (path === '/' || path === '/index.html') return sendFile(req, res, join(APP, 'index.html'), 'no-cache');
    if (path === '/thumbs-list') {
      thumbsList ??= JSON.stringify((await listFiles(join(DATA, 'thumbs'))).map(([rel]) => rel).filter(r => r.endsWith('.webp')));
      return send(res, 200, thumbsList, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    }
    if (path.startsWith('/export/')) {
      const file = inside(DATA, path.slice(8));
      if (!file) return send(res, 400, 'Bad request');
      // Previews the viewer draws for models that don't have one yet.
      if (req.method === 'PUT') {
        if (!PASSWORD) return send(res, 403, 'Forbidden');   // public site: previews come from deploy.ps1 only
        if (!file.startsWith(join(DATA, 'thumbs') + sep) || !file.endsWith('.webp')) return send(res, 403, 'Forbidden');
        await receive(req, file);
        return send(res, 204, '');
      }
      // models.json changes with each upload; everything else is cached for a day, then revalidated by ETag.
      return sendFile(req, res, file, file.endsWith('models.json') ? 'no-cache' : 'public, max-age=86400');
    }
    send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Server error'); else res.end();
  }
}).listen(process.env.PORT || 8080, () => console.log(`${SITE_NAME} on :${process.env.PORT || 8080}, data in ${DATA}`));
