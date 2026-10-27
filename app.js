/* light2Path — memorize Bible verses and quotes.
 * Plain JS, no build step. Data lives in localStorage. */

"use strict";

const STORE_KEY = "light2path.v1";
const LEGACY_STORE_KEY = "hiddenword.v1"; // data saved before the rename
const DAY = 86400000;
const MASTERED_DAYS = 21;
const MODES = [
  { id: "recall", label: "Recall" },
  { id: "fade", label: "Fade" },
  { id: "letters", label: "First letters" },
  { id: "type", label: "Type it" },
  { id: "scramble", label: "Scramble" },
];
const RATINGS = ["Again", "Hard", "Good", "Easy"];

const DEFAULT_SETTINGS = { translation: "ESV", esvKey: "" };

// Early versions seeded these sample verses. Remove any that were never practiced.
const OLD_SAMPLE_REFS = ["Psalm 119:11", "John 3:16", "Proverbs 3:5-6", "Philippians 4:13", "Marcus Aurelius"];

/* ---------- Storage ---------- */

let state = load();
let session = null;     // active practice session; null when not on the practice screen
let searchQuery = "";
let installPrompt = null; // deferred beforeinstallprompt event (Android / desktop Chrome)

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY));
    if (saved && Array.isArray(saved.items)) {
      if (!saved.version) {
        saved.items = saved.items.filter((i) =>
          !(OLD_SAMPLE_REFS.includes(i.ref) && i.srs.reps === 0 && i.srs.lapses === 0));
        saved.version = 2;
        localStorage.setItem(STORE_KEY, JSON.stringify(saved));
      }
      saved.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
      return saved;
    }
  } catch (e) { /* start fresh */ }
  return { version: 2, items: [], stats: { streak: 0, lastDay: null, reviews: 0 }, settings: { ...DEFAULT_SETTINGS } };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("Couldn't save — storage may be full or blocked.");
  }
}

function newItem(ref, text, tags) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ref: ref.trim(),
    text: text.trim(),
    tags: tags || [],
    created: Date.now(),
    srs: { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  };
}

const findItem = (id) => state.items.find((i) => i.id === id);

/* ---------- Spaced repetition (simplified SM-2) ---------- */

function nextSrs(srs, rating) {
  let { interval, ease, reps, lapses } = srs;
  if (rating === 0) {
    reps = 0;
    lapses += 1;
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
  } else {
    if (rating === 1) {
      interval = Math.max(1, interval * 1.2);
      ease = Math.max(1.3, ease - 0.15);
    } else {
      interval = reps === 0 ? 2 : reps === 1 ? 5 : interval * ease;
      if (rating === 3) {
        interval *= 1.3;
        ease = Math.min(3, ease + 0.15);
      }
    }
    reps += 1;
    interval = Math.round(interval * 10) / 10;
  }
  // "Again" comes back in 10 minutes; everything else in N days.
  const due = rating === 0 ? Date.now() + 10 * 60000 : Date.now() + interval * DAY;
  return { due, interval, ease, reps, lapses };
}

function formatInterval(srs) {
  if (srs.interval === 0) return "10 min";
  const d = Math.round(srs.interval);
  if (d < 30) return d + (d === 1 ? " day" : " days");
  const m = Math.round(d / 30);
  return m + (m === 1 ? " month" : " months");
}

const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const isDue = (item) => item.srs.due <= endOfToday();
const isMastered = (item) => item.srs.interval >= MASTERED_DAYS;
const dueItems = () => state.items.filter(isDue).sort((a, b) => a.srs.due - b.srs.due);

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function recordReview(item, rating) {
  item.srs = nextSrs(item.srs, rating);
  const s = state.stats;
  const today = dayKey(Date.now());
  if (s.lastDay !== today) {
    s.streak = s.lastDay === dayKey(Date.now() - DAY) ? s.streak + 1 : 1;
    s.lastDay = today;
  }
  s.reviews += 1;
  save();
}

function currentStreak() {
  const s = state.stats;
  const alive = s.lastDay === dayKey(Date.now()) || s.lastDay === dayKey(Date.now() - DAY);
  return alive ? s.streak : 0;
}

/* ---------- Text helpers ---------- */

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Split text into tokens, keeping whitespace so we can rebuild it exactly.
// Each word token is split into leading punctuation, core, trailing punctuation.
function tokenize(text) {
  return text.split(/(\s+)/).filter(Boolean).map((t) => {
    if (/^\s+$/.test(t)) return { space: t };
    const m = t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    return { pre: m[1], core: m[2], post: m[3] };
  });
}

const normalize = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const wordsOf = (text) => text.split(/\s+/).map(normalize).filter(Boolean);

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Deterministic shuffle so the fade order is stable for each verse.
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Longest common subsequence over words: returns a Set of matched indices in `target`.
function lcsMatches(target, typed) {
  const n = target.length, m = typed.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = target[i] === typed[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matched = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (target[i] === typed[j]) { matched.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return matched;
}

/* ---------- UI helpers ---------- */

const app = document.getElementById("app");
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => Array.from(root.querySelectorAll(sel));

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function statusBadge(item) {
  if (item.srs.reps === 0 && item.srs.lapses === 0) return `<span class="badge badge-new">New</span>`;
  if (isDue(item)) return `<span class="badge badge-due">Due</span>`;
  if (isMastered(item)) return `<span class="badge badge-mastered">Mastered</span>`;
  const days = Math.max(1, Math.ceil((item.srs.due - Date.now()) / DAY));
  return `<span class="badge">in ${days}d</span>`;
}

/* ---------- Router ---------- */

window.addEventListener("hashchange", render);
window.addEventListener("keydown", onKey);

function render() {
  const [, view, id] = location.hash.slice(1).split("/");
  window.scrollTo(0, 0);
  if (view === "add") return renderForm(null);
  if (view === "edit") return renderForm(findItem(id));
  if (view === "practice" && findItem(id)) return startPractice(findItem(id), false);
  if (view === "review") return startReview();
  if (view === "settings") return renderSettings();
  renderHome();
}

/* ---------- Home ---------- */

function renderHome() {
  session = null;
  renderSidebar(null);
  const due = dueItems().length;
  const mastered = state.items.filter(isMastered).length;
  const empty = state.items.length === 0;

  app.innerHTML = `
    ${empty ? `
      <section class="welcome">
        <h1>Hide God's word in your heart</h1>
        <p class="muted">Add the verses or quotes you want to memorize. Practice them a few minutes a day, and light2Path will bring each one back right before you'd forget it.</p>
        <a class="btn btn-cta" href="#/add">+ Add your first verse</a>
      </section>` : `
      <section class="stats">
        <div class="stat"><b>${due}</b><span>Due today</span></div>
        <div class="stat"><b>${state.items.length}</b><span>Verses</span></div>
        <div class="stat"><b>${mastered}</b><span>Mastered</span></div>
        <div class="stat"><b>${currentStreak()}</b><span>Day streak</span></div>
      </section>

      <div class="review-cta">
        ${due
          ? `<a class="btn btn-cta btn-block" href="#/review">Start review · ${due} due</a>`
          : `<div class="empty">You're all caught up for today. Pick any verse to practice anyway.</div>`}
      </div>`}

    ${installCardHtml()}

    ${empty ? "" : `
      <section class="home-library">
        <h2>My verses</h2>
        <input type="search" class="search" placeholder="Search verses, quotes, tags…" value="${esc(searchQuery)}" />
        <div class="list verse-list"></div>
      </section>`}

    <div class="row footer-actions">
      ${empty ? "" : `<button class="btn btn-sm btn-ghost" id="export">Export backup</button>`}
      <label class="btn btn-sm btn-ghost" style="margin:0;font-weight:500">
        Import backup <input type="file" id="import" accept="application/json" hidden />
      </label>
    </div>
  `;

  bindSearch(app);
  bindInstallCard();
  if (!empty) $("#export").addEventListener("click", exportData);
  $("#import").addEventListener("change", importData);
  renderLists();
}

/* ---------- Verse list (sidebar on wide screens, home screen on phones) ---------- */

const sidebar = document.getElementById("sidebar");
let activeId = null;

function renderSidebar(id) {
  activeId = id;
  const scroll = $(".verse-list", sidebar)?.scrollTop || 0;
  sidebar.innerHTML = `
    <div class="sidebar-head">
      <h2>My verses <span class="muted">${state.items.length || ""}</span></h2>
      <a class="btn btn-sm btn-ghost" href="#/add">+ Add</a>
    </div>
    ${state.items.length ? `<input type="search" class="search" placeholder="Search…" value="${esc(searchQuery)}" />` : ""}
    <div class="verse-list compact"></div>
  `;
  bindSearch(sidebar);
  renderLists();
  $(".verse-list", sidebar).scrollTop = scroll;
}

function bindSearch(root) {
  const search = $(".search", root);
  if (search) search.addEventListener("input", () => { searchQuery = search.value; renderLists(); });
}

function renderLists() {
  const q = searchQuery.trim().toLowerCase();
  const items = state.items
    .filter((i) => !q || [i.ref, i.text, ...i.tags].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => (isDue(b) - isDue(a)) || b.created - a.created);

  const html = items.length
    ? items.map((i) => `
        <a class="card ${i.id === activeId ? "active" : ""}" href="#/practice/${i.id}">
          <div class="card-head">
            <span class="card-ref">${refLabel(i)}</span>
            ${statusBadge(i)}
          </div>
          <div class="card-text">${esc(i.text)}</div>
          ${i.tags.length ? `<div class="tags">${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </a>`).join("")
    : `<div class="empty">${q ? "No matches." : `No verses yet.<br><a href="#/add">Add one</a>`}</div>`;

  document.querySelectorAll(".verse-list").forEach((el) => (el.innerHTML = html));
}

/* ---------- Install to home screen ---------- */

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function installCardHtml() {
  if (isStandalone()) return "";
  let dismissed = false;
  try { dismissed = localStorage.getItem("light2path.installDismissed") === "1"; } catch (e) { /* ignore */ }
  if (dismissed) return "";

  let body;
  if (installPrompt) {
    body = `<p class="muted">Install light2Path so it opens like a regular app, full screen and offline.</p>
      <button class="btn btn-primary btn-sm" id="install">Install app</button>`;
  } else if (isIOS()) {
    body = `<p class="muted">In Safari, tap the <b>Share</b> button <span aria-hidden="true">(□↑)</span>, then <b>Add to Home Screen</b>.</p>`;
  } else {
    body = `<p class="muted">Open this page on your phone. On iPhone, use Safari's <b>Share → Add to Home Screen</b>. On Android, open Chrome's <b>⋮</b> menu and tap <b>Add to Home screen</b>.</p>`;
  }
  return `
    <section class="install-card">
      <div class="row"><h2 style="margin:0">📱 Add to your phone</h2><span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" id="install-dismiss" aria-label="Dismiss">✕</button></div>
      ${body}
    </section>`;
}

function bindInstallCard() {
  const btn = $("#install");
  if (btn) btn.addEventListener("click", async () => {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderHome();
  });
  const dismiss = $("#install-dismiss");
  if (dismiss) dismiss.addEventListener("click", () => {
    try { localStorage.setItem("light2path.installDismissed", "1"); } catch (e) { /* ignore */ }
    dismiss.closest(".install-card").remove();
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!session && !location.hash.slice(2)) renderHome();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
}

function exportData() {
  const backup = { ...state, settings: { ...state.settings, esvKey: "" } }; // never put the API key in a file
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `light2path-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((txt) => {
    const data = JSON.parse(txt);
    if (!Array.isArray(data.items)) throw new Error("bad file");
    const known = new Set(state.items.map((i) => i.id));
    const added = data.items.filter((i) => i.id && i.text && !known.has(i.id));
    state.items.push(...added);
    save();
    toast(`Imported ${added.length} new item${added.length === 1 ? "" : "s"}.`);
    renderHome();
  }).catch(() => toast("That file doesn't look like a light2Path backup."));
}

/* ---------- Verse lookup ---------- */

const TRANSLATIONS = [
  { id: "ESV", label: "ESV" },
  { id: "KJV", label: "KJV" },
  { id: "WEB", label: "WEB (World English Bible)" },
  { id: "", label: "None — a quote or my own text" },
];
const ESV_NOTICE = "Scripture quotations marked “ESV” are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.";

// Returns { ref, text } or throws an Error with a message fit to show the user.
async function lookupVerse(ref, translation) {
  if (translation === "ESV") {
    const key = state.settings.esvKey;
    if (!key) throw new Error("NO_KEY");
    const params = new URLSearchParams({
      q: ref,
      "include-passage-references": "false",
      "include-verse-numbers": "false",
      "include-first-verse-numbers": "false",
      "include-footnotes": "false",
      "include-footnote-body": "false",
      "include-headings": "false",
      "include-short-copyright": "false",
      "include-selahs": "true",
      "indent-paragraphs": "0",
      "indent-poetry": "false",
    });
    let res;
    try {
      res = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, { headers: { Authorization: `Token ${key}` } });
    } catch (e) {
      throw new Error("Couldn't reach the ESV API. Check your connection.");
    }
    if (res.status === 401 || res.status === 403) throw new Error("The ESV API rejected your key. Check it in Settings.");
    if (!res.ok) throw new Error(`The ESV API returned an error (${res.status}).`);
    const data = await res.json();
    const text = (data.passages || []).join(" ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`Couldn't find “${ref}”. Try a format like John 3:16.`);
    return { ref: data.canonical || ref, text };
  }

  let res;
  try {
    res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}?translation=${translation.toLowerCase()}`);
  } catch (e) {
    throw new Error("Couldn't reach the lookup service. Check your connection.");
  }
  if (res.status === 404) throw new Error(`Couldn't find “${ref}”. Try a format like John 3:16.`);
  if (!res.ok) throw new Error(`The lookup service returned an error (${res.status}).`);
  const data = await res.json();
  return { ref: data.reference || ref, text: (data.text || "").replace(/\s+/g, " ").trim() };
}

const refLabel = (item) =>
  esc(item.ref) + (item.translation ? ` <span class="translation">${esc(item.translation)}</span>` : "");

/* ---------- Add / edit ---------- */

function renderForm(item) {
  session = null;
  renderSidebar(item ? item.id : null);
  const current = item ? item.translation || "" : state.settings.translation;

  app.innerHTML = `
    <h1>${item ? "Edit" : "Add a verse or quote"}</h1>
    <form id="form">
      <label for="ref">Reference or source</label>
      <input type="text" id="ref" required autocomplete="off" placeholder="e.g. Romans 8:28 or C.S. Lewis" value="${esc(item ? item.ref : "")}" />

      <label for="translation">Translation</label>
      <div class="row lookup-row">
        <select id="translation">
          ${TRANSLATIONS.map((t) => `<option value="${t.id}" ${t.id === current ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
        <button class="btn" type="button" id="lookup">Look up</button>
      </div>
      <p class="lookup-msg" id="lookup-msg" hidden></p>

      <label for="text">Text</label>
      <textarea id="text" required placeholder="Look it up above, or paste or type the passage…">${esc(item ? item.text : "")}</textarea>

      <label for="tags">Tags <span class="hint">— optional, comma separated</span></label>
      <input type="text" id="tags" placeholder="e.g. faith, anxiety" value="${esc(item ? item.tags.join(", ") : "")}" />

      <div class="row form-actions">
        <button class="btn btn-primary" type="submit">${item ? "Save changes" : "Add to my verses"}</button>
        <a class="btn btn-ghost" href="${item ? `#/practice/${item.id}` : "#/"}">Cancel</a>
        <span class="spacer"></span>
        ${item ? `<button class="btn btn-ghost btn-danger" type="button" id="delete">Delete</button>` : ""}
      </div>
    </form>
  `;

  const refInput = $("#ref"), select = $("#translation"), lookupBtn = $("#lookup"), msg = $("#lookup-msg");
  refInput.focus();

  const showMsg = (html, isError) => {
    msg.innerHTML = html;
    msg.classList.toggle("error", Boolean(isError));
    msg.hidden = !html;
  };
  const syncLookup = () => { lookupBtn.hidden = !select.value; showMsg(""); };
  select.addEventListener("change", syncLookup);
  syncLookup();

  async function doLookup() {
    const ref = refInput.value.trim();
    if (!ref) { refInput.focus(); return; }
    lookupBtn.disabled = true;
    lookupBtn.textContent = "Looking up…";
    try {
      const found = await lookupVerse(ref, select.value);
      refInput.value = found.ref;
      $("#text").value = found.text;
      showMsg(`Found ${esc(found.ref)} (${esc(select.value)}).`);
    } catch (e) {
      showMsg(e.message === "NO_KEY"
        ? `To look up the ESV, add your free ESV API key in <a href="#/settings">Settings</a>. You can use KJV or WEB right away.`
        : esc(e.message), true);
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = "Look up";
    }
  }
  lookupBtn.addEventListener("click", doLookup);
  // Enter in the reference field looks it up when there's no text yet.
  refInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && select.value && !$("#text").value.trim()) { e.preventDefault(); doLookup(); }
  });

  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = refInput.value.trim();
    const text = $("#text").value.trim();
    const tags = $("#tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    const translation = select.value;
    if (!ref || !text) return;
    const editing = Boolean(item);
    if (editing) {
      Object.assign(item, { ref, text, tags, translation });
    } else {
      item = newItem(ref, text, tags);
      item.translation = translation;
      state.items.push(item);
    }
    save();
    toast(editing ? "Saved." : "Added.");
    location.hash = `#/practice/${item.id}`;
  });

  const del = $("#delete");
  if (del) {
    del.addEventListener("click", () => {
      if (del.dataset.armed) {
        state.items = state.items.filter((i) => i !== item);
        save();
        toast("Deleted.");
        location.hash = "#/";
      } else {
        del.dataset.armed = "1";
        del.textContent = "Tap again to delete";
      }
    });
  }
}

/* ---------- Settings ---------- */

function renderSettings() {
  session = null;
  renderSidebar(null);
  const s = state.settings;

  app.innerHTML = `
    <h1>Settings</h1>

    <label for="default-translation">Default translation</label>
    <select id="default-translation">
      ${TRANSLATIONS.map((t) => `<option value="${t.id}" ${t.id === s.translation ? "selected" : ""}>${t.label}</option>`).join("")}
    </select>

    <section class="settings-card">
      <h2>ESV API key</h2>
      <p class="muted">Looking up the ESV needs a free key from Crossway, the ESV's publisher. It's saved only on this device.</p>
      <ol class="muted steps">
        <li>Sign up at <a href="https://api.esv.org/account/create-application/" target="_blank" rel="noopener">api.esv.org</a>.</li>
        <li>Create an application. A personal, non-commercial app is fine.</li>
        <li>Copy the API key and paste it here.</li>
      </ol>
      <input type="text" id="esv-key" autocomplete="off" spellcheck="false" placeholder="Paste your ESV API key" value="${esc(s.esvKey)}" />
      <div class="row stage-tools">
        <button class="btn btn-primary" id="save-key">Test &amp; save</button>
        ${s.esvKey ? `<button class="btn btn-ghost btn-danger" id="remove-key">Remove key</button>` : ""}
      </div>
      <p class="lookup-msg" id="key-msg" hidden></p>
    </section>

    <p class="notice">${ESV_NOTICE}</p>
    <p class="notice">KJV and WEB text are public domain, fetched from bible-api.com.</p>
  `;

  $("#default-translation").addEventListener("change", (e) => {
    s.translation = e.target.value;
    save();
    toast("Default translation saved.");
  });

  const msg = $("#key-msg");
  const showMsg = (text, isError) => { msg.textContent = text; msg.classList.toggle("error", isError); msg.hidden = false; };

  $("#save-key").addEventListener("click", async (e) => {
    const key = $("#esv-key").value.trim();
    if (!key) return showMsg("Paste a key first.", true);
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Testing…";
    const previous = s.esvKey;
    s.esvKey = key;
    try {
      await lookupVerse("John 11:35", "ESV");
      save();
      renderSettings();
      toast("ESV key saved — lookups are ready.");
    } catch (err) {
      s.esvKey = previous;
      showMsg(err.message === "NO_KEY" ? "Paste a key first." : err.message, true);
      btn.disabled = false;
      btn.textContent = "Test & save";
    }
  });

  const remove = $("#remove-key");
  if (remove) remove.addEventListener("click", () => {
    s.esvKey = "";
    save();
    renderSettings();
    toast("ESV key removed.");
  });
}

/* ---------- Practice ---------- */

function startReview() {
  const queue = dueItems();
  if (!queue.length) return renderDone(0);
  startPractice(queue[0], true, { reviewed: 0, total: queue.length });
}

function startPractice(item, review, progress) {
  renderSidebar(item.id);
  session = {
    item,
    review,
    progress: progress || null,
    mode: review ? "recall" : (session && session.item === item ? session.mode : "fade"),
    fadeLevel: 0,
    revealed: new Set(),
    shown: false,          // recall: has the text been revealed
    typed: "",
    checked: null,         // type: { matched, score }
    scramble: null,
    suggested: null,       // rating suggested by type/scramble results
  };
  renderPractice();
}

function renderPractice() {
  const { item, review, progress } = session;
  app.innerHTML = `
    <div class="practice-head">
      <div class="row">
        <a class="btn btn-sm btn-ghost" href="#/">← My verses</a>
        <span class="spacer"></span>
        ${progress ? `<span class="muted">${progress.reviewed + 1} of ${progress.total}</span>` : ""}
        ${!review ? `<a class="btn btn-sm btn-ghost" href="#/edit/${item.id}">Edit</a>` : ""}
        <button class="btn btn-sm btn-ghost" id="speak" title="Read aloud">🔊 Listen</button>
      </div>
      <p class="practice-ref">${refLabel(item)}</p>
    </div>

    <div class="tabs" role="tablist">
      ${MODES.map((m) => `<button class="tab" role="tab" data-mode="${m.id}" aria-selected="${m.id === session.mode}">${m.label}</button>`).join("")}
    </div>

    <div class="stage" id="stage"></div>

    <div class="rate">
      <p>How well did you know it?</p>
      <div class="rate-grid">
        ${RATINGS.map((r, i) => `
          <button class="rate-btn" data-r="${i}">${r}<small>${formatInterval(nextSrs(item.srs, i))}</small></button>`).join("")}
      </div>
    </div>
    ${item.translation === "ESV" ? `<p class="notice">${ESV_NOTICE}</p>` : ""}
  `;

  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    session.mode = t.dataset.mode;
    session.suggested = null;
    $$(".tab").forEach((x) => x.setAttribute("aria-selected", x === t));
    renderStage();
  }));
  $$(".rate-btn").forEach((b) => b.addEventListener("click", () => rate(Number(b.dataset.r))));
  $("#speak").addEventListener("click", speak);
  renderStage();
}

function renderStage() {
  const stage = $("#stage");
  const renderers = { recall: stageRecall, fade: stageFade, letters: stageLetters, type: stageType, scramble: stageScramble };
  renderers[session.mode](stage);
  $$(".rate-btn").forEach((b) => b.classList.toggle("suggested", Number(b.dataset.r) === session.suggested));
}

// Render the verse, deciding per word whether it's shown, hidden, or partially hidden.
// `wordState(index)` returns "show" | "hide" | "first".
function verseHtml(wordState, extraClass) {
  let wi = -1;
  return tokenize(session.item.text).map((t) => {
    if (t.space) return t.space;
    wi++;
    const revealed = session.revealed.has(wi);
    const st = revealed ? "show" : wordState(wi);
    const cls = extraClass ? extraClass(wi) : "";
    if (st === "show" || !t.core) {
      return `<span class="w ${revealed ? "peek" : ""} ${cls}" data-i="${wi}">${esc(t.pre + t.core + t.post)}</span>`;
    }
    const head = st === "first" ? esc(t.core[0]) : "";
    const hiddenLen = st === "first" ? t.core.length - 1 : t.core.length;
    const blank = hiddenLen > 0 ? `<span class="blank" style="width:${Math.max(0.6, hiddenLen * 0.55)}em"></span>` : "";
    return `<span class="w" data-i="${wi}" data-hidden>${esc(t.pre)}${head}${blank}${esc(t.post)}</span>`;
  }).join("");
}

function bindPeek(stage) {
  $$("[data-i]", stage).forEach((el) => el.addEventListener("click", () => {
    const i = Number(el.dataset.i);
    if (el.hasAttribute("data-hidden")) session.revealed.add(i);
    else session.revealed.delete(i);
    renderStage();
  }));
}

function stageRecall(stage) {
  if (!session.shown) {
    stage.innerHTML = `
      <div class="recall-cover">
        <p class="muted" style="margin:0">Say or think through the whole passage from memory.</p>
        <button class="btn btn-primary" id="show">Show the text <span class="muted" style="color:inherit;opacity:.7">(space)</span></button>
      </div>`;
    $("#show", stage).addEventListener("click", () => { session.shown = true; renderStage(); });
    return;
  }
  stage.innerHTML = `<p class="verse">${esc(session.item.text)}</p>
    <p class="mode-help" style="margin-top:14px">Check yourself, then rate below.</p>`;
}

function stageFade(stage) {
  const count = tokenize(session.item.text).filter((t) => !t.space).length;
  const order = seededShuffle([...Array(count).keys()], hashString(session.item.id));
  const hidden = new Set(order.slice(0, Math.round((session.fadeLevel / 10) * count)));

  stage.innerHTML = `
    <p class="mode-help">Read it aloud, then slide right to hide more words. Tap a blank to peek.</p>
    <p class="verse">${verseHtml((i) => (hidden.has(i) ? "hide" : "show"))}</p>
    <div class="row stage-tools">
      <button class="btn btn-sm" id="less" aria-label="Show more words">−</button>
      <input type="range" min="0" max="10" value="${session.fadeLevel}" id="level" aria-label="Words hidden" />
      <button class="btn btn-sm" id="more" aria-label="Hide more words">+</button>
      <span class="muted" style="min-width:3.5em;text-align:right">${session.fadeLevel * 10}%</span>
    </div>`;

  const set = (v) => { session.fadeLevel = Math.max(0, Math.min(10, v)); session.revealed.clear(); renderStage(); };
  $("#level", stage).addEventListener("input", (e) => set(Number(e.target.value)));
  $("#less", stage).addEventListener("click", () => set(session.fadeLevel - 1));
  $("#more", stage).addEventListener("click", () => set(session.fadeLevel + 1));
  bindPeek(stage);
}

function stageLetters(stage) {
  stage.innerHTML = `
    <p class="mode-help">Only the first letter of each word is shown. Recite it, tapping any word you're stuck on.</p>
    <p class="verse">${verseHtml(() => "first")}</p>`;
  bindPeek(stage);
}

function stageType(stage) {
  const target = wordsOf(session.item.text);
  const c = session.checked;

  stage.innerHTML = `
    <p class="mode-help">Type the passage from memory. Punctuation and capitals don't matter.</p>
    <textarea id="typed" placeholder="Start typing…" spellcheck="false" autocapitalize="off">${esc(session.typed)}</textarea>
    <div class="row stage-tools">
      <button class="btn btn-primary" id="check">Check</button>
      ${c ? `<button class="btn btn-ghost" id="retry">Try again</button>` : ""}
    </div>
    ${c ? `
      <p class="score">${c.score}% — ${c.matched.size} of ${target.length} words</p>
      <p class="verse">${verseHtml(() => "show", (i) => (c.matched.has(i) ? "ok" : "miss"))}</p>` : ""}`;

  const ta = $("#typed", stage);
  ta.addEventListener("input", () => (session.typed = ta.value));
  if (!c) ta.focus();
  $("#check", stage).addEventListener("click", () => {
    const matched = lcsMatches(target, wordsOf(session.typed));
    const score = Math.round((matched.size / target.length) * 100);
    session.checked = { matched, score };
    session.suggested = score === 100 ? 3 : score >= 90 ? 2 : score >= 70 ? 1 : 0;
    renderStage();
  });
  const retry = $("#retry", stage);
  if (retry) retry.addEventListener("click", () => {
    session.typed = "";
    session.checked = null;
    session.suggested = null;
    renderStage();
  });
}

function stageScramble(stage) {
  if (!session.scramble) {
    const words = session.item.text.split(/\s+/).filter(Boolean);
    const size = words.length <= 12 ? 2 : words.length <= 30 ? 3 : 4;
    const chunks = [];
    for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(" "));
    session.scramble = { chunks, pool: shuffle(chunks.map((_, i) => i)), placed: [], mistakes: 0 };
  }
  const s = session.scramble;
  const done = s.placed.length === s.chunks.length;

  stage.innerHTML = `
    <p class="mode-help">Tap the pieces in the right order.</p>
    <div class="placed"><p class="verse">${s.placed.map((i) => esc(s.chunks[i])).join(" ") || `<span class="muted">…</span>`}</p></div>
    ${done
      ? `<p class="score">Done! ${s.mistakes ? `${s.mistakes} mistake${s.mistakes === 1 ? "" : "s"}.` : "Perfect."}</p>
         <button class="btn" id="again">Shuffle again</button>`
      : `<div class="pool">${s.pool.map((i) => `<button class="chunk" data-c="${i}">${esc(s.chunks[i])}</button>`).join("")}</div>`}`;

  $$(".chunk", stage).forEach((btn) => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.c);
    // Compare by text so repeated phrases are interchangeable.
    if (s.chunks[i] === s.chunks[s.placed.length]) {
      s.placed.push(i);
      s.pool = s.pool.filter((p) => p !== i);
      if (s.placed.length === s.chunks.length) {
        session.suggested = s.mistakes === 0 ? 2 : s.mistakes <= 2 ? 1 : 0;
      }
      renderStage();
    } else {
      s.mistakes++;
      btn.classList.remove("wrong");
      void btn.offsetWidth; // restart animation
      btn.classList.add("wrong");
    }
  }));
  const again = $("#again", stage);
  if (again) again.addEventListener("click", () => { session.scramble = null; session.suggested = null; renderStage(); });
}

function rate(r) {
  const { item, review, progress } = session;
  recordReview(item, r);
  toast(`${RATINGS[r]} — next review in ${formatInterval(item.srs)}.`);
  if (!review) {
    location.hash = "#/";
    return;
  }
  const reviewed = progress.reviewed + 1;
  // Items rated "Again" stay due today and come back at the end of the queue.
  const remaining = dueItems();
  if (!remaining.length || reviewed >= progress.total + 20) return renderDone(reviewed);
  startPractice(remaining[0], true, { reviewed, total: reviewed + remaining.length });
}

function renderDone(count) {
  session = null;
  renderSidebar(null);
  app.innerHTML = `
    <div class="done">
      <div class="big">✓</div>
      <h1>${count ? "Review complete" : "Nothing due"}</h1>
      <p class="muted">${count ? `You reviewed ${count} item${count === 1 ? "" : "s"}. Streak: ${currentStreak()} day${currentStreak() === 1 ? "" : "s"}.` : "You're all caught up."}</p>
      <div class="row" style="justify-content:center;margin-top:20px">
        <a class="btn btn-primary" href="#/">Back to my verses</a>
      </div>
    </div>`;
}

function speak() {
  if (!("speechSynthesis" in window)) return toast("Speech isn't supported in this browser.");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${session.item.ref}. ${session.item.text}`);
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/* ---------- Keyboard ---------- */

function onKey(e) {
  if (!session || e.metaKey || e.ctrlKey || e.altKey) return;
  if (["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)) return;
  if (e.key >= "1" && e.key <= "4") { rate(Number(e.key) - 1); return; }
  if (e.key === " " && session.mode === "recall" && !session.shown) {
    e.preventDefault();
    session.shown = true;
    renderStage();
  }
  if (session.mode === "fade" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    session.fadeLevel = Math.max(0, Math.min(10, session.fadeLevel + (e.key === "ArrowRight" ? 1 : -1)));
    session.revealed.clear();
    renderStage();
  }
}

render();
