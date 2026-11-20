# Android app (Trusted Web Activity)

Why: on Android, Chrome can hide a website's notification behind "possible spam" (an on-device model reads the
title, body and button text) and can silently remove the permission of sites that send a lot and get little
engagement. With a Trusted Web Activity the same web app is installed from the Play Store, and with **notification
delegation** (`enableNotifications: true`) its notifications are shown as coming from the installed app rather than
from a website in Chrome. Nothing in the web app changes: same origin, same service worker, same push subscription.

Owner steps (not automated: they need a Play developer account, $25 once, and the signing key):

1. Install Bubblewrap: `npm i -g @bubblewrap/cli` (it downloads a JDK and the Android SDK on first run).
2. Check `twa-manifest.json` (host, package id `com.htsta.outgrow`, colours), then in this folder:

```bash
bubblewrap init --manifest https://outgrow.htsta.com/manifest.webmanifest
```

```bash
bubblewrap build
```

   Keep `android.keystore` and its passwords safe and out of git; every update must be signed with it.
3. Digital Asset Links: `bubblewrap fingerprint generateAssetLinks` prints `assetlinks.json`. Put it at
   `client/public/.well-known/assetlinks.json` (served as `https://outgrow.htsta.com/.well-known/assetlinks.json`).
   If Play App Signing is on, use the SHA-256 fingerprint Play Console shows for the app signing key instead.
   Without this file the app opens with a browser bar and does not count as the site's app.
4. Upload `app-release-bundle.aab` to Play Console (internal testing first), then production.

Until then, the web app offers "Add to home screen" on Android (My notes), which already keeps the site out of
Chrome's automatic permission removal.
