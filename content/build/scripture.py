"""Complete scripture texts as topics in the PR 15 import format: one note per kural / verse, in order.
Thirukkural: 3 topics (its three books). Qur'an: 30 topics (one per juz). Bible: one topic per book, with books over
1000 verses split by chapter. Verses over 300 characters are split at sentence breaks into numbered parts."""
import json, math, re, unicodedata
from pathlib import Path

SRC = Path(__file__).parent / 'src'
LIMIT, MAX_NOTES = 300, 1000

def norm(s):
    """Same as the importer's duplicate check: lower case, NFKD, non letters/digits -> space."""
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(ch if unicodedata.category(ch)[0] in 'LN' or ch.isspace() else ' ' for ch in s)
    return re.sub(r'\s+', ' ', s).strip()

def split_long(text, room=LIMIT):
    """Pack the text into pieces of at most `room` characters, breaking at sentence ends, then clauses, then words."""
    if len(text) <= room: return [text]
    for sep in (r'(?<=[.?!;:])\s+', r'(?<=,)\s+', r'\s+'):
        parts = re.split(sep, text)
        if max(len(p) for p in parts) <= room: break
    out, cur = [], ''
    for p in parts:
        if cur and len(cur) + 1 + len(p) > room: out.append(cur); cur = p
        else: cur = f'{cur} {p}' if cur else p
    out.append(cur)
    return out

def notes(items):
    """items: (text, ref). Splits long texts; makes repeated texts unique (the importer skips exact repeats)."""
    rows, seen = [], set()
    for text, ref in items:
        text = re.sub(r'\s+', ' ', text).strip()
        if not text: continue
        parts = split_long(text)
        for i, p in enumerate(parts):
            attr = ref if len(parts) == 1 else f'{ref} · part {i + 1} of {len(parts)}'
            body = p
            if norm(body) in seen: body = f'{p} ({attr.split(" · ")[0]})'
            assert norm(body) not in seen and len(body) <= LIMIT and len(attr) <= 120, (ref, body)
            seen.add(norm(body)); rows.append((body, attr))
    assert len(rows) <= MAX_NOTES, (items[0][1], len(rows))
    return rows

# ---------- Thirukkural ----------
def tidy_pope(s):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    s = re.sub(r"([,;:!?])(['A-Za-z])", r"\1 \2", s)
    s = s.replace('Do deeds of virtue now Say not', 'Do deeds of virtue now. Say not')
    s = re.sub(r"\s+", ' ', s).strip()
    return s if s[-1] in '.!?' else s + '.'

def thirukkural():
    k = {x['Number']: x for x in json.load(open(SRC / 'tk/tk.json', encoding='utf8'))['kural']}
    books = json.load(open(SRC / 'tk/detail.json', encoding='utf8'))[0]['section']['detail']
    meta = {'Virtue': ('thirukkural-virtue', 'Thirukkural: Virtue (Aram)', 'The first book of the Thirukkural, on virtue and the good life: kurals 1–380, in Tamil with G. U. Pope\'s English.'),
            'Wealth': ('thirukkural-wealth', 'Thirukkural: Wealth (Porul)', 'The second book of the Thirukkural, on wisdom, work, friendship and public life: kurals 381–1080, in Tamil with G. U. Pope\'s English.'),
            'Love': ('thirukkural-love', 'Thirukkural: Love (Inbam)', 'The third book of the Thirukkural, on love: kurals 1081–1330, in Tamil with G. U. Pope\'s English.')}
    out = []
    for b in books:
        items = []
        for grp in b['chapterGroup']['detail']:
            for ch in grp['chapters']['detail']:
                for n in range(ch['start'], ch['end'] + 1):
                    x = k[n]
                    items.append((f"{x['Line1'].strip()} {x['Line2'].strip()} — {tidy_pope(x['couplet'])}",
                                  f"Thirukkural {n}, {ch['translation']} · tr. G. U. Pope"))
        slug, title, desc = meta[b['translation']]
        out.append((slug, title, desc, notes(items)))
    assert sum(len(t[3]) for t in out) == 1330
    return out

# ---------- Qur'an (Pickthall) ----------
def quran():
    surahs = json.load(open(SRC / 'quran/pickthall.json', encoding='utf8'))['data']['surahs']
    juz = {}
    for s in surahs:
        for a in s['ayahs']:
            juz.setdefault(a['juz'], []).append((s, a))
    out = []
    for j in sorted(juz):
        v = juz[j]
        (s0, a0), (s1, a1) = v[0], v[-1]
        span = f"{s0['englishName']} {s0['number']}:{a0['numberInSurah']} – {s1['englishName']} {s1['number']}:{a1['numberInSurah']}"
        items = [(a['text'], f"Qur'an {s['number']}:{a['numberInSurah']}, {s['englishName']} · tr. Pickthall") for s, a in v]
        out.append((f'quran-juz-{j:02d}', f"Qur'an, Juz {j}", f"Juz {j} of the Qur'an ({span}), verse by verse, in Pickthall's English translation.", notes(items)))
    return out

# ---------- Bible (World English Bible) ----------
BOOKS = [('GEN', 'Genesis'), ('EXO', 'Exodus'), ('LEV', 'Leviticus'), ('NUM', 'Numbers'), ('DEU', 'Deuteronomy'), ('JOS', 'Joshua'),
    ('JDG', 'Judges'), ('RUT', 'Ruth'), ('1SA', '1 Samuel'), ('2SA', '2 Samuel'), ('1KI', '1 Kings'), ('2KI', '2 Kings'),
    ('1CH', '1 Chronicles'), ('2CH', '2 Chronicles'), ('EZR', 'Ezra'), ('NEH', 'Nehemiah'), ('EST', 'Esther'), ('JOB', 'Job'),
    ('PSA', 'Psalms'), ('PRO', 'Proverbs'), ('ECC', 'Ecclesiastes'), ('SOL', 'Song of Solomon'), ('ISA', 'Isaiah'),
    ('JER', 'Jeremiah'), ('LAM', 'Lamentations'), ('EZE', 'Ezekiel'), ('DAN', 'Daniel'), ('HOS', 'Hosea'), ('JOE', 'Joel'),
    ('AMO', 'Amos'), ('OBA', 'Obadiah'), ('JON', 'Jonah'), ('MIC', 'Micah'), ('NAH', 'Nahum'), ('HAB', 'Habakkuk'),
    ('ZEP', 'Zephaniah'), ('HAG', 'Haggai'), ('ZEC', 'Zechariah'), ('MAL', 'Malachi'), ('MAT', 'Matthew'), ('MAR', 'Mark'),
    ('LUK', 'Luke'), ('JOH', 'John'), ('ACT', 'Acts'), ('ROM', 'Romans'), ('1CO', '1 Corinthians'), ('2CO', '2 Corinthians'),
    ('GAL', 'Galatians'), ('EPH', 'Ephesians'), ('PHI', 'Philippians'), ('COL', 'Colossians'), ('1TH', '1 Thessalonians'),
    ('2TH', '2 Thessalonians'), ('1TI', '1 Timothy'), ('2TI', '2 Timothy'), ('TIT', 'Titus'), ('PHM', 'Philemon'),
    ('HEB', 'Hebrews'), ('JAM', 'James'), ('1PE', '1 Peter'), ('2PE', '2 Peter'), ('1JO', '1 John'), ('2JO', '2 John'),
    ('3JO', '3 John'), ('JUD', 'Jude'), ('REV', 'Revelation')]
PSALM_BOOKS = [(1, 41), (42, 72), (73, 89), (90, 106), (107, 150)]  # the five books of the Psalter

def slugify(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def chapter_groups(chapters, n_verses):
    """Split a long book into consecutive chapter ranges of about equal size, each well under 1000 notes."""
    parts = math.ceil(n_verses / 900)
    target = n_verses / parts; groups, cur, size = [], [], 0
    for c, vs in chapters:
        if cur and size + len(vs) > target * 1.08 and len(groups) < parts - 1: groups.append(cur); cur, size = [], 0
        cur.append((c, vs)); size += len(vs)
    groups.append(cur)
    return groups

def bible():
    verses = {}
    for l in open(SRC / 'bible/eng-web_vpl.txt', encoding='utf8'):
        m = re.match(r'^(\w+) (\d+):(\d+) (.*)$', l.rstrip('\n'))
        if m: verses.setdefault(m[1], {}).setdefault(int(m[2]), []).append((int(m[3]), m[4]))
    out = []
    for code, name in BOOKS:
        chapters = sorted(verses[code].items())
        total = sum(len(v) for _, v in chapters)
        if code == 'PSA': groups = [[(c, v) for c, v in chapters if lo <= c <= hi] for lo, hi in PSALM_BOOKS]
        elif total > 950: groups = chapter_groups(chapters, total)
        else: groups = [chapters]
        for g in groups:
            lo, hi = g[0][0], g[-1][0]
            whole = len(groups) == 1
            span = '' if whole else (f' {lo}' if lo == hi else f' {lo}–{hi}')
            slug = f'bible-{slugify(name)}' + ('' if whole else f'-{lo}-{hi}')
            ch_word = 'Psalms' if code == 'PSA' else name
            desc = (f'The book of {name}, verse by verse, from the World English Bible.' if whole else
                    f'{ch_word}, chapters {lo} to {hi}, verse by verse, from the World English Bible.')
            if code == 'PSA': desc = f'Psalms {lo} to {hi} (book {PSALM_BOOKS.index((lo, hi)) + 1} of the Psalter), verse by verse, from the World English Bible.'
            label = 'Psalm' if code == 'PSA' else name
            items = [(t, f'{label} {c}:{n} (WEB)') for c, vs in g for n, t in vs]
            out.append((slug, f'Bible: {name}{span}', desc, notes(items)))
    return out
