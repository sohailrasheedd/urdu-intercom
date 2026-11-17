# Urdu Intercom: Fix and Upgrade Brief

You are working on an existing, live web app called "Urdu Intercom" (انٹر کام). Read this whole file first, then implement it in the phases below. The owner is a developer, but he reads your replies in Roman Urdu.

## 0. Rules for you

1. **Reply to the owner in Roman Urdu** (Urdu written in Latin letters, for example "Maine yeh file theek kar di hai"). Code, code comments, commit messages and file names stay in English. All text shown inside the app stays in Urdu script and the UI stays RTL.
2. Do not break existing features: login with PIN, mandatory PIN change, Super Admin Control Center, admin card visibility list, pinned quick messages, history, voice-to-text, wake lock, chime, clear/withdraw message.
3. The app is a static site (no build step): `index.html`, `config.js`, `assets/fonts/`. Backend is Firebase Realtime Database (compat SDK 10.12.2). It is hosted on Netlify. A leftover `vercel.json` exists and can be left alone or removed.
4. Work in order: Phase 1 (A to E), then Phase 2 (F). After each task, run the checks in section 9 as far as you can in the environment, and say plainly what you could not test (for example a real iPhone).
5. Never put secrets (service account keys) in `config.js` or anywhere in the repo. They go in Netlify environment variables only.
6. At the very end, give the owner one Roman Urdu summary: what changed, which files were added or edited, and a numbered list of the manual steps he must do himself (Firebase console, Netlify settings), with exact click paths. Do not paste big code blocks in that summary.

## 1. Current architecture (facts from the code)

- Roles: `superadmin`, `admin`, `user` (5 people in `PEOPLE` in `config.js`, plus custom people stored in `settings/people`).
- Realtime Database nodes: `messages/{id}`, `history/{id}`, `settings` (people, pinned, adminPermissions, passwords, passwordChanged).
- A message today: `{ to, from, fromName, text, audio, time, replyTo }`. `to` is the id of the person whose card hosts the message. When a user replies to admin, `to` is still the user's own id and `from` is the user's id.
- Admin and superadmin screens show one card per person. A user screen shows only the user's own single card (`single-mode`) and ignores any message where `m.to !== currentUser.id`.
- When admin sends a new message to a card, older messages on that card are archived to history, so only the latest admin query stays active.
- Voice notes are recorded with `MediaRecorder`, converted to a base64 data URL and stored inside the message (`audio` field).
- Current notifications are only the in-page chime, toast and vibration. These stop working when the screen is locked or the tab is in the background.

---

## Task A: Users must see the other users and message them

### Problem
When a user (for example Sohail) logs in, only his own card appears. The other people are not shown, so users cannot message each other.

### Required behaviour
- A normal user's screen has two parts:
  1. **Own inbox card** (as today): messages from admin to this user, with the existing reply, quick-reply and clear buttons.
  2. **Contact cards** for every other person in `activePeople`, excluding himself, excluding `admin` and `superadmin`. Tapping a contact's name button opens the same send modal ("<name> کو پیغام"), which supports text, speech-to-text and voice note.
- Admin is not listed as a contact and a user cannot start a new conversation with admin. A user can still reply to a message that admin sent him (existing reply feature stays). Mention this assumption in your Roman Urdu summary so the owner can correct it.
- Add short Urdu headings above the two parts, for example "ایڈمن کی طرف سے پیغامات" and "دوسرے افراد کو پیغام بھیجیں".
- Admin and superadmin do not see peer-to-peer messages by default.

### Suggested data model (keep old data working)
Add to every new message: `kind` and `recipient`.
- `kind: "thread"` is the admin and person conversation, exactly as today (`to` = the person id whose card hosts it).
- `kind: "peer"` is user to user: `from` = sender id, `to` = recipient id.
- Messages without `kind` are legacy and count as `thread`.
- `recipient` is the real person who should be alerted. For `thread`: if `from` is admin or superadmin then `to`, otherwise `"admin"`. For `peer`: `to`. Push notifications (Task B) use it.

Rendering rules for a user screen:
- `thread` with `to === me` goes on the own inbox card.
- `peer` with `to === me` goes on the card of `from` (incoming).
- `peer` with `from === me` goes on the card of `to` (outgoing).
- Admin and superadmin screens render only `thread` messages.

### Behaviour details
- Auto-archiving of the previous message applies only to admin-sent `thread` messages. Peer messages stack normally until cleared.
- Recipient can clear ("کام ہو گیا / صاف کریں") and reply; sender can withdraw ("پیغام واپس لیں"). Clearing moves the item to history, as today.
- The chime, toast and vibration work for peer messages too.
- History for a user shows his own thread messages and the peer messages he sent or received. Update the history filter chips for users: "سب" plus one chip per contact.
- Cards for newly added people appear live on all user screens, and removed people disappear.
- Quick pinned pills are not needed on peer cards.

---

## Task B: Notifications when the screen is locked or the app is in the background

### Why it fails today
Browsers pause page JavaScript in the background, so the Firebase listener and the Web Audio chime stop. The only reliable fix is Web Push through Firebase Cloud Messaging (FCM) with a service worker, and a small server piece that sends the push.

### Architecture (free: no Firebase Blaze plan needed)
1. Client asks notification permission **from a button tap** (never on page load), gets an FCM token, and stores it at `fcmTokens/{userId}/{sanitizedToken}` with `{ ua, updatedAt }`. Sanitize the key (use a hash or replace characters not allowed in RTDB keys).
2. After a message is written, the client calls a **Netlify Function** `netlify/functions/send-push.js` with only the message id (not the text). The function uses `firebase-admin` with a service account from the env var `FIREBASE_SERVICE_ACCOUNT_JSON` (and `FIREBASE_DATABASE_URL`), reads that message from the database itself, works out the recipients (see `recipient` in Task A), and sends a **data-only** FCM message to their tokens. Because the function reads the message itself, nobody can use it to push arbitrary text. Mark `pushed: true` on the message so it is sent once only. Remove tokens that return `registration-token-not-registered` or `invalid-argument`.
   - Push target rules: admin to a user, user to admin (all tokens of `admin` and `superadmin`), user to user.
   - Payload fields: `title` (sender name, Urdu), `body` (first 120 characters of the text, or "صوتی پیغام" for voice), `tag` (message id), `url` (`/`). Webpush headers: `Urgency: high`, `TTL: 600`.
3. Alternative if the owner prefers Firebase: a Cloud Function with an RTDB `onCreate` trigger on `messages/{id}`. It needs the paid Blaze plan. Implement the Netlify version first and mention this alternative in the summary.
4. Add `netlify.toml` (functions directory, `node_bundler = "esbuild"`) and a root `package.json` with `firebase-admin`. Netlify Functions run only on a Git-based or CLI deploy. Check how the owner deploys. If it is drag-and-drop of a folder, tell him in Roman Urdu that he must switch to Git deploy or `netlify deploy --prod` for the function to work, and give the exact steps.

### Client work
- Load `firebase-messaging-compat.js` (same version as the other Firebase scripts).
- Add `FCM_VAPID_KEY` to `config.js` as an empty placeholder with a comment. The owner generates it in Firebase Console, Project settings, Cloud Messaging, Web Push certificates.
- One service worker file at the site root: `firebase-messaging-sw.js`. It handles both FCM and the app-shell cache (see Task D). It should use `importScripts` for the Firebase compat scripts and for `/config.js` (check that `FIREBASE_CONFIG` is reachable after the import).
  - `onBackgroundMessage`: call `showNotification` with `tag`, `renotify: true`, `vibrate`, `icon`, `badge`, `lang: "ur"`, `dir: "rtl"`, and `requireInteraction: true` where supported.
  - `notificationclick`: focus an open app window or open `/`.
- Foreground: if the page is visible, rely on the existing chime and toast and do not show a system notification, to avoid duplicates. If the page is hidden, the service worker notification is used.
- UI: a button "نوٹیفکیشن آن کریں" in the top bar that shows the real state: not asked, enabled, blocked (explain in Urdu how to unblock), or unsupported. On iPhone, tell the user the app must first be installed to the Home Screen (iOS 16.4 or newer), because web push does not work in a normal Safari tab.
- Register the token after login and refresh it when it changes. Delete the token for this device on logout. Do not break the existing auto-login from `localStorage`.
- Also keep the existing wake-lock feature; it still helps admin screens that stay open.

---

## Task C: Voice problems (bugs found in the current code)

1. **Android to iPhone voice does not play.** Chrome on Android records WebM/Opus; iPhone Safari cannot reliably play that. Fix: record raw PCM through the Web Audio API (AudioWorklet, with a ScriptProcessor fallback) and encode to **MP3 in the browser with lamejs** (mono, 16 kHz, about 32 kbps). MP3 plays on every device. Vendor lamejs into `assets/` (do not depend on a CDN at runtime) and add it to the offline cache. If PCM capture is unavailable, fall back to `MediaRecorder` with the best supported type and save the real type in `audioMime`.
2. **Wrong MIME fallback and a misleading error.** `mimeType` defaults to `'audio/webm'` even when nothing is supported, so `new MediaRecorder` throws and the catch shows "microphone permission denied". Fix: pass no options when nothing is supported, and show different Urdu messages for permission denied, no microphone found, and unsupported browser.
3. **Duration shows NaN and the progress bar breaks** because Chrome WebM blobs report `duration = Infinity`. Fix: store `audioDuration` (seconds) in the message and use it for the label and progress.
4. **Database bloat.** The base64 audio is stored inside `messages`, so every client downloads every voice note, and it is also copied into `history`. Fix: store audio at `voice/{messageId}`; the message keeps only `hasAudio`, `audioDuration`, `audioMime`. Load the audio on demand (when played, or when auto-play triggers). Enforce a limit of 30 seconds and about 400 KB, show a clear Urdu error above that limit, and delete `voice/{id}` when the message is cleared, withdrawn or purged. History keeps text only, for example "صوتی پیغام". Keep the audio in the Realtime Database unless Firebase Storage is confirmed available on the free plan for this project.
5. **Playback is blocked on phones.** Browsers only allow audio that was unlocked by a user gesture. Use one shared `<audio>` element, unlock it on the first tap anywhere (play a tiny silent clip), and swap its `src` for each voice note. Add auto-play of incoming voice notes when the app is visible and unlocked (a setting in the Super Admin panel, on by default), with a queue so two notes do not overlap, and a visible play button as fallback.
6. **Silent send failures.** `sendRawMessage` has no error handling for the Firebase push. Add `.catch` with an Urdu toast, disable the send button while uploading, and retry once.
7. **Speech-to-text cleanup.** The `onerror` language fallback and the `onend` auto-restart can race and restart the old recognizer. Use a single state machine, call `abort()` before starting a new one, and never restart after an error. Detect browsers where Urdu recognition is not supported (many iPhone browsers) and show a short hint instead of failing. Do not start speech-to-text while voice recording is active.
8. **Recording robustness.** Request the mic with `echoCancellation` and `noiseSuppression`, always stop all tracks, and stop recording if the tab becomes hidden or the modal closes.
9. **Saved setting that does nothing.** The Super Admin checkbox `showVoiceBtn` ("مائیک سے بول کر لکھنے") is saved but never applied for admin. Apply it (hide the speech-to-text mic and the voice tab for admin when it is off).

---

## Task D: Make the app installable (PWA) with an install option

- Add `manifest.webmanifest`: `name` and `short_name` "انٹر کام", `lang: "ur"`, `dir: "rtl"`, `start_url: "/?source=pwa"`, `scope: "/"`, `display: "standalone"`, `theme_color` and `background_color` `#0f172a`, and icons.
- Create icons (192, 512, a maskable 512, `apple-touch-icon` 180, and a monochrome notification badge 96): dark `#0f172a` background with a simple intercom or speaker glyph, no text. Generate them with a small script and keep the SVG source.
- In `index.html` add the manifest link, `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `mobile-web-app-capable`, and a status bar style.
- Service worker: precache the app shell (`index.html`, `config.js`, fonts, lamejs, icons). Use network-first for `index.html` and `config.js` so updates reach users, and cache-first with revalidate for fonts and static assets. Never cache the Firebase database traffic or the Netlify function calls. Use a cache version constant, `skipWaiting`, `clients.claim`, and clean up old caches. Show an Urdu toast when a new version is ready.
- **Install button** "ایپ انسٹال کریں" in the top bar and on the login box:
  - Android and desktop Chrome or Edge: capture `beforeinstallprompt`, show the button, and call `prompt()` when tapped. Hide it after `appinstalled`, or when `display-mode: standalone` is already active.
  - iPhone Safari (no install prompt exists): the button opens an Urdu help sheet: Safari, Share button, "Add to Home Screen". If the user is in another iPhone browser, tell him to open the link in Safari.
  - Other browsers with no prompt event: show a short Urdu hint ("براؤزر مینو میں سے Install app یا Add to Home screen").
- `netlify.toml` headers: `Cache-Control: no-cache` for `/firebase-messaging-sw.js` and `/manifest.webmanifest`, and `Content-Type: application/manifest+json` for the manifest.

---

## Task E: Smaller bugs found in the code

1. `saveLocalSettings()` writes the whole `settings` node with `.set(...)` from whichever device calls it. A user changing his PIN can overwrite newer admin permissions, people and pins with stale local copies. Switch to targeted `.update()` on the exact child paths (for example `settings/passwords/{id}` and `settings/passwordChanged/{id}`).
2. Values are put into the page with `innerHTML` and inside attributes (pin text, person names). A quote in a pin message breaks the button. Build these elements with `textContent` and `setAttribute`, or escape the values.
3. Deleting a person leaves his messages and push tokens behind. Remove `fcmTokens/{id}` and his active messages.
4. The in-page chime and toast logic in `displayMessageOnCard` has overlapping conditions. Simplify it so each new message alerts exactly once and never for the sender's own message.

---

## Phase 2 (Task F): Security (recommended, do after Phase 1 works)

Current state: `database.rules.json` is `".read": true, ".write": true`. Anyone who knows the database URL (it is in `config.js`) can read every message, read `settings/passwords` (PINs stored in plain text), or delete everything. The messages look like day-to-day clinic talk, so this should be fixed.

Plan, keeping the same login screen and the 4-digit PIN:
1. Add a Netlify Function `login` that checks the loginId and PIN on the server and returns a **Firebase custom token** (`uid` = person id, custom claim `role`). The client signs in with `signInWithCustomToken` (add the Firebase Auth compat script).
2. Store PINs only as salted hashes in a node that is not readable by clients (for example `private/pins/{id}`, with rules `.read: false, .write: false`, written only through the admin SDK in Netlify Functions). Add functions for "change PIN" and "reset PIN to 1234" (superadmin only). Remove `passwords` from the client-readable `settings` node and migrate existing values once.
3. New rules: require `auth != null`; users can read only messages where they are `from` or `to` (query by `orderByChild` with `.indexOn`), write only messages with their own `from`; only admin and superadmin write `settings`, `history` purge and message purge; each user can write only his own `fcmTokens/{uid}`.
4. Change the client listeners so a user does not download all messages: use queries on `to` and on `from`.
5. Have `send-push` verify the caller's Firebase ID token.
6. Deploy the new rules only after the new login works, and tell the owner exactly how to publish them and how to roll back if someone gets locked out.

---

## 9. Checks before you say "done"

- Sohail logs in: sees his inbox card plus cards for Abrar, Ahmed Raza, Ustad Sahib and Bapu; does not see admin or superadmin. Sending to Abrar shows on Abrar's screen live, with chime and toast.
- Admin screen still shows only the allowed people cards and does not show peer messages.
- A user can still reply to a message from admin; the reply shows on the admin's card.
- With the phone locked or the app in the background (Android Chrome and installed PWA), a message from admin and a message from another user both produce a system notification within a few seconds; tapping it opens the app. The same on iPhone with the app installed to the Home Screen (state clearly if you could not test this).
- Voice note recorded on Android plays on iPhone and the other way round; duration and progress bar are correct; incoming voice auto-plays on an unlocked screen; oversized recording is rejected with an Urdu message; clearing a message deletes its `voice` node.
- Install button appears on Android Chrome and installs the app; iPhone shows the Urdu help sheet; installed app opens standalone and works offline for the shell.
- PIN change on one device does not overwrite other settings.
- No console errors on login, send, clear, history, and Super Admin tabs.
