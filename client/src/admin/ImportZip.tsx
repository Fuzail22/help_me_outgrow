import { useState } from 'react';

interface Row {
  file: string; slug: string | null; action: 'create' | 'append' | 'skip'; title: string | null; visibility: string | null;
  existingNotes: number; adding: number; duplicates: number; warnings: number; changes: string[]; errors: string[];
  sample: { body: string; link: string | null; media: string | null; warnings: string[] }[];
}
interface Result { file: string; slug: string | null; action: string; added: number; error: string | null }

const EXAMPLE = `# slug: loss
# title: Loss
# description: For when someone or something you loved is gone.
# sensitive: true
# visibility: private
# repeat: false
body,attribution,media,link
"Grief has no schedule. However today feels is allowed.",,,
"You are allowed to rest, today and tomorrow.",A friend,https://example.org/images/rest.png,https://example.org/read-more
`;
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Bulk import: a zip of CSV files, one topic per file. Preview first; nothing is saved until "Import". */
export function ImportZip({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (dry: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${API}/api/admin/topics/import${dry ? '?dryRun=1' : ''}`, { method: 'POST', credentials: API ? 'include' : 'same-origin', headers: { 'x-admin': '1', 'content-type': 'application/zip' }, body: file });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error?.message ?? `Import failed (${r.status})`);
      setRows(data.topics);
      if (!dry) { setResults(data.results); onDone(); }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const ready = rows?.filter((r) => r.action !== 'skip') ?? [];
  return (
    <details className="import-zip">
      <summary><strong>Import topics from a zip</strong></summary>
      <p className="muted small">One CSV per topic. At the top, lines like <code># slug: loss</code>, <code># title: …</code>, <code># description: …</code>, <code># sensitive: true</code>, <code># visibility: private</code> (default) or <code>public</code>, <code># repeat: false</code>. Then a table with a <code>body</code> column and, if you like, <code>attribution</code>, <code>media</code> (an https image shown with the note) and <code>link</code> (an https page the notification opens when tapped). A slug that already exists keeps its notes and gets only the new ones at the end. Up to 100 files, 1000 notes each, 5 MB.</p>
      <p className="small"><a href={URL.createObjectURL(new Blob([EXAMPLE], { type: 'text/csv' }))} download="example-topic.csv">Download an example CSV</a></p>
      <div className="inline-form">
        <label className="field">Zip file<input type="file" accept=".zip,application/zip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRows(null); setResults(null); }} /></label>
        <button className="btn secondary" disabled={!file || busy} onClick={() => send(true)}>Preview</button>
        <button className="btn primary" disabled={!rows || !ready.length || busy || !!results} onClick={() => send(false)}>Import {ready.length || ''} {ready.length === 1 ? 'topic' : 'topics'}</button>
      </div>
      {rows && (
        <table className="table" aria-label="Import preview"><thead><tr><th>File</th><th>Topic</th><th>What happens</th><th>Notes</th><th>Check</th></tr></thead><tbody>
          {rows.map((r) => {
            const res = results?.find((x) => x.file === r.file);
            return (
              <tr key={r.file}>
                <td className="small">{r.file}</td>
                <td>{r.title ?? r.slug ?? '—'}<br /><span className="small muted">{r.slug}</span></td>
                <td>{r.action === 'create' ? `New topic (${r.visibility})` : r.action === 'append' ? 'Add to existing topic' : 'Skipped'}{r.changes.length > 0 && <div className="small muted">{r.changes.join('; ')}</div>}</td>
                <td>{r.action === 'skip' ? '—' : <>+{r.adding}{r.duplicates ? <span className="small muted"> ({r.duplicates} already there)</span> : null}{r.action === 'append' ? <span className="small muted"> after {r.existingNotes}</span> : null}</>}</td>
                <td>
                  {r.errors.length > 0 && <ul className="error small">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                  {r.warnings > 0 && <span className="draft-flag">{r.warnings} may look like spam</span>}
                  {res && <div className={res.error ? 'error small' : 'small'}>{res.error ? `Failed: ${res.error}` : res.action === 'skip' ? '' : `Done: ${res.added} added`}</div>}
                </td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
