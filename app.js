"use strict";
/* ---------- State ---------- */
const KEY = "focus-app-v1";
const Q = {
  1: { name: "Do first", sub: "Urgent · Important" },
  2: { name: "Schedule", sub: "Not urgent · Important" },
  3: { name: "Delegate", sub: "Urgent · Not important" },
  4: { name: "Eliminate", sub: "Not urgent · Not important" },
};
const MODES = { focus: "Focus", short: "Short break", long: "Long break" };

let S = load();
function load() {
  const def = {
    tasks: [],
    settings: { focus: 25, short: 5, long: 15 },
    sessions: {}, // yyyy-mm-dd -> completed pomodoros
    timer: { mode: "focus", endAt: null, remaining: 25 * 60, taskId: "", cycle: 0 },
    filter: "active", tab: "tasks", calSel: ymd(new Date()), calMonth: ymd(new Date()).slice(0, 7),
  };
  try { return Object.assign(def, JSON.parse(localStorage.getItem(KEY))); } catch { return def; }
}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

/* ---------- Sync support (see sync.js) ---------- */
// Every task carries an updatedAt stamp; deletions leave a tombstone so they propagate between devices.
S.tombs = S.tombs || {};
const ser = ({ updatedAt, ...rest }) => JSON.stringify(rest);
let lastSer = {}, lastSettings = JSON.stringify(S.settings);
S.tasks.forEach(t => { if (!t.updatedAt) t.updatedAt = t.created || Date.now(); lastSer[t.id] = ser(t); });
function stamp() {
  const now = Date.now(), ids = new Set();
  for (const t of S.tasks) {
    ids.add(t.id);
    const s = ser(t);
    if (lastSer[t.id] !== s) { t.updatedAt = now; lastSer[t.id] = s; }
  }
  for (const id in lastSer) if (!ids.has(id)) { S.tombs[id] = now; delete lastSer[id]; }
  const st = JSON.stringify(S.settings);
  if (st !== lastSettings) { S.settingsAt = now; lastSettings = st; }
}
function save() { stamp(); persist(); if (window.Sync) Sync.push(); }
const sigOf = d => JSON.stringify([(d.tasks || []).map(t => [t.id, t.updatedAt]).sort(), Object.entries(d.tombs || {}).sort(), Object.entries(d.sessions || {}).sort(), d.settingsAt || 0]);
const payload = () => ({ tasks: S.tasks, tombs: S.tombs, sessions: S.sessions, settings: S.settings, settingsAt: S.settingsAt || 0, updatedAt: Date.now() });
function mergeRemote(r) {
  const before = sigOf(S), map = new Map(S.tasks.map(t => [t.id, t]));
  for (const t of r.tasks || []) { const l = map.get(t.id); if (!l || (t.updatedAt || 0) > (l.updatedAt || 0)) map.set(t.id, t); }
  for (const [id, ts] of Object.entries(r.tombs || {})) if (ts > (S.tombs[id] || 0)) S.tombs[id] = ts;
  const cutoff = Date.now() - 60 * 864e5;
  for (const id in S.tombs) if (S.tombs[id] < cutoff) delete S.tombs[id];
  S.tasks = [...map.values()].filter(t => !(S.tombs[t.id] >= (t.updatedAt || 0)));
  for (const [d, n] of Object.entries(r.sessions || {})) S.sessions[d] = Math.max(S.sessions[d] || 0, n);
  if ((r.settingsAt || 0) > (S.settingsAt || 0)) { S.settings = Object.assign({}, S.settings, r.settings); S.settingsAt = r.settingsAt; }
  lastSer = {}; S.tasks.forEach(t => lastSer[t.id] = ser(t)); lastSettings = JSON.stringify(S.settings);
  persist();
  return { changed: sigOf(S) !== before, needsPush: sigOf(S) !== sigOf(r) };
}
function afterRemote() {
  if (dlg.open) return;
  const a = document.activeElement;
  if (a && view.contains(a) && /INPUT|SELECT/.test(a.tagName)) return;
  render();
}
window.App = { mergeRemote, payload, afterRemote };

/* ---------- Helpers ---------- */
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = s => document.querySelector(s);
const fmtTime = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const fmtDate = s => { const t = ymd(new Date()); if (s === t) return "Today"; const d = parse(s); const tm = new Date(); tm.setDate(tm.getDate() + 1); if (s === ymd(tm)) return "Tomorrow"; return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
const byId = id => S.tasks.find(t => t.id === id);
function sortTasks(a, b) {
  if (a.done !== b.done) return a.done - b.done;
  if (a.q !== b.q) return a.q - b.q;
  return (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "99").localeCompare(b.time || "99");
}
function meta(t) {
  const bits = [];
  if (t.date) bits.push(`📅 ${fmtDate(t.date)}${t.time ? " · " + fmtTime(t.time) : ""}`);
  if (t.dur) bits.push(`⏱ ${t.dur}m`);
  return bits.map(b => `<span>${b}</span>`).join("");
}
function taskRow(t) {
  const overdue = t.date && !t.done && t.date < ymd(new Date());
  return `<div class="task q${t.q} ${t.done ? "done" : ""}" data-id="${t.id}">
    <input type="checkbox" class="check" ${t.done ? "checked" : ""} data-act="toggle" aria-label="Complete">
    <div class="body" data-act="edit"><div class="t">${esc(t.title)}</div>
      <div class="m"><span class="badge">${Q[t.q].name}</span>${meta(t)}${overdue ? '<span style="color:var(--q1)">Overdue</span>' : ""}</div></div></div>`;
}

/* ---------- Views ---------- */
const view = $("#view");
const titles = { tasks: "Tasks", matrix: "Priority Matrix", calendar: "Calendar", focus: "Focus Timer" };

function render() {
  $("#title").textContent = titles[S.tab];
  const open = S.tasks.filter(t => !t.done).length;
  $("#sub").textContent = S.tab === "tasks" ? `${open} open` : "";
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  ({ tasks: vTasks, matrix: vMatrix, calendar: vCalendar, focus: vFocus })[S.tab]();
}

function vTasks() {
  const f = S.filter;
  const list = S.tasks.filter(t => f === "all" || (f === "done" ? t.done : !t.done)).sort(sortTasks);
  view.innerHTML = `
    <form class="quick" id="quick">
      <input name="t" placeholder="Add a task…" autocomplete="off" required>
      <select name="q" aria-label="Priority">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? "selected" : ""}>${n}. ${Q[n].name}</option>`).join("")}</select>
      <button class="primary">Add</button>
    </form>
    <div class="chips">${["active", "done", "all"].map(x => `<button class="chip ${f === x ? "on" : ""}" data-filter="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div>
    ${list.length ? list.map(taskRow).join("") : `<div class="empty">Nothing here yet 🎉</div>`}
    <p class="hint">Colors: <span class="badge q1">Do first</span> <span class="badge q2">Schedule</span> <span class="badge q3">Delegate</span> <span class="badge q4">Eliminate</span></p>`;
}

function vMatrix() {
  const quad = n => {
    const ts = S.tasks.filter(t => t.q === n && !t.done).sort(sortTasks);
    return `<section class="quad q${n}" data-q="${n}">
      <h3><span>${n}. ${Q[n].name}<small>${Q[n].sub}</small></span><button class="add" data-act="addq" data-q="${n}" aria-label="Add">+</button></h3>
      ${ts.map(t => `<div class="mt" draggable="true" data-id="${t.id}"><input type="checkbox" class="check" data-act="toggle"><div data-act="edit" style="flex:1">${esc(t.title)}${t.date ? `<small>${fmtDate(t.date)}${t.time ? " · " + fmtTime(t.time) : ""}</small>` : ""}</div></div>`).join("")}
    </section>`;
  };
  view.innerHTML = `<div class="axis">
    <span></span><span class="lbl">Urgent</span><span class="lbl">Not urgent</span>
    <span class="lbl side">Important</span>${quad(1)}${quad(2)}
    <span class="lbl side">Not important</span>${quad(3)}${quad(4)}</div>
    <p class="hint">Drag tasks between boxes (Mac) · tap a task to change its box (iPhone)</p>`;
}

function vCalendar() {
  const [y, m] = S.calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const today = ymd(new Date());
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = ymd(d);
    const ts = S.tasks.filter(t => t.date === s && !t.done);
    const qs = [...new Set(ts.map(t => t.q))].sort().slice(0, 4);
    cells += `<button class="day ${d.getMonth() !== m - 1 ? "other" : ""} ${s === today ? "today" : ""} ${s === S.calSel ? "sel" : ""}" data-day="${s}">
      <span class="n">${d.getDate()}</span><span class="dots">${qs.map(q => `<i class="q${q}"></i>`).join("")}</span></button>`;
  }
  const day = S.tasks.filter(t => t.date === S.calSel).sort((a, b) => (a.time || "").localeCompare(b.time || "") || a.q - b.q);
  view.innerHTML = `<div class="cal">
    <div class="calhead"><button data-nav="-1">‹</button><b>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><span><button data-nav="0">Today</button> <button data-nav="1">›</button></span></div>
    <div class="grid7">${["S", "M", "T", "W", "T", "F", "S"].map(d => `<div class="dow">${d}</div>`).join("")}${cells}</div></div>
    <div class="agenda"><h2><span>${fmtDate(S.calSel)}</span><button class="primary" data-act="addday">+ Schedule</button></h2>
    ${day.length ? day.map(t => `<div class="task q${t.q} ${t.done ? "done" : ""}" data-id="${t.id}">
      <input type="checkbox" class="check" ${t.done ? "checked" : ""} data-act="toggle">
      <div class="body" data-act="edit"><div class="t">${esc(t.title)}</div>
      <div class="m"><span class="time">${t.time ? fmtTime(t.time) + (t.dur ? ` – ${fmtTime(endTime(t))}` : "") : "All day"}</span><span class="badge">${Q[t.q].name}</span></div></div></div>`).join("")
      : `<div class="empty">Nothing scheduled</div>`}</div>`;
}
function endTime(t) { const [h, m] = t.time.split(":").map(Number); const x = (h * 60 + m + Number(t.dur)) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; }

/* ---------- Pomodoro ---------- */
let tick = null;
const R = 90, C = 2 * Math.PI * R;
const total = () => S.settings[S.timer.mode] * 60;
const remaining = () => S.timer.endAt ? Math.max(0, Math.ceil((S.timer.endAt - Date.now()) / 1000)) : S.timer.remaining;

function vFocus() {
  const T = S.timer, today = S.sessions[ymd(new Date())] || 0;
  const active = S.tasks.filter(t => !t.done).sort(sortTasks);
  view.innerHTML = `
    <div class="seg">${Object.entries(MODES).map(([k, v]) => `<button class="chip ${T.mode === k ? "on" : ""}" data-mode="${k}">${v}</button>`).join("")}</div>
    <div class="ring ${T.mode !== "focus" ? "break" : ""}" id="ring">
      <svg viewBox="0 0 200 200"><circle class="bg" cx="100" cy="100" r="${R}"/><circle class="fg" id="fg" cx="100" cy="100" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
      <div class="center"><div class="time" id="clock">25:00</div><div class="mode" id="modeLbl">${MODES[T.mode]}</div></div></div>
    <div class="ctrl"><button class="primary" id="startBtn" data-act="startstop"></button><button data-act="reset">Reset</button></div>
    <div class="panel"><label>Working on</label>
      <select id="taskSel"><option value="">— No task —</option>${active.map(t => `<option value="${t.id}" ${T.taskId === t.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select></div>
    <div class="panel"><label>Today: ${today} pomodoro${today === 1 ? "" : "s"} completed</label><div class="tomatoes">${"🍅".repeat(Math.min(today, 16))}</div></div>
    <div class="panel"><label>Durations (minutes)</label><div class="set">
      ${["focus", "short", "long"].map(k => `<div><label>${MODES[k]}</label><input type="number" min="1" max="180" data-set="${k}" value="${S.settings[k]}"></div>`).join("")}</div></div>`;
  paintTimer();
}
function paintTimer() {
  const clock = $("#clock"); if (!clock) return;
  const r = remaining(), m = Math.floor(r / 60), s = r % 60;
  const txt = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  clock.textContent = txt;
  $("#fg").style.strokeDashoffset = C * (1 - r / total());
  $("#startBtn").textContent = S.timer.endAt ? "Pause" : (r < total() ? "Resume" : "Start");
}
function ensureTick() {
  clearInterval(tick); tick = null;
  if (S.timer.endAt) tick = setInterval(onTick, 250);
}
function onTick() {
  if (remaining() <= 0) return complete();
  paintTimer();
  document.title = `${$("#clock") ? $("#clock").textContent : ""} · Focus`;
}
function startStop() {
  const T = S.timer;
  if (T.endAt) { T.remaining = remaining(); T.endAt = null; document.title = "Focus – Productivity"; }
  else {
    if (T.remaining <= 0) T.remaining = total();
    T.endAt = Date.now() + T.remaining * 1000;
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    unlockAudio();
  }
  save(); ensureTick(); paintTimer();
}
function setMode(mode, auto) {
  const T = S.timer;
  T.mode = mode; T.endAt = null; T.remaining = S.settings[mode] * 60;
  save(); ensureTick(); document.title = "Focus – Productivity";
  if (S.tab === "focus") vFocus();
}
function complete() {
  const T = S.timer, wasFocus = T.mode === "focus";
  T.endAt = null; clearInterval(tick);
  beep(); if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  let next;
  if (wasFocus) {
    const k = ymd(new Date()); S.sessions[k] = (S.sessions[k] || 0) + 1;
    T.cycle = (T.cycle || 0) + 1;
    next = T.cycle % 4 === 0 ? "long" : "short";
  } else next = "focus";
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(wasFocus ? "Focus session done 🍅" : "Break over", { body: wasFocus ? `Time for a ${MODES[next].toLowerCase()}.` : "Ready to focus?" }); } catch {}
  setMode(next);
}
let actx;
function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} }
function beep() {
  try {
    unlockAudio();
    [0, 0.25, 0.5].forEach(d => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime + d; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

/* ---------- Editor ---------- */
const dlg = $("#editor"), form = $("#editForm");
let editing = null, editQ = 2;
function drawQ() {
  $("#qpick").innerHTML = [1, 2, 3, 4].map(n => `<button type="button" class="q${n} ${editQ === n ? "on" : ""}" data-pq="${n}"><b>${n}. ${Q[n].name}</b>${Q[n].sub}</button>`).join("");
}
function openEditor(id, defaults = {}) {
  editing = id ? byId(id) : null;
  const t = editing || { title: "", q: 2, date: "", time: "", dur: "", ...defaults };
  $("#editTitle").textContent = editing ? "Edit task" : "New task";
  form.title.value = t.title; form.date.value = t.date || ""; form.time.value = t.time || ""; form.dur.value = t.dur || "";
  editQ = t.q; drawQ();
  $("#delBtn").style.display = editing ? "" : "none";
  dlg.showModal();
  if (!editing) form.title.focus();
}
form.addEventListener("submit", e => {
  e.preventDefault();
  const data = { title: form.title.value.trim(), q: editQ, date: form.date.value, time: form.time.value, dur: form.dur.value ? Number(form.dur.value) : "" };
  if (!data.title) return;
  if (editing) Object.assign(editing, data); else S.tasks.push({ id: uid(), done: false, created: Date.now(), ...data });
  dlg.close(); save(); render();
});
$("#cancelBtn").onclick = () => dlg.close();
$("#delBtn").onclick = () => { S.tasks = S.tasks.filter(t => t !== editing); if (S.timer.taskId === editing.id) S.timer.taskId = ""; dlg.close(); save(); render(); };
$("#qpick").onclick = e => { const b = e.target.closest("[data-pq]"); if (b) { editQ = Number(b.dataset.pq); drawQ(); } };
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

/* ---------- Events ---------- */
$("#tabbar").onclick = e => { const b = e.target.closest("[data-tab]"); if (b) { S.tab = b.dataset.tab; save(); render(); window.scrollTo(0, 0); } };

view.addEventListener("submit", e => {
  if (e.target.id !== "quick") return;
  e.preventDefault();
  const f = e.target, title = f.t.value.trim(); if (!title) return;
  S.tasks.push({ id: uid(), title, q: Number(f.q.value), date: "", time: "", dur: "", done: false, created: Date.now() });
  save(); render();
});
view.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "toggle") { const t = byId(el.closest("[data-id]").dataset.id); t.done = el.checked; save(); render(); }
  else if (el.id === "taskSel") { S.timer.taskId = el.value; save(); }
  else if (el.dataset.set) { const v = Math.max(1, Math.min(180, Number(el.value) || 25)); S.settings[el.dataset.set] = v; if (!S.timer.endAt && S.timer.mode === el.dataset.set) S.timer.remaining = v * 60; save(); paintTimer(); }
});
view.addEventListener("click", e => {
  const t = e.target;
  const filter = t.closest("[data-filter]"); if (filter) { S.filter = filter.dataset.filter; save(); return render(); }
  const mode = t.closest("[data-mode]"); if (mode) return setMode(mode.dataset.mode);
  const day = t.closest("[data-day]"); if (day) { S.calSel = day.dataset.day; S.calMonth = S.calSel.slice(0, 7); save(); return render(); }
  const nav = t.closest("[data-nav]");
  if (nav) {
    const [y, m] = S.calMonth.split("-").map(Number), n = Number(nav.dataset.nav);
    const d = n === 0 ? new Date() : new Date(y, m - 1 + n, 1);
    S.calMonth = ymd(d).slice(0, 7); if (n === 0) S.calSel = ymd(d); save(); return render();
  }
  const act = t.closest("[data-act]"); if (!act) return;
  switch (act.dataset.act) {
    case "edit": openEditor(act.closest("[data-id]").dataset.id); break;
    case "addq": openEditor(null, { q: Number(act.dataset.q) }); break;
    case "addday": openEditor(null, { date: S.calSel, time: "09:00", dur: 30 }); break;
    case "startstop": startStop(); break;
    case "reset": S.timer.endAt = null; S.timer.remaining = total(); save(); ensureTick(); paintTimer(); document.title = "Focus – Productivity"; break;
  }
});

/* Drag & drop between matrix quadrants (desktop) */
let dragId = null;
view.addEventListener("dragstart", e => { const m = e.target.closest(".mt"); if (m) { dragId = m.dataset.id; e.dataTransfer.setData("text/plain", dragId); } });
view.addEventListener("dragover", e => { const q = e.target.closest(".quad"); if (q && dragId) { e.preventDefault(); document.querySelectorAll(".quad.over").forEach(x => x !== q && x.classList.remove("over")); q.classList.add("over"); } });
view.addEventListener("drop", e => { const q = e.target.closest(".quad"); if (q && dragId) { e.preventDefault(); byId(dragId).q = Number(q.dataset.q); dragId = null; save(); render(); } });
view.addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".quad.over").forEach(x => x.classList.remove("over")); });

document.addEventListener("visibilitychange", () => { if (!document.hidden && S.timer.endAt) onTick(); });

/* ---------- Boot ---------- */
render();
if (S.timer.endAt) { if (remaining() <= 0) complete(); else ensureTick(); }
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
