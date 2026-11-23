"""Builds topics-1.zip (six year-long topics, Thirukkural, Qur'an) and topics-2-bible.zip in the PR 15 format."""
import csv, io, sys, zipfile, shutil
from pathlib import Path
ROOT = Path(__file__).parent; sys.path.insert(0, str(ROOT))
import year, scripture
SIX = [('people-pleasing', 'Letting go of people-pleasing', "For learning to say no and stop shaping yourself around other people's approval.", 'PEOPLE_PLEASING'),
    ('career-change', 'Changing careers', 'For leaving one line of work and growing into the next.', 'CAREER_CHANGE'),
    ('new-place', 'Starting over in a new place', 'For building a life, and a new sense of self, after a move.', 'NEW_PLACE'),
    ('start-doing', 'From putting off to doing', 'For outgrowing procrastination and becoming someone who starts and finishes.', 'START_DOING'),
    ('self-belief', 'Quieting self-doubt', 'For outgrowing a harsh inner critic and growing into quieter confidence.', 'SELF_BELIEF'),
    ('someone-who-moves', 'Becoming someone who moves', 'For growing into a person who walks, stretches and exercises, at any age or fitness level.', 'SOMEONE_WHO_MOVES')]

def csv_text(slug, title, desc, rows):
    assert len(title) <= 60 and len(desc) <= 300 and 2 <= len(slug) <= 40 and len(rows) <= 1000, slug
    b = io.StringIO()
    b.write(f'# slug: {slug}\n# title: {title}\n# description: {desc}\n# sensitive: false\n# visibility: private\n# repeat: false\n')
    b.write('body,attribution,media,link\n')
    w = csv.writer(b, quoting=csv.QUOTE_ALL, lineterminator='\n')
    for body, attr in rows: w.writerow([body, attr or '', '', ''])
    return b.getvalue()

def make_zip(name, topics):
    out = ROOT / 'final' / name.replace('.zip', ''); shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
    for slug, title, desc, rows in topics: (out / f'{slug}.csv').write_text(csv_text(slug, title, desc, rows), encoding='utf8')
    z = ROOT / 'final' / name
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as f:
        for p in sorted(out.glob('*.csv')): f.write(p, p.name)
    print(name, len(topics), 'files', sum(len(t[3]) for t in topics), 'notes', z.stat().st_size, 'bytes')

def six(): return [(s, t, d, [(b, None) for b in year.year(k)]) for s, t, d, k in SIX]

if __name__ == '__main__':
    make_zip('topics-1.zip', six() + scripture.thirukkural() + scripture.quran())
    make_zip('topics-2-bible.zip', scripture.bible())
