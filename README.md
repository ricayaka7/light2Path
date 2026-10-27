# light2Path

> "Thy word is a lamp unto my feet, and a light unto my path." — Psalm 119:105

An app for memorizing Bible verses or any quote. You don't need an account. Your verses are saved on your device.

## Run it

The app needs to be served, not opened as a file, so verse lookup and offline mode work:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Put it on your phone

1. Host the folder on an HTTPS site such as GitHub Pages, Netlify or Cloudflare Pages. Offline mode and installing require HTTPS.
2. Open the site on your phone:
   - **iPhone:** in Safari, tap **Share → Add to Home Screen**.
   - **Android:** in Chrome, tap **Install app**, or open the **⋮** menu and choose **Add to Home screen**.

The installed app opens full screen and works offline. Its storage is separate from the browser's, so use **Export backup / Import backup** to move your verses into it.

## ESV lookup

The ESV is the default translation. To look up ESV text, you need a free API key:

1. Sign up at <https://api.esv.org/account/create-application/> and create a personal, non-commercial application.
2. In the app, open **⚙︎ Settings**, paste the key, and tap **Test & save**.

The key is stored only on your device and is left out of backups. KJV and WEB lookups need no key. They use public-domain text from bible-api.com.

ESV text is © Crossway. The free API key is for **non-commercial use** and requires showing the copyright notice, which the app does. Selling the app or charging for it would need a separate license from Crossway.

## How it works

- **My verses:** a sidebar on wide screens, and the home screen on phones. Type a reference, tap **Look up**, and the text fills in. You can also paste any quote.
- **Practice modes:**
  - **Recall:** see the reference, recite the passage, then reveal it.
  - **Fade:** hide more words with the slider (or the ← → keys).
  - **First letters:** only the first letter of each word is shown.
  - **Type it:** type it from memory and get a word-by-word score.
  - **Scramble:** put the shuffled phrases back in order.
  - **Listen:** reads the passage aloud.
- **Spaced repetition:** after practicing, rate yourself *Again / Hard / Good / Easy* (keys 1–4). The app schedules the next review, sooner for hard verses and later for ones you know. A verse counts as *Mastered* once its review interval reaches 21 days.

## Files

- `index.html`: page shell
- `styles.css`: styles (light and dark follow your system setting)
- `app.js`: app logic (storage, scheduler, lookup, practice modes)
- `sw.js`: offline caching
- `manifest.webmanifest`, `icons/`: home-screen app name and icon
