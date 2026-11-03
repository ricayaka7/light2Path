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

- **My verses:** a sidebar on wide screens, and the home screen on phones.
- **Adding:** tap **+ Add** and type a reference (`John 3:16`, `Psalm 23 KJV`) or paste a verse or quote into the one box, then tap **Continue**. The app looks up the text or picks the reference and version out of the paste, then shows the full form so you can check it. Anything it couldn't find, like a quote's source or text for a version it can't look up, is marked for you to fill in before you add it.
- **One verse per line:** passages are saved with each verse on its own numbered line. When you paste a passage, the app splits it automatically: it uses verse numbers in the paste if there are any (`16`, `[16]`, `¹⁶`), and otherwise matches the words against the passage from the ESV (or the WEB if you have no ESV key). This works even when you paste another translation. **Split into verses** under the text does the same for verses you already saved. Verse numbers aren't part of practice.
- **Version and reference in a paste:** if the pasted text names its version or reference (`John 3:16-17 NIV`, `(NKJV)`), they move into their own fields, and copyright lines and links are removed. A reference you already typed is kept. NIV, NASB, NKJV, NLT, CSB, RSV, NRSV, AMP and MSG can be pasted and labelled but not looked up.
- **Practice modes:**
  - **Recall:** see the reference, recite the passage, then reveal it.
  - **Fade:** hide more words with the slider (or the ← → keys).
  - **First letters:** only the first letter of each word is shown.
  - **Type it:** type it from memory and get a word-by-word score.
  - **Scramble:** put the shuffled phrases back in order.
  - **Say it:** say the passage from memory into the microphone and get a word-by-word score.
  - **Listen & repeat:** hear the passage one phrase at a time and say each back in the pause.
  - **Listen:** reads the passage aloud.
- **Voice:** turn on **Voice help** in Settings and the app reads instructions, scores and messages aloud, starts in the voice modes and uses larger buttons. On **+ Add**, tap **Say a reference** to add a verse by speaking it (`first John three sixteen`). Listening uses the browser's speech recognition (Chrome, Edge, Safari; not Firefox), and Chrome and Edge send the audio to their makers.
- **Spaced repetition:** after practicing, rate yourself *Again / Hard / Good / Easy* (keys 1–4). The app schedules the next review, sooner for hard verses and later for ones you know. A verse counts as *Mastered* once its review interval reaches 21 days.

## Files

- `index.html`: page shell
- `styles.css`: styles (light and dark follow your system setting)
- `app.js`: app logic (storage, scheduler, lookup, practice modes)
- `sw.js`: offline caching
- `manifest.webmanifest`, `icons/`: home-screen app name and icon
