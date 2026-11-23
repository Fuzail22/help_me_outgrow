"""Round zips for the topics whose import failed with "Body is too large".

The platform accepts request bodies up to 64 KB, and the importer (before the batching fix) sends all of a file's new
notes in one request. So each failed topic is cut, in order, into chunks whose request body stays under 56 KB, and
round k holds chunk k of every topic that still has one. Import the rounds in order: each appends the next chunk.

    python3 -I rounds.py      # writes final/topics-fix-round-NN.zip
"""
import json, shutil, sys, zipfile
from pathlib import Path
ROOT = Path(__file__).parent; sys.path.insert(0, str(ROOT))
import scripture
from build_all import csv_text

BODY_LIMIT = 56 * 1024          # bytes of JSON per request; the platform's limit is 64 KB
MAX_FILES, MAX_ZIP = 100, 5 * 1024 * 1024

FAILED_BIBLE = '''1-chronicles 1-corinthians 1-kings 1-samuel 2-chronicles 2-kings 2-samuel acts-1-14 acts-15-28 daniel
deuteronomy-1-18 deuteronomy-19-34 exodus-1-23 exodus-24-40 ezekiel-1-26 ezekiel-27-48 genesis-1-28 genesis-29-50
isaiah-1-35 isaiah-36-66 jeremiah-1-29 jeremiah-30-52 job-1-23 job-24-42 john joshua judges leviticus luke-1-11
luke-12-24 mark matthew-1-16 matthew-17-28 nehemiah numbers-1-18 numbers-19-36 proverbs psalms-1-41 psalms-107-150
psalms-42-72 revelation romans'''.split()
FAILED = {'thirukkural-love', 'thirukkural-virtue', 'thirukkural-wealth', 'quran-juz-27', 'quran-juz-29', 'quran-juz-30',
          *(f'bible-{s}' for s in FAILED_BIBLE)}

def request_bytes(rows):
    """Size of the importer's appendLines request for these notes: {"lines":[{body, attribution, imageUrl, clickUrl}]}."""
    lines = [{'body': b, 'attribution': a or None, 'imageUrl': None, 'clickUrl': None} for b, a in rows]
    return len(json.dumps({'lines': lines}, ensure_ascii=False, separators=(',', ':')).encode('utf8'))

def chunks(rows):
    out, cur = [], []
    for r in rows:
        if cur and (request_bytes(cur + [r]) > BODY_LIMIT or len(cur) >= 1000): out.append(cur); cur = []
        cur.append(r)
    out.append(cur)
    return out

def main():
    topics = [t for t in scripture.thirukkural() + scripture.quran() + scripture.bible() if t[0] in FAILED]
    missing = FAILED - {t[0] for t in topics}
    assert not missing, missing
    split = {slug: (title, desc, chunks(rows)) for slug, title, desc, rows in topics}
    rounds = max(len(c) for _, _, c in split.values())
    final = ROOT / 'final'; final.mkdir(exist_ok=True)
    for old in final.glob('topics-fix-round-*.zip'): old.unlink()
    for k in range(rounds):
        files = {f'{slug}.csv': csv_text(slug, title, desc, c[k]) for slug, (title, desc, c) in sorted(split.items()) if k < len(c)}
        assert len(files) <= MAX_FILES
        z = final / f'topics-fix-round-{k + 1:02d}.zip'
        with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as f:
            for name, text in files.items(): f.writestr(name, text)
        assert z.stat().st_size <= MAX_ZIP
        print(f'{z.name}: {len(files)} topics, {sum(len(c[k]) for _, _, c in split.values() if k < len(c))} notes, '
              f'largest request {max(request_bytes(c[k]) for _, _, c in split.values() if k < len(c))} bytes, {z.stat().st_size} bytes')
    print({slug: len(c) for slug, (_, _, c) in sorted(split.items())})

if __name__ == '__main__':
    main()
