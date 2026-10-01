// Reading and writing RuneScape: Dragonwilds character saves (SaveCharacters\<name>.json).
//
// The game writes plain UTF-8 JSON in Unreal's pretty style: CRLF, tab indent, objects' braces on their own line,
// arrays' brackets on the key's line, number arrays on one line, floats printed with 17 significant digits. JSON.stringify can't reproduce that, so saving never re-serialises the file:
// it patches the text of only the values that changed and leaves every other byte exactly as the game wrote it.
// No DOM here, so the same code runs in the page and in node tests.

const SEP = '\u0001';
export const pathKey = path => path.join(SEP);

// Parses JSON and remembers where every value sits in the text: spans.get(pathKey(path)) = [start, end).
export function parseSave(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const spans = new Map();
  let i = 0;
  const fail = what => { throw new SyntaxError(`${what} at character ${i} (line ${text.slice(0, i).split('\n').length})`); };
  const ws = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const STR = /"(?:[^"\\\u0000-\u001f]|\\.)*"/y, NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const str = () => { STR.lastIndex = i; const m = STR.exec(text); if (!m) fail('Expected a string'); i = STR.lastIndex; return JSON.parse(m[0]); };
  function value(path) {
    ws();
    const start = i, c = text[i];
    let v;
    if (c === '{') {
      i++; v = {}; ws();
      if (text[i] === '}') i++;
      else for (;;) {
        ws(); if (text[i] !== '"') fail('Expected a key');
        const k = str(); ws();
        if (text[i++] !== ':') fail('Expected ":"');
        v[k] = value([...path, k]); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] !== '}') fail('Expected "," or "}"');
        break;
      }
    } else if (c === '[') {
      i++; v = []; ws();
      if (text[i] === ']') i++;
      else for (;;) {
        v.push(value([...path, v.length])); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] !== ']') fail('Expected "," or "]"');
        break;
      }
    } else if (c === '"') v = str();
    else if (text.startsWith('true', i)) { v = true; i += 4; }
    else if (text.startsWith('false', i)) { v = false; i += 5; }
    else if (text.startsWith('null', i)) { v = null; i += 4; }
    else { NUM.lastIndex = i; const m = NUM.exec(text); if (!m) fail('Unexpected character'); i = NUM.lastIndex; v = Number(m[0]); }
    spans.set(pathKey(path), [start, i]);
    return v;
  }
  const data = value([]);
  ws();
  if (i < text.length) fail('Unexpected text after the end');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('This is JSON, but not a character save');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = (/\n([ \t]+)\S/.exec(text) || [, '\t'])[1];
  return { text, data, spans, nl, unit };
}

// Where to find the parts the editor changes. Searched by key, so a game update that moves them still works.
export function findKey(data, key, path = []) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, key)) return [...path, key];
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object') { const p = findKey(v, key, [...path, Array.isArray(data) ? Number(k) : k]); if (p) return p; }
  }
  return null;
}
export const getAt = (data, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), data);

const lineIndent = (text, at) => { const s = text.lastIndexOf('\n', at - 1) + 1; return /^[ \t]*/.exec(text.slice(s, at))[0]; };

// Writes a value the way the game does, starting at an indent. Only strings, integers, booleans, string arrays and
// small objects are ever written by the editor; floats it didn't change are never touched.
function format(v, indent, doc, multiline = true) {
  const { nl, unit } = doc;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => typeof x === 'number')) return '[ ' + v.map(x => format(x, '', doc, false)).join(', ') + ' ]';
    if (!multiline) return '[' + v.map(x => format(x, '', doc, false)).join(', ') + ']';
    return '[' + nl + v.map(x => indent + unit + format(x, indent + unit, doc)).join(',' + nl) + nl + indent + ']';
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return multiline ? '{' + nl + indent + '}' : '{}';
    return '{' + nl + keys.map(k => indent + unit + JSON.stringify(k) + ':' + formatAfterKey(v[k], indent + unit, doc)).join(',' + nl) + nl + indent + '}';
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return ue17(v);
  return JSON.stringify(v);
}
// What follows `"key":`. Unreal keeps an array's bracket on the key's line and puts an object's brace on the next line.
function formatAfterKey(v, indent, doc) {
  return v && typeof v === 'object' && !Array.isArray(v) ? doc.nl + indent + format(v, indent, doc) : ' ' + format(v, indent, doc);
}
// %.17g, as Unreal prints doubles.
export function ue17(n) {
  if (!Number.isFinite(n)) return '0';
  let s = n.toPrecision(17);
  if (s.includes('e')) {
    const [m, e] = s.split('e');
    s = (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m) + 'e' + (e[0] === '-' ? '-' : '+') + e.replace(/^[+-]/, '').padStart(2, '0');
    return s;
  }
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

// Returns the new file text with each change applied. changes: [{ path, value }], value undefined removes the key.
// A path that doesn't exist yet is added to its parent object (which must exist).
export function patchSave(doc, changes) {
  const edits = [];
  for (const { path, value } of changes) {
    const span = doc.spans.get(pathKey(path));
    if (span) {
      if (value === undefined) { edits.push(removeKey(doc, path)); continue; }
      const multi = doc.text.includes('\n');
      // The value starts where the old one did, at that line's indent.
      edits.push([span[0], span[1], format(value, lineIndent(doc.text, span[0]), doc, multi)]);
    } else if (value !== undefined) {
      const parentSpan = doc.spans.get(pathKey(path.slice(0, -1)));
      const parent = getAt(doc.data, path.slice(0, -1));
      if (!parentSpan || !parent || typeof parent !== 'object' || Array.isArray(parent)) throw new Error('Cannot add ' + path.join('.'));
      const close = parentSpan[1] - 1;   // the "}"
      let end = close; while (/\s/.test(doc.text[end - 1])) end--;
      const empty = doc.text[end - 1] === '{';
      const indent = lineIndent(doc.text, close) + doc.unit;
      const key = path[path.length - 1];
      const ins = (empty ? '' : ',') + doc.nl + indent + JSON.stringify(String(key)) + ':' + formatAfterKey(value, indent, doc) + (empty ? doc.nl + lineIndent(doc.text, close) : '');
      edits.push([end, empty ? close : end, ins]);
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (let k = 1; k < edits.length; k++) if (edits[k][1] > edits[k - 1][0]) throw new Error('Overlapping changes');
  let text = doc.text;
  for (const [s, e, t] of edits) text = text.slice(0, s) + t + text.slice(e);
  return text;
}
function removeKey(doc, path) {
  // Remove `"key": value` together with one neighbouring comma, leaving the surrounding layout as it was.
  const [vs, ve] = doc.spans.get(pathKey(path));
  const t = doc.text;
  const ks = t.lastIndexOf(JSON.stringify(String(path[path.length - 1])), vs);
  let e = ve; while (/\s/.test(t[e])) e++;
  if (t[e] === ',') { e++; while (/\s/.test(t[e])) e++; return [ks, e, '']; }
  let s = ks; while (/\s/.test(t[s - 1])) s--;
  return t[s - 1] === ',' ? [s - 1, ve, ''] : [ks, ve, ''];
}

// Save ids are a 16-byte GUID in base64url (22 chars). Game data may list them as 32-char hex instead.
export function idToHex(id) {
  if (/^[0-9a-f]{32}$/i.test(id)) return id.toUpperCase();
  try {
    const b = atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==');
    return [...b].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch { return ''; }
}
export function hexToId(hex) {
  let s = '';
  for (let i = 0; i < 32; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const looksLikeId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
