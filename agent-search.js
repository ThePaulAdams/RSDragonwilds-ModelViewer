// Search for Agents, self-hosted. Same contract as Cloudflare's zone feature
// (https://developers.cloudflare.com/ai-search/how-to/search-for-agents/), without AI Search:
//   - every HTML page carries four <meta name="agent:*"> tags that point agents at the endpoint
//   - GET /.well-known/search?q=..., or QUERY /.well-known/search with a text/plain or {"q":"..."} JSON body
//   - the reply is Markdown: "# Search results for: ..." then one "## <path> (score: 0.000)" section per hit
// The site hands in its own documents; ranking is BM25 with a title boost. No dependencies.

export const SEARCH_PATH = '/.well-known/search';
export const INSTRUCTIONS = 'Use this search API to find relevant content across this site with keywords or natural-language queries, instead of crawling individual pages. Results are returned in Markdown.';
export const DOCUMENTATION = 'https://developers.cloudflare.com/ai-search/how-to/search-for-agents/';

const STOP = new Set(('a an and are as at be but by can do does for from get has have how i if in into is it its me my of on or ' +
  'so that the their them there these they this to was we were what when where which who why will with you your').split(' '));
const K1 = 1.2, B = 0.75, TITLE_WEIGHT = 3, MAX_QUERY = 500, MAX_BODY = 8192;

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  // engineering, engineered -> engineer. Queries and documents go through the same rules, so rough is fine.
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
  return w;
}
export function tokens(text) {
  const words = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  return words.filter(w => !STOP.has(w)).map(stem);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rsaquo: '›', lsaquo: '‹', mdash: '—', ndash: '–', hellip: '…', copy: '©' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
/** Visible text, <title> and meta description of an HTML page. Scripts, styles, SVG and <noscript> are dropped. */
export function htmlToDoc(html) {
  const pick = re => decodeEntities((html.match(re)?.[1] || '').replace(/\s+/g, ' ').trim());
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer|nav|ul|ol|table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, description, text };
}

/**
 * docs: [{ path, url, title, text, boost? }]. `path` is what the result heading shows, `url` the page to open,
 * `boost` multiplies the score (default 1).
 */
export function createIndex(docs) {
  const postings = new Map();   // term -> [[docIndex, weightedTf], ...]
  const lengths = [];
  docs.forEach((d, i) => {
    const tf = new Map();
    for (const t of tokens(d.title)) tf.set(t, (tf.get(t) || 0) + TITLE_WEIGHT);
    let n = 0;
    for (const t of tokens(d.text)) { tf.set(t, (tf.get(t) || 0) + 1); n++; }
    lengths.push(n + tokens(d.title).length * TITLE_WEIGHT);
    for (const [t, f] of tf) { let p = postings.get(t); if (!p) postings.set(t, p = []); p.push([i, f]); }
  });
  const avg = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1) || 1;
  return { docs, postings, lengths, avg, terms: [...postings.keys()] };
}

// A query word the index has never seen falls back to the words it starts ("drag" -> dragon, dragonfire).
function expand(index, t) {
  if (index.postings.has(t) || t.length < 3) return [t];
  const out = [];
  for (const term of index.terms) if (term.startsWith(t)) { out.push(term); if (out.length >= 25) break; }
  return out.length ? out : [t];
}

/** Ranked hits: [{ doc, score }] where score is 0..1, relative to the best match for this query. */
export function search(index, query, limit = 10) {
  const words = [...new Set(tokens(query))];
  if (!words.length) return [];
  const N = index.docs.length, raw = new Map(), matched = new Map();
  words.forEach((w, wi) => {
    for (const t of expand(index, w)) {
      const p = index.postings.get(t);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
      for (const [i, f] of p) {
        const s = idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * index.lengths[i] / index.avg));
        raw.set(i, (raw.get(i) || 0) + s);
        let m = matched.get(i); if (!m) matched.set(i, m = new Set()); m.add(wi);
      }
    }
  });
  const phrase = String(query).toLowerCase().replace(/\s+/g, ' ').trim();
  const scored = [...raw].map(([i, s]) => {
    const d = index.docs[i];
    const coverage = matched.get(i).size / words.length;
    // The query is the title ("abyssal demon" -> "Abyssal Demon (enemy)") > the title contains it > neither.
    const title = String(d.title || '').toLowerCase(), bare = title.replace(/\s*\([^)]*\)\s*$/, '');
    const exact = phrase.length < 3 ? 1 : bare === phrase || title === phrase ? 2 : title.includes(phrase) ? 1.5 : 1;
    return { doc: d, raw: s * (0.4 + 0.6 * coverage) * exact * (d.boost ?? 1), coverage };
  });
  const top = Math.max(...scored.map(h => h.raw)) || 1;
  return scored.map(h => ({ doc: h.doc, score: Math.min(1, (h.raw / top) * (0.5 + 0.5 * h.coverage)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

function excerpt(text, query, max = 1200) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  let at = -1;
  for (const w of String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  let start = Math.max(0, at - 200);
  if (start > 0) { const sp = t.indexOf(' ', start); start = sp > 0 && sp - start < 40 ? sp + 1 : start; }
  let end = Math.min(t.length, start + max);
  if (end < t.length) { const sp = t.lastIndexOf(' ', end); if (sp > start + max / 2) end = sp; }
  return (start > 0 ? '… ' : '') + t.slice(start, end).trim() + (end < t.length ? ' …' : '');
}

export function renderResults(query, hits) {
  const q = String(query).replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"');
  const out = [`# Search results for: "${q}"`, ''];
  if (!hits.length) out.push('No results found. Try fewer or different keywords.', '');
  for (const { doc, score } of hits) {
    out.push(`## ${doc.path} (score: ${score.toFixed(3)})`, '');
    if (doc.title) out.push(`**${doc.title.replace(/\*/g, '\\*')}**`);
    if (doc.url) out.push(`<${doc.url}>`);
    out.push('', excerpt(doc.text, query).replace(/^(\s*)#/gm, '$1\\#'), '');
  }
  return out.join('\n');
}

/** The four discovery tags, for a page's <head>. */
export function metaTags(siteUrl) {
  const endpoint = siteUrl.replace(/\/$/, '') + SEARCH_PATH + '?q={query}';
  return `<meta name="agent:instructions" content="${escAttr(INSTRUCTIONS)}">\n` +
    `<meta name="agent:endpoint" content="${escAttr(endpoint)}">\n` +
    `<meta name="agent:method" content="GET">\n` +
    `<meta name="agent:documentation" content="${escAttr(DOCUMENTATION)}">`;
}
/** Adds the tags right after <head>, once. Pages without a <head> are left alone. */
export function withAgentMeta(html, siteUrl) {
  const s = String(html);
  if (s.includes('name="agent:endpoint"')) return s;
  return s.replace(/<head(\s[^>]*)?>/i, m => `${m}\n${metaTags(siteUrl)}`);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, QUERY, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

async function readQuery(req, url) {
  if (req.method !== 'QUERY') return url.searchParams.get('q') || '';
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw Object.assign(new Error('Query too large'), { status: 413 }); }
  if (/application\/json/i.test(req.headers['content-type'] || '')) {
    let j; try { j = JSON.parse(body); } catch { throw Object.assign(new Error('Body is not valid JSON'), { status: 400 }); }
    return typeof j?.q === 'string' ? j.q : '';
  }
  return body || url.searchParams.get('q') || '';
}

/**
 * Node http handler for /.well-known/search. `getIndex` returns (or resolves to) an index from createIndex.
 * Returns true when it handled the request.
 */
export async function handleSearch(req, res, { getIndex, limit = 10 }) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== SEARCH_PATH && url.pathname !== SEARCH_PATH + '/') return false;
  const reply = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex', ...CORS, ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, Allow: 'GET, HEAD, QUERY, OPTIONS', 'Access-Control-Max-Age': '86400' }); res.end(); return true; }
  if (!['GET', 'HEAD', 'QUERY'].includes(req.method)) return reply(405, '# Method not allowed\n\nUse GET with `?q=`, or QUERY with a text or JSON body.\n', { Allow: 'GET, HEAD, QUERY, OPTIONS', 'Cache-Control': 'no-store' });
  let q;
  try { q = (await readQuery(req, url)).trim().slice(0, MAX_QUERY); }
  catch (e) { return reply(e.status || 400, `# Bad request\n\n${e.message}.\n`, { 'Cache-Control': 'no-store' }); }
  if (!q) return reply(400, `# Search\n\nAdd a query: \`GET ${SEARCH_PATH}?q=your+question\`, or send \`QUERY ${SEARCH_PATH}\` with the query as a text/plain body or as \`{"q": "..."}\` JSON.\n`, { 'Cache-Control': 'no-store' });
  const hits = search(await getIndex(), q, limit);
  return reply(200, renderResults(q, hits), { 'Cache-Control': 'public, max-age=300' });
}
