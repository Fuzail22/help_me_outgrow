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
