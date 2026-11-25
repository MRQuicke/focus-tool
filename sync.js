import cfg from "./firebase-config.js";

const V = "10.12.2", base = `https://www.gstatic.com/firebasejs/${V}/`;
const $ = s => document.querySelector(s);
const btn = $("#syncBtn"), dlg = $("#syncDlg"), msg = $("#syncMsg"), form = $("#syncForm");
let ref = null, unsub = null, timer = null, fb = null, user = null, status = "";

window.Sync = { push: () => {} };

function paint() {
  btn.textContent = !cfg.apiKey ? "☁︎ Sync" : user ? (status === "error" ? "⚠︎ Sync" : status === "syncing" ? "☁︎ …" : "☁︎ ✓") : "☁︎ Sign in";
  $("#syncIn").style.display = user ? "none" : "";
  $("#syncOut").style.display = user ? "" : "none";
  $("#syncUser").textContent = user ? user.email : "";
}
btn.onclick = () => {
  if (!cfg.apiKey) msg.textContent = "Sync isn't set up yet: add your Firebase config to firebase-config.js.";
  else if (!fb) msg.textContent = "Couldn't load sync (are you offline?).";
  else msg.textContent = user ? "Signed in. Your tasks sync automatically." : "Sign in with the same account on every device.";
  dlg.showModal();
};
$("#syncClose").onclick = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
paint();

async function main() {
  if (!cfg.apiKey) return;
  let app, auth, db;
  try {
    const [a, b, c] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")]);
    fb = { ...a, ...b, ...c };
    app = fb.initializeApp(cfg); auth = fb.getAuth(app); db = fb.getFirestore(app);
  } catch (e) { console.warn("sync unavailable", e); return; }

  const nice = e => ({ "auth/invalid-credential": "Wrong email or password.", "auth/email-already-in-use": "That email already has an account. Use Sign in.", "auth/weak-password": "Password must be at least 6 characters.", "auth/invalid-email": "That email address isn't valid." }[e.code] || e.message);
  async function go(kind) {
    if (!form.reportValidity()) return;
    msg.textContent = "Working…";
    try { await (kind === "up" ? fb.createUserWithEmailAndPassword : fb.signInWithEmailAndPassword)(auth, form.email.value.trim(), form.password.value); form.password.value = ""; dlg.close(); }
    catch (e) { msg.textContent = nice(e); }
  }
  $("#syncSignIn").onclick = () => go("in");
  $("#syncSignUp").onclick = () => go("up");
  $("#syncSignOut").onclick = () => { fb.signOut(auth); dlg.close(); };

  async function doPush() {
    if (!ref) return;
    status = "syncing"; paint();
    try {
      const snap = await fb.getDoc(ref);
      if (snap.exists() && App.mergeRemote(snap.data()).changed) App.afterRemote();
      await fb.setDoc(ref, App.payload());
      status = "ok";
    } catch (e) { console.warn(e); status = "error"; }
    paint();
  }
  Sync.push = () => { if (!ref) return; clearTimeout(timer); timer = setTimeout(doPush, 700); };

  fb.onAuthStateChanged(auth, u => {
    user = u; if (unsub) { unsub(); unsub = null; } ref = null; status = "";
    if (u) {
      ref = fb.doc(db, "users", u.uid, "data", "state");
      status = "syncing";
      unsub = fb.onSnapshot(ref, snap => {
        if (!snap.exists()) { doPush(); return; }
        const r = App.mergeRemote(snap.data());
        if (r.changed) App.afterRemote();
        if (r.needsPush) Sync.push(); else { status = "ok"; paint(); }
      }, e => { console.warn(e); status = "error"; paint(); });
    }
    paint();
  });
  window.addEventListener("online", () => Sync.push());
}
main();
