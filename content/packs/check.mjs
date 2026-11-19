#!/usr/bin/env node
/**
 * Checks every topic pack before it is published: 92+ rows, seq 0..n-1, bodies 1..280 chars, and no exact or
 * near-duplicate line (same rule as the console importer: >= 80% shared words) within a pack, across packs,
 * or against the app's curated topics in ../topics/. Exit code 1 on any problem.
 *
 *   node content/packs/check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const sim = (a, b) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, A.size + B.size - n); };

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const curated = JSON.parse(readFileSync(join(here, '..', 'topics.json'), 'utf8'));
const slugs = new Set(curated.map((t) => t.slug));
const problems = []; const seen = [];
for (const t of curated) for (const r of parseCsv(readFileSync(join(here, '..', t.file), 'utf8')).slice(1)) seen.push({ n: norm(r[1]), where: `${t.slug}#${r[0]}` });
for (const run of manifest.runs) for (const t of run.topics) {
  if (slugs.has(t.slug)) problems.push(`duplicate topic slug ${t.slug}`); slugs.add(t.slug);
  const rows = parseCsv(readFileSync(join(here, t.file), 'utf8'));
  if (rows[0].join(',') !== 'seq,body,attribution') problems.push(`${t.file}: header must be seq,body,attribution`);
  const body = rows.slice(1);
  if (body.length < 92) problems.push(`${t.file}: ${body.length} rows, need at least 92`);
  if (body.length !== t.lines) problems.push(`${t.file}: manifest says ${t.lines} lines, file has ${body.length}`);
  body.forEach((r, i) => {
    const where = `${t.slug}#${r[0]}`;
    if (Number(r[0]) !== i) problems.push(`${where}: seq should be ${i}`);
    const b = (r[1] ?? '').trim();
    if (!b || b.length > 280) problems.push(`${where}: body length ${b.length}`);
    const n = norm(b);
    for (const s of seen) { const x = sim(s.n, n); if (s.n === n || x >= 0.8) problems.push(`${where} ~ ${s.where} (${x.toFixed(2)})`); }
    seen.push({ n, where });
  });
}
for (const f of readdirSync(join(here, 'csv'))) if (!manifest.runs.some((r) => r.topics.some((t) => t.file === `csv/${f}`))) problems.push(`csv/${f} is not in manifest.json`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`ok: ${manifest.runs.reduce((a, r) => a + r.topics.length, 0)} packs, ${seen.length} lines checked (curated topics included)`);
