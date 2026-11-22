import { unzipSync, strFromU8 } from 'fflate';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import { checkText, type ContentWarning } from './content.js';
import type { PlatformTopic } from './platform.js';
import { JOURNAL_TOPIC_SLUG } from './limits.js';

/**
 * Bulk import of topics from a zip of CSV files (design: docs/design/LLD.md, G10). One CSV = one topic:
 * `# key: value` header lines (slug, title, description, sensitive, visibility, repeat), then a notes table with
 * `body` and optional `attribution`, `media` (image) and `link` (page opened on tap).
 */
export const LIMITS = { zipBytes: 5 * 1024 * 1024, files: 100, notesPerFile: 1000, body: 300, attribution: 120 };

export interface Note { row: number; body: string; attribution: string | null; imageUrl: string | null; clickUrl: string | null; warnings: ContentWarning[] }
export interface TopicFile {
  file: string; slug: string | null;
  meta: { title: string | null; description: string | null; sensitive: boolean | null; visibility: 'public' | 'private' | null; repeat: boolean | null };
  notes: Note[]; errors: string[];
}

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('a quoted field is not closed');
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const bool = (v: string | undefined, key: string, errors: string[]) => {
  if (v === undefined || v === '') return null;
  if (/^(true|yes|1)$/i.test(v)) return true;
  if (/^(false|no|0)$/i.test(v)) return false;
  errors.push(`${key} must be true or false`); return null;
};
const https = (v: string, what: string, errors: string[], row: number) => {
  if (!v) return null;
  try { if (new URL(v.replace(/\{(deliveryId|token)\}/g, 'x')).protocol === 'https:' && v.length <= 2000) return v; } catch { /* below */ }
  errors.push(`row ${row}: the ${what} must be an https:// address`); return null;
};
const COLS = { body: ['body', 'text', 'note'], attribution: ['attribution', 'author', 'source'], media: ['media', 'image_url', 'imageurl', 'media_src', 'image'], link: ['link', 'click_url', 'clickurl', 'url'] };

export function parseTopicFile(file: string, raw: string): TopicFile {
  const errors: string[] = [];
  const text = raw.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (!l.startsWith('#')) break;
    const m = /^#\s*([a-z_]+)\s*:\s*(.*)$/i.exec(l);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  const out: TopicFile = {
    file, slug: meta.slug ?? null, notes: [], errors,
    meta: { title: meta.title ?? null, description: meta.description ?? null, sensitive: bool(meta.sensitive, 'sensitive', errors), repeat: bool(meta.repeat, 'repeat', errors),
      visibility: meta.visibility ? (/^(public|private)$/i.test(meta.visibility) ? (meta.visibility.toLowerCase() as 'public' | 'private') : (errors.push('visibility must be public or private'), null)) : null },
  };
  if (!out.slug) errors.push('missing "# slug: …" line');
  else if (!/^[a-z0-9-]{2,40}$/.test(out.slug)) errors.push('slug: 2 to 40 lower-case letters, digits or dashes');
  else if (out.slug === JOURNAL_TOPIC_SLUG || out.slug.startsWith('u-')) errors.push(`slug "${out.slug}" is reserved`);
  if (out.meta.title && out.meta.title.length > 60) errors.push('title: at most 60 characters');
  if (out.meta.description && out.meta.description.length > 300) errors.push('description: at most 300 characters');
  let rows: string[][];
  try { rows = parseCsv(lines.slice(i).join('\n')); } catch (e) { errors.push(`notes table: ${(e as Error).message}`); return out; }
  if (!rows.length) { errors.push('no notes table (a header row with "body", then one note per row)'); return out; }
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]/g, '_'));
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const c = { body: col(COLS.body), attribution: col(COLS.attribution), media: col(COLS.media), link: col(COLS.link) };
  if (c.body < 0) { errors.push('the notes table needs a "body" column'); return out; }
  const data = rows.slice(1);
  if (data.length > LIMITS.notesPerFile) errors.push(`at most ${LIMITS.notesPerFile} notes per file (${data.length})`);
  const at = (r: string[], k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
  data.slice(0, LIMITS.notesPerFile).forEach((r, n) => {
    const row = n + 2; // spreadsheet row: the header is row 1
    const body = at(r, c.body).replace(/\s+/g, ' ');
    if (!body) return;
    if (body.length > LIMITS.body) { errors.push(`row ${row}: note longer than ${LIMITS.body} characters (${body.length})`); return; }
    const attribution = at(r, c.attribution) || null;
    if (attribution && attribution.length > LIMITS.attribution) { errors.push(`row ${row}: attribution longer than ${LIMITS.attribution} characters`); return; }
    const imageUrl = https(at(r, c.media), 'media link', errors, row);
    const clickUrl = https(at(r, c.link), 'link', errors, row);
    out.notes.push({ row, body, attribution, imageUrl, clickUrl, warnings: checkText(body) });
  });
  if (!out.notes.length && !errors.length) errors.push('no notes');
  return out;
}

export function readZip(buf: Buffer): { name: string; text: string }[] {
  if (buf.length > LIMITS.zipBytes) throw new HttpError(413, 'too_large', 'The zip is larger than 5 MB');
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(buf), { filter: (f) => /\.csv$/i.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) && f.originalSize < 2 * 1024 * 1024 }); }
  catch { throw new HttpError(422, 'invalid_zip', 'This is not a zip file that can be opened'); }
  const files = Object.entries(entries).map(([name, data]) => ({ name, text: strFromU8(data) })).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) throw new HttpError(422, 'invalid_zip', 'The zip contains no .csv files');
  if (files.length > LIMITS.files) throw new HttpError(422, 'invalid_zip', `At most ${LIMITS.files} CSV files in one zip`);
  return files;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export interface PlanItem extends TopicFile {
  action: 'create' | 'append' | 'skip';
  topicId: string | null; existingNotes: number;
  add: Note[]; duplicates: number; warnings: number; changes: string[];
}

/** What an import would do, file by file, without saving anything. */
export async function plan(ctx: Ctx, files: { name: string; text: string }[]): Promise<PlanItem[]> {
  const topics = await ctx.platform.topics();
  const bySlug = new Map<string, PlatformTopic>(topics.map((t) => [t.slug, t]));
  const seenSlugs = new Set<string>();
  const out: PlanItem[] = [];
  for (const f of files) {
    const t = parseTopicFile(f.name, f.text);
    if (t.slug && seenSlugs.has(t.slug)) t.errors.push(`slug "${t.slug}" appears in more than one file`);
    if (t.slug) seenSlugs.add(t.slug);
    const existing = t.slug ? bySlug.get(t.slug) ?? null : null;
    if (!existing && t.slug && !t.meta.title) t.errors.push('a new topic needs a "# title: …" line');
    const known = new Set(existing ? (await ctx.platform.lines(existing._id)).map((l) => norm(l.body)) : []);
    const add: Note[] = []; let duplicates = 0;
    for (const n of t.notes) { const k = norm(n.body); if (known.has(k)) { duplicates++; continue; } known.add(k); add.push(n); }
    const changes: string[] = [];
    if (existing) {
      if (t.meta.title && t.meta.title !== existing.title) changes.push(`title → ${t.meta.title}`);
      if (t.meta.description !== null && t.meta.description !== existing.description) changes.push('description updated');
      if (t.meta.sensitive !== null && t.meta.sensitive !== existing.sensitive) changes.push(`sensitive → ${t.meta.sensitive}`);
      if (t.meta.repeat !== null && t.meta.repeat !== existing.repeat) changes.push(`repeat → ${t.meta.repeat}`);
      if (t.meta.visibility === 'public' && existing.visibility === 'private') changes.push('made public');
      if (t.meta.visibility === 'private' && existing.visibility === 'public') changes.push('stays public (a public topic never becomes private)');
    }
    const action = t.errors.length ? 'skip' : existing ? 'append' : 'create';
    out.push({ ...t, action, topicId: existing?._id ?? null, existingNotes: existing?.itemCount ?? 0, add, duplicates, warnings: add.filter((n) => n.warnings.length).length, changes });
  }
  return out;
}

/** Applies a plan: files with problems are skipped whole; the rest create topics or append new notes. */
export async function apply(ctx: Ctx, items: PlanItem[], audit: (action: string, target: string, after: unknown) => Promise<void>) {
  const results: { file: string; slug: string | null; action: PlanItem['action']; added: number; error: string | null }[] = [];
  for (const it of items) {
    if (it.action === 'skip') { results.push({ file: it.file, slug: it.slug, action: 'skip', added: 0, error: it.errors.join('; ') }); continue; }
    try {
      let topicId = it.topicId;
      if (it.action === 'create') {
        const t = await ctx.platform.createTopic({ slug: it.slug!, title: it.meta.title!, description: it.meta.description ?? '', sensitive: it.meta.sensitive ?? false, repeat: it.meta.repeat ?? false, visibility: it.meta.visibility ?? 'private' });
        topicId = t._id;
      } else {
        const patch: Record<string, unknown> = {};
        if (it.meta.title) patch.title = it.meta.title;
        if (it.meta.description !== null) patch.description = it.meta.description;
        if (it.meta.sensitive !== null) patch.sensitive = it.meta.sensitive;
        if (it.meta.repeat !== null) patch.repeat = it.meta.repeat;
        if (it.meta.visibility === 'public') patch.visibility = 'public';
        if (Object.keys(patch).length) await ctx.platform.patchTopic(topicId!, patch);
      }
      let added = 0;
      for (let i = 0; i < it.add.length; i += 1000) {
        const r = await ctx.platform.appendLines(topicId!, it.add.slice(i, i + 1000).map((n) => ({ body: n.body, attribution: n.attribution, imageUrl: n.imageUrl, clickUrl: n.clickUrl })));
        added += r.created.length;
      }
      await audit(it.action === 'create' ? 'topic.import_create' : 'topic.import_append', it.slug!, { file: it.file, added, meta: it.meta });
      results.push({ file: it.file, slug: it.slug, action: it.action, added, error: null });
    } catch (e) {
      results.push({ file: it.file, slug: it.slug, action: it.action, added: 0, error: (e as Error).message });
    }
  }
  return results;
}
