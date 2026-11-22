# Topic zip builder

Builds the bulk-import zips (format: docs/design/LLD.md, G10) for the six year-long topics, the Thirukkural
(G. U. Pope, 1886), the Qur'an (Pickthall, 1930) and the Bible (World English Bible). All translations are public domain.

Sources (download into `content/build/src/`, not committed):

```
mkdir -p src/tk src/quran src/bible
curl -sL -o src/tk/tk.json https://raw.githubusercontent.com/tk120404/thirukkural/master/thirukkural.json
curl -sL -o src/tk/detail.json https://raw.githubusercontent.com/tk120404/thirukkural/master/detail.json
curl -sL -o src/quran/pickthall.json https://api.alquran.cloud/v1/quran/en.pickthall
curl -sL -o src/bible/web.zip https://ebible.org/Scriptures/eng-web_vpl.zip && (cd src/bible && unzip -o -q web.zip)
python3 -I build_all.py   # writes final/topics-1.zip and final/topics-2-bible.zip
```

## Round zips (for a platform that has the 64 KB request limit and an importer without batching)

`python3 -I rounds.py` writes `final/topics-fix-round-NN.zip` for the topics whose import failed with "Body is too
large": each topic's notes are cut, in order, into chunks whose append request stays under 56 KB, and round k holds
chunk k of every topic that still has one. Import round 01, then 02, and so on; each appends the next part. Once the
importer's batching fix is deployed, the full zips from `build_all.py` import in one go and rounds are not needed.
