#!/usr/bin/env node
/**
 * Creates or updates the curated topics on the notification platform, through
 * its public API and this tenant's secret key, exactly as any tenant would.
 *
 *   PLATFORM_API_URL=https://api.example PLATFORM_SECRET_KEY=sk_… node content/seed.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = process.env.PLATFORM_API_URL?.replace(/\/$/, '');
const key = process.env.PLATFORM_SECRET_KEY;
if (!api || !key) { console.error('Set PLATFORM_API_URL and PLATFORM_SECRET_KEY'); process.exit(1); }

async function call(method, path, body, type = 'application/json') {
  const res = await fetch(api + path, { method, headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': type } : {}) }, body: body && (type === 'application/json' ? JSON.stringify(body) : body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(data.error ?? data)}`);
  return data;
}

const wanted = JSON.parse(readFileSync(join(here, 'topics.json'), 'utf8'));
const existing = new Map((await call('GET', '/v1/topics')).topics.map((t) => [t.slug, t]));
for (const t of wanted) {
  const topic = existing.get(t.slug) ?? await call('POST', '/v1/topics', { slug: t.slug, title: t.title, description: t.description, sensitive: t.sensitive, repeat: false });
  const r = await call('POST', `/v1/topics/${topic._id}/items:import`, readFileSync(join(here, t.file), 'utf8'), 'text/csv');
  console.log(`${existing.has(t.slug) ? 'updated' : 'created'}  ${t.slug.padEnd(10)} ${r.itemCount} lines`);
}
