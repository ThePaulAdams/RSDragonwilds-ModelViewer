import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createIndex, search, renderResults, withAgentMeta, htmlToDoc, handleSearch, tokens } from '../agent-search.js';

const docs = [
  { path: 'enemies/AbyssalDemon', url: 'https://x.test/drops?enemy=AbyssalDemon', title: 'Abyssal Demon (enemy)', text: 'Enemy: Abyssal Demon. Drops: Soul Fragment, Abyssal Whip.' },
  { path: 'enemies/NC_AbyssalDemon', url: 'https://x.test/drops?enemy=NC_AbyssalDemon', title: 'NC Abyssal Demon (enemy)', text: 'Enemy: NC Abyssal Demon.' },
  { path: 'items/res_plank_oak', url: 'https://x.test/drops?item=1', title: 'Oak Plank', text: 'Item: Oak Plank. How to make: Oak Plank ×2 from 1 × Oak Logs.' },
  { path: '/crafting', url: 'https://x.test/crafting', title: 'Crafting planner', text: 'Raw materials, stations and levels for anything you want to make.' },
];
const index = createIndex(docs);

test('tokens drop stop words and plurals', () => {
  assert.deepEqual(tokens('How do I make Oak Planks?'), ['make', 'oak', 'plank']);
});
test('exact title beats a longer title that contains it', () => {
  const hits = search(index, 'abyssal demon');
  assert.equal(hits[0].doc.path, 'enemies/AbyssalDemon');
  assert.equal(hits[0].score, 1);
  assert.ok(hits[1].score < 1);
});
test('natural-language query finds the item', () => {
  assert.equal(search(index, 'how do I make an oak plank')[0].doc.path, 'items/res_plank_oak');
});
test('unknown word falls back to prefix matches', () => {
  assert.equal(search(index, 'abyss')[0].doc.title.includes('Abyssal'), true);
});
test('no words, no hits', () => {
  assert.deepEqual(search(index, 'the of and'), []);
});
test('markdown follows the Search for Agents layout', () => {
  const md = renderResults('oak "plank"', search(index, 'oak plank', 2));
  assert.match(md, /^# Search results for: "oak \\"plank\\""\n/);
  assert.match(md, /\n## items\/res_plank_oak \(score: 1\.000\)\n/);
  assert.match(md, /<https:\/\/x\.test\/drops\?item=1>/);
  assert.match(renderResults('zzz', []), /No results found/);
});
test('meta tags go in once, right after <head>', () => {
  const html = withAgentMeta('<!doctype html><html><head><title>t</title></head><body></body></html>', 'https://x.test/');
  assert.match(html, /<head>\n<meta name="agent:instructions" content="Use this search API/);
  assert.match(html, /<meta name="agent:endpoint" content="https:\/\/x\.test\/\.well-known\/search\?q=\{query\}">/);
  assert.match(html, /<meta name="agent:method" content="GET">/);
  assert.match(html, /<meta name="agent:documentation" content="https:\/\/developers\.cloudflare\.com\/ai-search\/how-to\/search-for-agents\/">/);
  assert.equal(withAgentMeta(html, 'https://x.test').match(/agent:endpoint/g).length, 1);
  assert.equal(withAgentMeta('no head here', 'https://x.test'), 'no head here');
});
test('htmlToDoc keeps visible text only', () => {
  const d = htmlToDoc('<html><head><title>T &amp; U</title><meta name="description" content="Desc"></head><body><script>var x=1</script><h1>Hello</h1><p>World &#39;s</p></body></html>');
  assert.equal(d.title, 'T & U');
  assert.equal(d.description, 'Desc');
  assert.equal(d.text, "Hello\nWorld 's");
});

test('HTTP: GET, QUERY (text and JSON), errors', async t => {
  const server = createServer(async (req, res) => {
    if (!(await handleSearch(req, res, { getIndex: () => index }))) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/.well-known/search`;

  let r = await fetch(base + '?q=oak+plank');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(await r.text(), /## items\/res_plank_oak/);

  r = await fetch(base, { method: 'QUERY', headers: { 'Content-Type': 'text/plain' }, body: 'abyssal demon' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^# Search results for: "abyssal demon"/);

  r = await fetch(base, { method: 'QUERY', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'crafting' }) });
  assert.match(await r.text(), /## \/crafting/);

  r = await fetch(base, { method: 'QUERY', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(base)).status, 400);
  assert.equal((await fetch(base, { method: 'POST', body: 'x' })).status, 405);
  r = await fetch(base, { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('allow'), /QUERY/);
  assert.equal((await fetch(base.replace('search', 'other'))).status, 404);
});
