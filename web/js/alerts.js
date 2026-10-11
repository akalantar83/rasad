// Alert triage center + topbar notification bell.
import { $, $$, esc, fa, ago, dt, api, post, on, store, toast, can, catChip } from "./core.js";

const SEV = { critical: ["بحرانی", "var(--c-coral)"], warning: ["هشدار", "var(--c-amber)"], info: ["اطلاع", "var(--c-blue)"] };
const ST_CLS = { new: "st-new", pending: "st-new", approved: "st-ack", ack: "st-ack", investigating: "st-inv", resolved: "st-ok", dismissed: "st-off", rejected: "st-off" };
const ACT_FA = { status: "تغییر وضعیت", assign: "واگذاری", note: "یادداشت" };
const sevTag = (s) => `<span class="tag ${s === "critical" ? "critical" : s === "warning" ? "warning" : "inference"}">${SEV[s]?.[0] || s}</span>`;
const stPill = (g) => `<span class="st-pill ${ST_CLS[g.status] || ""}">${esc(g.status_fa || g.status)}</span>`;

// ---------- bell ----------
let bellT;
export function initBell() {
  const host = $("#bell"); if (!host) return;
  host.innerHTML = `<button class="icon-btn bell-btn" id="bellBtn" title="هشدارهای باز"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg><span class="bell-n" id="bellN"></span></button><div class="menu bell-menu" id="bellDrop"></div>`;
  const drop = $("#bellDrop");
  $("#bellBtn").onclick = (e) => { e.stopPropagation(); drop.classList.toggle("open"); if (drop.classList.contains("open")) refreshBell(true); };
  document.addEventListener("click", (e) => { if (!e.target.closest("#bell")) drop.classList.remove("open"); });
  const soon = () => { clearTimeout(bellT); bellT = setTimeout(() => refreshBell(false), 600); };
  on("data_changed", soon); on("alerts_changed", soon);
  setInterval(() => refreshBell(false), 60000);
  refreshBell(false);
}
async function refreshBell(full) {
  const r = await api("/api/alerts?hours=72&status=open").catch(() => null); if (!r) return;
  const crit = r.open_by_severity?.critical || 0, n = r.open || 0;
  const b = $("#bellN"); if (b) { b.textContent = n ? (n > 99 ? "۹۹+" : fa(n)) : ""; b.className = "bell-n" + (crit ? " crit" : n ? " on" : ""); }
  const drop = $("#bellDrop"); if (!drop || (!full && !drop.classList.contains("open"))) return;
  drop.innerHTML = `<div class="menu-h"><b>هشدارهای باز</b> <span class="small dim">${fa(n)} مورد · ${fa(crit)} بحرانی</span></div>
   ${r.items.slice(0, 8).map((g) => `<a class="bell-it" href="#/alerts/${g.id}"><span class="sev-dot ${g.severity}"></span><div style="min-width:0"><div class="t">${esc(g.label)}</div><div class="small dim">${esc(g.type_fa)} · ${ago(g.created)} · ${esc(g.status_fa)}</div></div></a>`).join("") || '<div class="empty small">هشدار بازی نیست ✓</div>'}
   <a class="bell-all" href="#/alerts">مرکز هشدارها ←</a>`;
}

// ---------- triage view ----------
export async function renderAlerts({ view, side, params }) {
  const f = { status: "open", severity: "", type: "", assignee: "", hours: 168, q: "", ...(store.alertFilter || {}) };
  let sel = +params[0] || null, data, people = [];
  const editable = can("analyst");
  view.innerHTML = `<div class="page-h"><div><h1>مرکز هشدارها</h1><div class="muted small">چرخه رسیدگی: جدید ← دیده‌شده ← در حال بررسی ← حل‌شده / کاذب · واگذاری، یادداشت و تاریخچه کامل</div></div></div>
   <div class="kpi-strip" id="aK"></div>
   <div class="card flush"><div class="card-h filters">
     <div class="seg" id="aSt">${[["open", "باز"], ["new", "جدید"], ["investigating", "در حال بررسی"], ["resolved", "حل‌شده"], ["dismissed", "کاذب"], ["", "همه"]].map(([k, v]) => `<button data-s="${k}" class="${f.status === k ? "on" : ""}">${v}<b data-c="${k}"></b></button>`).join("")}</div>
     <select id="aSev"><option value="">همه شدت‌ها</option><option value="critical">بحرانی</option><option value="warning">هشدار</option><option value="info">اطلاع</option></select>
     <select id="aType"><option value="">همه انواع</option><option value="volume_spike">جهش حجم موضوع</option><option value="entity_spike">جهش اشاره به بازیگر</option><option value="new_actor">بازیگر نوظهور</option><option value="fast_spread">گسترش سریع</option><option value="watch">فهرست پایش</option></select>
     <select id="aAs"><option value="">همه مسئولان</option><option value="me">واگذارشده به من</option></select>
     <select id="aH"><option value="24">۲۴ ساعت</option><option value="72">۳ روز</option><option value="168">۷ روز</option><option value="720">۳۰ روز</option></select>
     <input type="text" id="aQ" placeholder="جست‌وجو در عنوان…" style="width:170px">
     <span class="tb-spacer"></span>
     ${editable ? `<span class="bulk" id="aBulk" hidden><span class="small" id="aSelN"></span><button class="btn sm" data-b="ack">دیده شد</button><button class="btn sm" data-b="resolved">حل شد</button><button class="btn sm ghost" data-b="dismissed">کاذب</button></span>` : ""}
   </div><div id="aList" class="alist"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>`;
  $("#aSev").value = f.severity; $("#aType").value = f.type; $("#aAs").value = f.assignee; $("#aH").value = String(f.hours); $("#aQ").value = f.q;
  const checked = new Set();
  async function load() {
    store.alertFilter = f;
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v != null)).toString();
    data = await api("/api/alerts?" + qs);
    const c = data.counts || {};
    $$("#aSt b[data-c]").forEach((b) => { const k = b.dataset.c; const n = k === "open" ? data.open : k === "" ? Object.values(c).reduce((a, x) => a + x, 0) : (c[k] || 0); b.textContent = n ? fa(n) : ""; });
    const os = data.open_by_severity || {};
    $("#aK").innerHTML = `<div class="ks"><span class="num">${fa(data.open)}</span><small>باز</small></div><div class="ks crit"><span class="num">${fa(os.critical || 0)}</span><small>بحرانی باز</small></div><div class="ks warn"><span class="num">${fa(os.warning || 0)}</span><small>هشدار باز</small></div><div class="ks"><span class="num">${fa(c.investigating || 0)}</span><small>در حال بررسی</small></div><div class="ks ok"><span class="num">${fa(c.resolved || 0)}</span><small>حل‌شده</small></div>`;
    $("#aList").innerHTML = data.items.map((g) => `<div class="arow ${g.id === sel ? "sel" : ""} ${g.open ? "" : "closed"}" data-g="${g.id}">${editable ? `<input type="checkbox" data-chk="${g.id}" ${checked.has(g.id) ? "checked" : ""}>` : ""}
      <span class="sevbar" style="background:${SEV[g.severity]?.[1] || "var(--line2)"}"></span>
      <div class="a-main"><div class="t">${esc(g.label)}</div><div class="m">${sevTag(g.severity)}<span class="chip">${esc(g.type_fa)}</span>${stPill(g)}${g.assignee ? `<span class="chip">👤 ${esc(g.assignee)}</span>` : ""}<span class="num small dim">امتیاز ${fa(+(g.score || 0).toFixed(1))} · پایه ${fa(+(g.baseline || 0).toFixed(1))}</span></div></div>
      <div class="a-time small dim"><time>${ago(g.created)}</time></div></div>`).join("") || '<div class="empty">هشداری با این فیلترها نیست.</div>';
    if (sel) detail(sel); else side.innerHTML = `<h2>مرکز هشدارها</h2><p class="small muted" style="line-height:1.9">یک هشدار را انتخاب کنید تا شواهد، توضیح آماری، داستان‌های مرتبط و تاریخچه رسیدگی را ببینید.</p><div class="h-sec">میان‌برها</div><div class="small muted">J / K: هشدار بعدی/قبلی · A: دیده شد · R: حل شد · D: کاذب</div>`;
  }
  async function detail(id) {
    sel = id; $$(".arow").forEach((r) => r.classList.toggle("sel", +r.dataset.g === id));
    if (location.hash !== "#/alerts/" + id) history.replaceState(null, "", "#/alerts/" + id);
    const g = await api("/api/alerts/" + id).catch(() => null); if (!g || sel !== id) return;
    if (editable && !people.length) people = await api("/api/people").catch(() => []);
    const ex = g.explanation || {};
    side.innerHTML = `<div class="side-h"><span class="sev-dot ${g.severity}"></span><h2>${esc(g.label)}</h2></div>
     <div class="chips" style="margin:6px 0 10px">${sevTag(g.severity)}<span class="chip">${esc(g.type_fa)}</span>${stPill(g)}<span class="chip">${dt(g.created)}</span></div>
     <div class="mini-kpis"><div><b>${fa(+(g.score || 0).toFixed(1))}</b><span>امتیاز</span></div><div><b>${fa(+(g.observed || 0).toFixed(0))}</b><span>مشاهده</span></div><div><b>${fa(+(g.baseline || 0).toFixed(1))}</b><span>پایه</span></div><div><b>${esc(g.window || "—")}</b><span>پنجره</span></div></div>
     ${ex.text ? `<div class="explain small">${ex.by === "llm" ? '<span class="ai-badge">✦ تحلیل مدل</span> ' : ""}<span class="tag ${ex.kind === "fact" ? "documented_fact" : "inference"}">${ex.kind === "fact" ? "واقعیت مستند" : "استنباط"}</span> ${esc(ex.text)}${ex.confidence ? ` <span class="dim">· اطمینان ${{ high: "بالا", medium: "متوسط", low: "پایین" }[ex.confidence] || esc(ex.confidence)}</span>` : ""}</div>` : ""}
     ${(ex.alternatives || []).length ? `<div class="h-sec">فرضیه‌های جایگزین</div>${ex.alternatives.map((a) => `<div class="alt small">• ${esc(a)}</div>`).join("")}` : ""}
     ${editable ? `<div class="h-sec">رسیدگی</div><div class="triage">
       <div class="seg wrap" id="tSt">${[["ack", "دیده شد"], ["investigating", "در حال بررسی"], ["resolved", "حل شد"], ["dismissed", "کاذب/نادیده"], ["new", "بازگشایی"]].map(([k, v]) => `<button data-s="${k}" class="${g.status === k ? "on" : ""}">${v}</button>`).join("")}</div>
       <label class="small muted">مسئول<select id="tAs"><option value="">— بدون مسئول —</option>${people.map((p) => `<option value="${esc(p.username)}" ${g.assignee === p.username ? "selected" : ""}>${esc(p.name)} (@${esc(p.username)})</option>`).join("")}</select></label>
       <textarea id="tNote" rows="3" placeholder="یادداشت تحلیلگر (اختیاری)…" style="min-height:70px;font:13px/1.8 Vazirmatn"></textarea>
       <button class="btn primary sm" id="tSave">ثبت یادداشت / مسئول</button></div>` : ""}
     <div class="h-sec">داستان‌های مرتبط (${fa(g.stories.length)})</div><div class="list">${g.stories.map((s) => `<div class="row" onclick="location.hash='#/stories/${s.id}'"><div style="min-width:0"><div class="t">${esc(s.title_fa || s.title)}</div><div class="m">${catChip(s.category)}<span class="num">${fa(s.source_count)} منبع</span><span class="dim">${ago(s.last_update)}</span></div></div></div>`).join("") || '<div class="empty small">—</div>'}</div>
     <div class="h-sec">تاریخچه</div><div class="timeline">${g.events.map((e) => `<div class="te"><i></i><div><b>${esc(e.actor)}</b> · ${ACT_FA[e.action] || e.action}${e.status ? `: ${esc(data.statuses?.[e.status] || e.status)}` : ""}<div class="small dim">${ago(e.ts)}</div>${e.note ? `<div class="te-note">${esc(e.note)}</div>` : ""}</div></div>`).join("") || '<div class="small dim">هنوز اقدامی ثبت نشده است.</div>'}</div>`;
    if (!editable) return;
    $$("#tSt button", side).forEach((b) => (b.onclick = () => act(id, { status: b.dataset.s, note: $("#tNote").value })));
    $("#tSave").onclick = () => act(id, { assignee: $("#tAs").value, note: $("#tNote").value });
  }
  async function act(id, body) {
    if (!body.note) delete body.note;
    try { await post("/api/alerts/" + id, body); toast("ثبت شد", "success"); await load(); } catch (e) { toast(e.message, "error"); }
  }
  const upd = () => { const b = $("#aBulk"); if (b) { b.hidden = !checked.size; $("#aSelN").textContent = fa(checked.size) + " انتخاب‌شده"; } };
  $("#aList").onclick = (e) => {
    const ck = e.target.closest("[data-chk]");
    if (ck) { const id = +ck.dataset.chk; ck.checked ? checked.add(id) : checked.delete(id); upd(); return; }
    const r = e.target.closest("[data-g]"); if (r) detail(+r.dataset.g);
  };
  $("#aBulk")?.addEventListener("click", async (e) => { const s = e.target.dataset.b; if (!s) return; const r = await post("/api/alerts/bulk", { ids: [...checked], status: s }); toast(`${fa(r.updated)} هشدار به‌روز شد`, "success"); checked.clear(); upd(); load(); });
  $("#aSt").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; f.status = b.dataset.s; $$("#aSt button").forEach((x) => x.classList.toggle("on", x === b)); load(); };
  $("#aSev").onchange = (e) => { f.severity = e.target.value; load(); };
  $("#aType").onchange = (e) => { f.type = e.target.value; load(); };
  $("#aAs").onchange = (e) => { f.assignee = e.target.value; load(); };
  $("#aH").onchange = (e) => { f.hours = +e.target.value; load(); };
  let qt; $("#aQ").oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 250); };
  const key = (e) => {
    if (e.target.closest("input,textarea,select") || !data?.items.length) return;
    const i = data.items.findIndex((x) => x.id === sel);
    if (e.key === "j" || e.key === "k") { const n = data.items[Math.max(0, Math.min(data.items.length - 1, i + (e.key === "j" ? 1 : -1)))]; if (n) detail(n.id); }
    if (editable && sel && { a: "ack", r: "resolved", d: "dismissed" }[e.key]) act(sel, { status: { a: "ack", r: "resolved", d: "dismissed" }[e.key] });
  };
  document.addEventListener("keydown", key);
  const off = on("alerts_changed", () => load());
  await load();
  return () => { document.removeEventListener("keydown", key); off(); };
}
