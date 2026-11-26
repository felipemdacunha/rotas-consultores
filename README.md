# Field Visits — sales visit tracking PWA

An installable mobile app for sales consultants to log field visits — **works offline** — plus a manager
dashboard to review the team's visits and export them as PDF.

## Features

- **Three screens:** login, consultant and manager
- **Offline-first:** visits are queued on the device and synced automatically when the connection comes back
- **Installable PWA** with a Service Worker and web manifest
- **Manager dashboard** with filters and PDF export
- **Responsive layout** with light and dark themes
- **Lightweight back-end** on Google Sheets via Apps Script (kept outside this repository)

## Files

| File | Purpose |
|---|---|
| `index.html` | The three screens: login, consultant and manager |
| `style.css` | Responsive layout, light and dark themes |
| `app.js` | Visit logging, offline queue, filters and PDF generation |
| `sw.js` | Service Worker — lets the app open without internet |
| `manifest.json` | Makes the app installable on the home screen |
| `icon-192.png`, `icon-512.png` | App icons |

## Try it without any setup

Publish the files and open the link. With `GOOGLE_SCRIPT_URL` empty, the app runs in **local mode**: everything is
stored in the browser and the manager dashboard reads from there. It is useful to validate the flow before connecting
the spreadsheet.

Note: in local mode each phone only sees its own visits. To let the manager see the whole team, connect the spreadsheet.

## Step 1 — Publish on GitHub Pages

1. Push these files to the root of a **public** repository: `index.html`, `style.css`, `app.js`, `manifest.json`,
   `sw.js`, `icon-192.png`, `icon-512.png`.
2. **Settings › Pages › Branch:** choose `main`, folder `/ (root)`, **Save**.
3. After a minute or two the link is available at `https://YOUR-USER.github.io/rotas-consultores/`.

All paths are relative (`./`), so it works from a subfolder with no changes.

## Step 2 — Connect the Google Sheet

1. Create a new Google Sheet.
2. **Extensions › Apps Script**, clear the editor and paste the Apps Script back-end.
3. **Deploy › New deployment › Web app** — Execute as: **Me**; Who has access: **Anyone**.
4. Authorize it (the "unverified app" warning is expected for your own script: *Advanced › Go to project*).
5. Copy the generated URL (it ends with `/exec`) and set it in `app.js`:

   ```js
   const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```

6. Commit. The `Visitas` sheet is created automatically on the first submission.

## Step 3 — Install on the phone

- **Android / Chrome:** open the link, menu ⋮ › *Install app*.
- **iPhone / Safari:** open the link, Share › *Add to Home Screen*.

## How offline mode works

The consultant fills in the form and taps submit. The app tries to send it right away; if it can't, the visit goes into
a queue in `localStorage` and a bar at the top shows how many are pending. As soon as the connection returns — or every
30 seconds, or when the app comes back from the background — the queue is sent automatically. Nothing is lost if the
app is closed midway: the queue stays on the device.

Each visit has an `id`, so a resent record is recognized and ignored by the Apps Script (no duplicates).

## Things to know

**The Apps Script URL works like a key.** Deployed for "Anyone", whoever has the address can read and write visits.
Since `app.js` lives in a public repository, the URL is visible. That is fine for a prototype with a few consultants;
before using it as an official tool, add a shared token to the Apps Script or move the back-end to a service with real
authentication.

**GPS requires HTTPS.** GitHub Pages already serves over HTTPS. Opening the file straight from disk (`file://`) disables
geolocation and the Service Worker — test through the published link or a local server (`python3 -m http.server`).
