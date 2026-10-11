// Core: API client, live events (SSE), toasts, formatting helpers, shared store.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const faNum = new Intl.NumberFormat("fa-IR");
export const fa = (n) => (n == null || isNaN(n) ? "—" : faNum.format(n));
export const pct = (x) => (x == null ? "—" : fa(Math.round(x * 100)) + "٪");
export const ago = (t) => {
  if (!t) return "—";
  const s = Date.now() / 1000 - t;
  if (s < 60) return "لحظاتی پیش";
  if (s < 3600) return fa(Math.round(s / 60)) + " دقیقه پیش";
  if (s < 86400) return fa(Math.round(s / 3600)) + " ساعت پیش";
  return fa(Math.round(s / 86400)) + " روز پیش";
};
export const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
export const dt = (t) => new Date(t * 1000).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
export const LANG = { fa: "FA", ar: "AR", en: "EN", other: "··" };
export const VER = { documented_fact: "واقعیت مستند", inference: "استنباط", assumption: "فرض" };
export const CONF = { high: "بالا", medium: "متوسط", low: "پایین" };
export const STATUS_FA = { queued: "در صف", running: "در حال اجرا", succeeded: "موفق", failed: "خطا", awaiting_approval: "منتظر تأیید",
  skipped: "پرش/ردشده", rejected: "رد شد", paused: "متوقف", idle: "آماده", awaiting: "منتظر تأیید", killed: "توقف اضطراری", partial: "ناقص", aborted: "لغو", interrupted: "قطع" };
export const MODE_FA = { manual: "دستی", supervised: "نظارتی", autopilot: "خودکار کامل" };

export const store = { meta: null, state: null, topics: {}, listeners: {}, user: null, auth: null };
export function on(type, fn) { (store.listeners[type] ||= new Set()).add(fn); return () => store.listeners[type].delete(fn); }
export function emit(type, ev) { (store.listeners[type] || []).forEach((f) => { try { f(ev); } catch (e) { console.error(e); } }); (store.listeners["*"] || []).forEach((f) => f(ev)); }

export const ROLE_RANK = { viewer: 0, analyst: 1, admin: 2 };
export const can = (role) => !store.auth?.auth_enabled || (store.user && ROLE_RANK[store.user.role] >= ROLE_RANK[role]);

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const tok = localStorage.getItem("rasad_admin_token");
  if (tok) headers["X-Admin-Token"] = tok;
  const r = await fetch(path, { credentials: "same-origin", ...opts, headers: { ...headers, ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401 && !path.startsWith("/api/auth/")) { emit("auth_required", { path }); throw new Error("نشست شما منقضی شده است؛ دوباره وارد شوید"); }
  if (!r.ok) { let d = ""; try { d = (await r.json()).detail; } catch {} throw new Error(d ? (typeof d === "string" ? d : JSON.stringify(d)) : `${r.status} ${path}`); }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
export const post = (path, body = {}) => api(path, { method: "POST", body });

export function connectEvents() {
  let es, retry = 1000;
  const open = () => {
    es = new EventSource("/api/events");
    es.onmessage = (m) => { retry = 1000; const ev = JSON.parse(m.data); if (ev.type === "state") store.state = ev.state; emit(ev.type, ev); };
    es.onerror = () => { es.close(); setTimeout(open, retry); retry = Math.min(retry * 2, 15000); emit("conn", { ok: false }); };
    es.onopen = () => emit("conn", { ok: true });
  };
  open();
}

export function toast(msg, level = "info") {
  const c = { info: "var(--c-blue)", success: "var(--c-green)", warn: "var(--c-amber)", error: "var(--c-coral)" }[level] || "var(--c-blue)";
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="dot" style="background:${c};margin-top:6px"></span><div>${esc(msg)}</div>`;
  $("#toasts").prepend(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 4500);
}

export function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
export function chartTheme() {
  return { text: cssVar("--text"), muted: cssVar("--muted"), line: cssVar("--line"), line2: cssVar("--line2"), panel: cssVar("--panel-solid"), accent: cssVar("--accent") };
}
const charts = new Set();
export function makeChart(el) {
  const c = echarts.init(el, null, { renderer: "canvas" });
  charts.add(c);
  return c;
}
export function disposeCharts() { charts.forEach((c) => c.dispose()); charts.clear(); }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
export function baseTooltip() {
  const t = chartTheme();
  return { backgroundColor: t.panel, borderColor: t.line2, textStyle: { color: t.text, fontFamily: "Vazirmatn, Inter" } };
}
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export function catChip(cat) {
  const t = store.topics[cat];
  return t ? `<span class="chip"><span class="sw" style="background:${t.color}"></span>${esc(t.fa)}</span>` : "";
}
export function verTag(v) {
  if (!v || !v.label) return "";
  return `<span class="tag ${v.label}" title="${fa(v.independent_sources)} منبع مستقل">${VER[v.label]} · ${CONF[v.confidence] || ""}</span>`;
}

// modal dialog helper: returns a promise resolved with the form values (or null on cancel)
export function modal({ title, body, submit = "ذخیره", danger = false, wide = false, onOpen }) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "modal-ov";
    ov.innerHTML = `<form class="modal ${wide ? "wide" : ""}" novalidate><div class="modal-h"><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-x aria-label="بستن">✕</button></div>
      <div class="modal-b">${body}</div><div class="modal-f"><span class="err small" data-err></span><span class="tb-spacer"></span><button type="button" class="btn ghost" data-x>انصراف</button>${submit ? `<button class="btn ${danger ? "danger solid" : "primary"}" type="submit">${esc(submit)}</button>` : ""}</div></form>`;
    document.body.append(ov);
    const f = ov.querySelector("form");
    const close = (v) => { ov.classList.add("out"); setTimeout(() => ov.remove(), 160); document.removeEventListener("keydown", esc_); resolve(v); };
    const esc_ = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", esc_);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(null); });
    ov.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => close(null)));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const vals = {};
      f.querySelectorAll("[name]").forEach((el) => { vals[el.name] = el.type === "checkbox" ? el.checked : el.multiple ? [...el.selectedOptions].map((o) => o.value) : el.value; });
      if (f._validate) { const err = await f._validate(vals); if (err) { ov.querySelector("[data-err]").textContent = err; return; } }
      close(vals);
    };
    onOpen?.(f, (msg) => (ov.querySelector("[data-err]").textContent = msg || ""));
    setTimeout(() => f.querySelector("input:not([type=hidden]),select,textarea")?.focus(), 30);
  });
}
export const confirmDlg = (title, text, submit = "تأیید", danger = true) => modal({ title, body: `<p class="muted" style="margin:0;line-height:1.9">${text}</p>`, submit, danger }).then((v) => v !== null);
export const bytes = (n) => (n == null ? "—" : n < 1024 ? fa(n) + " B" : n < 1048576 ? fa(+(n / 1024).toFixed(1)) + " KB" : n < 1073741824 ? fa(+(n / 1048576).toFixed(1)) + " MB" : fa(+(n / 1073741824).toFixed(2)) + " GB");
window.addEventListener("unhandledrejection", (e) => { const m = e.reason?.message; if (m && !/AbortError|aborted/.test(m)) toast(m, "error"); });
