# iPhone test checklist (R5)

The browser tests run the iPhone screens in **emulation** (desktop Chromium with an iPhone viewport, touch
and an iOS user-agent; see `e2e/tests/iphone.test.mjs`). They cannot show that iOS itself delivers a push, or
that a sign-in carries from Safari into the Home Screen app. Those need a real iPhone. Please run the steps
below on one and fill in the **Result** column (✅, ❌ or a short note). Until this is done, R5 stays
"built, unverified on a real phone".

## Record first

| | |
| --- | --- |
| Date | |
| iPhone model | |
| iOS version (Settings › General › About) | |
| Site address used | e.g. `https://<app domain>` |
| Tester | |

Before you start: the site must be on HTTPS, the platform must be deployed with this branch, and
Settings › Notifications must not have Focus or Scheduled Summary hiding notifications for the test.
If the iPhone already has the app on its Home Screen from an earlier test, delete that icon first.

## Steps

| # | Do this | Expected result | Result |
| --- | --- | --- | --- |
| 1 | Open the site in **Safari** (not from the Home Screen). | The landing page shows "On iPhone, add help me outgrow to your Home Screen first" with three steps. There is no "Choose what you need" button. | |
| 2 | Open `/start` in Safari. | The page is titled "Get notes on your iPhone" and shows the same guide. No topics are offered. | |
| 3 | (Only if you have an iPhone or simulator on iOS 16.3 or older.) Open the site in Safari. | "Update your iPhone to use help me outgrow" with the iOS version and the Software Update path. | |
| 4 | Tap Share › **Add to Home Screen**. | The suggested name is **outgrow** and the icon is the green sprout (not a screenshot of the page). Tap **Add**. | |
| 5 | Open **outgrow** from the Home Screen. | It opens full screen with no Safari address bar. It shows "Sign in to see your notes" with no Home Screen guide. | |
| 6 | **Sign-in carry-over (owner check).** Before step 4, were you signed in in Safari? Note whether the Home Screen app shows you as signed in. | Either is acceptable; record which. iOS usually keeps Home Screen app storage separate from Safari, so expect to sign in again. | |
| 7 | Tap "Choose what you need" (from "New here?"), pick a topic, set a time **3 minutes from now**, choose a duration, tick the consent box. | Each step works by touch; nothing is cut off at the sides. | |
| 8 | Sign in with **Google**. | The Google sheet opens and returns to the app signed in (not to Safari). If it lands in Safari instead, record that. | |
| 9 | Tap **Turn on notifications**. | iOS asks "outgrow Would Like to Send You Notifications". Tap **Allow**. The app shows "You are set." with the time of the first note. | |
| 10 | Lock the iPhone and wait for the time you chose. **(Owner check: push on a locked iPhone.)** | A notification from outgrow appears on the Lock Screen with the topic as title and the line as text. There are no buttons and no image; that is expected on iPhone. | |
| 11 | Tap the notification. | The app opens on the quote page. The 👍 Helpful and 👎 Not for me buttons are the first and largest controls. | |
| 12 | Tap **Helpful**. | The page says "Noted. You can close this tab." | |
| 13 | Swipe the app away, then open it again from the Home Screen and go to My notes. | Your topic is listed with the next note time. No "Notifications are off" banner. | |
| 14 | Settings › Notifications › outgrow › turn **Allow Notifications** off. Open the app. | Exactly one notice: "Notifications are off on this device." On My notes it offers "Turn back on". | |
| 15 | Turn **Allow Notifications** back on in Settings, open the app, go to My notes. | The notice disappears without any prompt (the app reconnects silently), or "Turn back on" works with one tap. Record which. | |
| 16 | Delete the outgrow icon from the Home Screen, add it again from Safari, open it and sign in. | If iOS kept the permission, the app reconnects silently and the next note arrives. If it asks again, allow, and the next note arrives. Record which. | |
| 17 | On My notes, tap **Stop notes on this device**, then reopen the app. | The app does **not** turn notes back on by itself. | |

## When done

Send the filled table (or a screenshot of it) to the build thread. Anything ❌ goes into a new issue with the
step number and iOS version.
