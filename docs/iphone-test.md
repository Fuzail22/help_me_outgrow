# iPhone test checklist (R5)

The automated tests run the iPhone screens in **Chromium emulating an iPhone** (viewport, touch, mobile mode and an
iOS Safari user-agent; "Home Screen app" is simulated). They are not a real device. This checklist covers what only
a real iPhone can show. Run it on the live site after a deploy, and record the result of each step.

**Before you start**

- iOS version (Settings → General → About → iOS Version): `__________`
- iPhone model: `__________`
- Date and time of the test: `__________`
- Site URL: `https://__________`
- Remove any earlier help me outgrow icon from the Home Screen, and in Settings → Notifications make sure no earlier
  "help me outgrow" entry remains.

| # | Step | Expected result | Result (pass / fail, notes) |
| --- | --- | --- | --- |
| 1 | Open the site in **Safari** (not the Home Screen). | The landing page shows "On iPhone, add help me outgrow to your Home Screen first" with three numbered steps. | |
| 2 | Tap **Choose what you need**, pick a topic, a time and a duration, then **Continue**. | The step titled "One step before you sign in" shows the Home Screen guide. There is **no** sign-in button and no consent box. | |
| 3 | Tap **I will add it now**. | "Thanks, noted." appears. | |
| 4 | *(Only if you have an iPhone on iOS 16.3 or older.)* Open the site in Safari. | "Update your iPhone to use help me outgrow" names your iOS version and says notifications need iOS 16.4 or later. | |
| 5 | Tap Safari's **Share** button, then **Add to Home Screen**. | The suggested name is **outgrow** and the icon is the green sprout (not a screenshot of the page). Tap **Add**. | |
| 6 | Open **outgrow** from the Home Screen. | It opens full screen with no Safari address bar, on the landing page. The Home Screen guide is **not** shown. | |
| 7 | **Sign-in carry-over check.** Note whether the header says **Sign in** or **My notes**. | Record which one. *Unknown until tested:* whether a sign-in done earlier in Safari carries over into the Home Screen app. The app does not rely on it. | |
| 8 | Tap **Choose what you need**, pick **Burnt out**, a time **2–3 minutes from now**, and a duration. Continue. | The sign-in step shows **Sign in with Google**. | |
| 9 | Tick the consent box and sign in with Google. | Google sign-in completes inside the app (a Google sheet may open and close) and you return to the next step. | |
| 10 | Tap **Turn on notifications**. | iOS asks "outgrow Would Like to Send You Notifications". Tap **Allow**. "You are set." shows the first send time. | |
| 11 | Lock the iPhone and wait for the chosen time. | **A notification arrives on the lock screen** with the topic as the title and the line as the text. It has no action buttons and no image (iOS shows neither). | |
| 12 | Tap the notification. | The app opens on the quote page. The 👍 **Helpful** / 👎 **Not for me** pair is the first and largest control. | |
| 13 | Tap **Helpful**. | "Noted. You can close this tab." appears. | |
| 14 | Go to **My notes**. | The enrolment is listed with its times. There is no "Notifications are off" warning. | |
| 15 | Settings → Notifications → outgrow → turn **Allow Notifications** off. Open the app again. | One banner says "Notifications are off on this device" with **Turn them back on**. My notes shows the same warning. | |
| 16 | Turn **Allow Notifications** back on in Settings and open the app. | The banner is gone after a reload. The next note arrives at its time. | |
| 17 | *(Optional.)* Delete the Home Screen icon, add it again from Safari, open it and sign in. | My notes shows the earlier enrolment. If the app reports notifications off, tap **Turn back on**; notes arrive again. | |

**Still marked unverified until this checklist is run:**

- A push arriving on a **locked** iPhone (step 11).
- Whether a sign-in done in Safari carries over into the Home Screen app (step 7).
- Whether iOS lets the app re-create a lost push subscription silently when permission is still granted. The
  automated test covers this in Chromium. If iOS refuses it without a tap, the app falls back to the banner in step 15.

When you report back, copy this table with the results column filled in and the iOS version at the top.
