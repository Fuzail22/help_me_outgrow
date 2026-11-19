# Topic packs (scheduled routine)

New topics for help me outgrow, written by a scheduled run. Each pack is a CSV with at least 92 lines
(`seq,body,attribution`), ready for the notification service console (Topics → topic → bulk add → CSV) or
`POST /v1/topics/:id/items:import`.

- `manifest.json` lists every run and topic, plus `artifactUrl`: the private artifact where all packs are
  grouped for bulk download. Each run republishes to that same URL, adding its files.
- `BACKLOG.md` holds unused topic ideas. A run picks topics whose slug is in neither `manifest.json` nor `../topics.json`.
- `node content/packs/check.mjs` must pass before publishing: it rejects duplicate slugs and exact or
  near-duplicate lines (the importer's 80% shared-word rule) across all packs and the curated topics.

These lines are first drafts and have not been reviewed by a qualified person.
