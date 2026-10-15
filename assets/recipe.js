// Recipes site — checklists, cook timers and the alarm. Shared by every page.
(() => {
  const PAGE = document.body.dataset.key || location.pathname;

  // ---------- checklists (prep + shopping), remembered per browser ----------
  const names = [...new Set([...document.querySelectorAll("[data-checklist]")].map(l => l.dataset.checklist))];
  names.forEach(name => {
    const list = { dataset: { checklist: name } };
    const key = PAGE + ":" + name;
    const boxes = [...document.querySelectorAll('[data-checklist="' + name + '"] input[type=checkbox]')];
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { saved = {}; }
    const save = () => {
      const s = {}; boxes.forEach(b => { if (b.checked) s[b.id] = 1; });
      try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {}
      updateCount();
    };
    boxes.forEach(b => { b.checked = !!saved[b.id]; b.addEventListener("change", save); });
    const counter = document.querySelector('[data-count-for="' + list.dataset.checklist + '"]');
    function updateCount() {
      if (counter) counter.textContent = boxes.filter(b => b.checked).length + " of " + boxes.length;
    }
    updateCount();
    const clear = document.querySelector('[data-clear="' + list.dataset.checklist + '"]');
    if (clear) clear.addEventListener("click", () => { boxes.forEach(b => b.checked = false); save(); });
  });

  if (!document.querySelector(".timer")) return;

  // ---------- alarm sound ----------
  // A loud kitchen-timer pattern rendered to a WAV once, played through an <audio> element.
  // <audio> plays at full media volume and, on iPhones, even with the ring switch on silent.
  function makeAlarm(seconds) {
    const rate = 22050, n = Math.floor(rate * seconds), pcm = new Int16Array(n);
    const beep = 0.09, gap = 0.05, groupGap = 0.32, freqs = [2100, 2700];
    let t = 0, k = 0;
    while (t < seconds) {
      for (let b = 0; b < 4 && t < seconds; b++) {
        const f = freqs[(k + b) % 2], s0 = Math.floor(t * rate), s1 = Math.min(n, Math.floor((t + beep) * rate));
        for (let i = s0; i < s1; i++) {
          const x = (i - s0) / rate, edge = Math.min(1, x / 0.003, (beep - x) / 0.003);
          pcm[i] = Math.max(-1, Math.min(1, Math.sign(Math.sin(2 * Math.PI * f * x)) * 0.92 * edge)) * 32767;
        }
        t += beep + gap;
      }
      k++; t += groupGap;
    }
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    new Int16Array(buf, 44).set(pcm);
    const a = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
    a.preload = "auto";
    return a;
  }
  const sounds = { done: makeAlarm(5), cue: makeAlarm(2) };
  let unlocked = false;
  function unlock() {
    if (unlocked) return; unlocked = true;
    Object.values(sounds).forEach(a => {
      a.muted = true;
      const p = a.play();
      const reset = () => { a.pause(); a.currentTime = 0; a.muted = false; };
      if (p && p.then) p.then(reset).catch(() => { a.muted = false; unlocked = false; }); else reset();
    });
  }
  document.addEventListener("pointerdown", unlock, { capture: true });
  document.addEventListener("keydown", unlock, { capture: true });

  const overlay = document.createElement("div");
  overlay.className = "alarm"; overlay.hidden = true; overlay.setAttribute("role", "alertdialog");
  overlay.innerHTML = '<div class="what"></div><div class="sub"></div><button type="button">Got it</button>';
  document.body.appendChild(overlay);
  let hideTimer = null;
  function stopSound() { Object.values(sounds).forEach(a => { a.pause(); a.currentTime = 0; }); try { navigator.vibrate && navigator.vibrate(0); } catch (e) {} }
  function dismiss() { stopSound(); overlay.hidden = true; clearTimeout(hideTimer); }
  overlay.querySelector("button").addEventListener("click", dismiss);

  function ring(kind, what, sub) {
    stopSound();
    const a = sounds[kind];
    a.currentTime = 0;
    a.play().catch(() => {});
    try { navigator.vibrate && navigator.vibrate(kind === "done" ? Array(10).fill([350, 150]).flat() : [350, 150, 350, 150, 350]); } catch (e) {}
    overlay.dataset.kind = kind;
    overlay.querySelector(".what").textContent = what;
    overlay.querySelector(".sub").textContent = sub;
    overlay.hidden = false;
    overlay.querySelector("button").focus();
    clearTimeout(hideTimer);
    if (kind === "cue") hideTimer = setTimeout(() => { overlay.hidden = true; }, 6000);
  }

  // ---------- timers ----------
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const timers = {};
  document.querySelectorAll(".timer").forEach(btn => {
    const t = {
      id: btn.dataset.id, label: btn.dataset.label, btn,
      total: +btn.dataset.secs, left: +btn.dataset.secs, end: 0, state: "idle",
      cue: btn.dataset.cue ? +btn.dataset.cue : null, cueText: btn.dataset.cueText || "", cued: false,
      note: document.getElementById("cue-" + btn.dataset.id)
    };
    t.noteDefault = t.note ? t.note.textContent : "";
    timers[t.id] = t;
    btn.addEventListener("click", () => toggle(t));
    render(t);
  });
  document.querySelectorAll("[data-reset]").forEach(b => b.addEventListener("click", () => reset(timers[b.dataset.reset])));
  document.querySelectorAll("[data-adj]").forEach(b => b.addEventListener("click", () => {
    const t = timers[b.dataset.adj]; if (t.state !== "idle") return;
    t.total = Math.min(1200, Math.max(60, t.total + +b.dataset.delta)); t.left = t.total; render(t);
  }));

  function toggle(t) {
    unlock();
    if (t.state === "running") { t.left = (t.end - Date.now()) / 1000; t.state = "paused"; }
    else if (t.state === "done") { reset(t); return; }
    else { t.end = Date.now() + t.left * 1000; t.state = "running"; wakeOnTimer(); }
    render(t); tray();
  }
  function reset(t) {
    t.state = "idle"; t.left = t.total; t.cued = false;
    if (t.note) { t.note.classList.remove("cue-live"); t.note.textContent = t.noteDefault; }
    render(t); tray();
  }
  function render(t) {
    const b = t.btn; b.dataset.state = t.state;
    const time = fmt(t.left);
    const lbl = t.state === "idle" ? "Start" : t.state === "running" ? "Pause" : t.state === "paused" ? "Resume" : "Done";
    b.innerHTML = '<span class="lbl">' + lbl + "</span><span>" + (t.state === "done" ? "0:00" : time) + "</span>";
    b.setAttribute("aria-label", t.label + " timer, " + lbl + ", " + time);
  }
  function tray() {
    const active = Object.values(timers).filter(t => t.state !== "idle");
    const el = document.getElementById("tray-inner");
    el.innerHTML = "";
    active.forEach(t => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.dataset.state = t.state;
      c.innerHTML = "<span>" + t.label + "</span>" + (t.state === "done" ? "done" : fmt(t.left));
      c.addEventListener("click", () => toggle(t));
      el.appendChild(c);
    });
    document.getElementById("tray").hidden = active.length === 0;
  }
  setInterval(() => {
    let changed = false;
    Object.values(timers).forEach(t => {
      if (t.state !== "running") return;
      t.left = (t.end - Date.now()) / 1000;
      if (t.cue !== null && !t.cued && t.left <= t.cue && t.left > 0) {
        t.cued = true;
        ring("cue", t.cueText, t.label + " · " + fmt(t.left) + " left");
        if (t.note) { t.note.textContent = t.cueText; t.note.classList.add("cue-live"); }
      }
      if (t.left <= 0) { t.left = 0; t.state = "done"; ring("done", t.label + " — time's up", "Tap to stop the alarm"); }
      render(t); changed = true;
    });
    if (changed) tray();
  }, 250);

  // ---------- keep screen on ----------
  const wake = document.getElementById("wake"), msg = document.getElementById("wake-msg");
  let lock = null;
  async function lockOn() {
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
      msg.hidden = true;
    } catch (e) {
      lock = null; wake.checked = false;
      msg.textContent = "This browser won't keep the screen on — keep it awake yourself so the alarm can ring.";
      msg.hidden = false;
    }
  }
  function wakeOnTimer() { if (!wake.checked && "wakeLock" in navigator) { wake.checked = true; lockOn(); } }
  wake.addEventListener("change", () => {
    if (wake.checked) lockOn(); else { try { lock && lock.release(); } catch (e) {} lock = null; }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wake.checked && !lock) lockOn(); });
})();
