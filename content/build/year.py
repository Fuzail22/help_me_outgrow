"""Assembles the six topics as year-long courses (365 notes)."""
import re, notes, year_a, year_b, year_c
from scripture import norm

RETIME = [('Two months in', 'Eleven months in'), ('Look back nine weeks', 'Look back over this year'),
    ('Almost three months on', 'Almost a year on'), ('three months ago', 'a year ago'), ('this season', 'this year'),
    ('Two months of small pauses', 'A year of small pauses')]
def retime(s):
    for a, b in RETIME: s = s.replace(a, b)
    m = re.match(r'^Three months (of|in) (.*?) are behind you(.*)$', s)
    return f'A year {m[1]} {m[2]} is behind you{m[3]}' if m else s

def lines(b): return [l.strip() for l in b.strip().splitlines() if l.strip()]
SRC = {'PEOPLE_PLEASING': year_a, 'CAREER_CHANGE': year_a, 'NEW_PLACE': year_b, 'START_DOING': year_b, 'SELF_BELIEF': year_c, 'SOMEONE_WHO_MOVES': year_c}
def year(key):
    old = lines(getattr(notes, key)); new = getattr(SRC[key], key)
    out = old[:64] + lines(new['M3']) + lines(new['DEEP']) + lines(new['HARD']) + lines(new['OWN']) + [retime(s) for s in old[64:]]
    assert len(out) == 365, (key, len(out), {k: len(lines(v)) for k, v in new.items()})
    seen = {}
    for i, s in enumerate(out):
        assert len(s) <= 300, s
        assert norm(s) not in seen, (key, i, seen.get(norm(s)), s)
        seen[norm(s)] = i
    return out
