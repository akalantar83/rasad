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

export const store = { meta: null, state: null, topics: {}, listeners: {} };
export function on(type, fn) { (store.listeners[type] ||= new Set()).add(fn); return () => store.listeners[type].delete(fn); }
export function emit(type, ev) { (store.listeners[type] || []).forEach((f) => { try { f(ev); } catch (e) { console.error(e); } }); (store.listeners["*"] || []).forEach((f) => f(ev)); }

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const tok = localStorage.getItem("rasad_admin_token");
  if (tok) headers["X-Admin-Token"] = tok;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) {
    const t = prompt("توکن مدیریت لازم است (RASAD_ADMIN_TOKEN):");
    if (t) { localStorage.setItem("rasad_admin_token", t); return api(path, opts); }
  }
  if (!r.ok) { let d = ""; try { d = (await r.json()).detail; } catch {} throw new Error(d ? String(d) : `${r.status} ${path}`); }
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
