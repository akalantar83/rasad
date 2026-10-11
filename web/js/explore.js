// Explore: advanced full-text search with facets, time histogram, pagination and CSV export.
import { $, $$, esc, fa, ago, hhmm, dt, api, store, makeChart, chartTheme, baseTooltip, LANG, catChip } from "./core.js";

const LANG_FA = { fa: "فارسی", ar: "عربی", en: "انگلیسی", other: "سایر" };
export async function renderExplore({ view, side, params }) {
  const st = { q: params[0] || "", hours: 168, lang: new Set(), category: new Set(), source: new Set(), sort: "relevance", page: 1, size: 25 };
  view.innerHTML = `<div class="page-h"><div><h1>کاوش و جست‌وجوی پیشرفته</h1><div class="muted small">جست‌وجوی تمام‌متن چندزبانه (FTS5 · رتبه‌بندی BM25) روی عنوان، لید، متن کامل و عنوان فارسی</div></div></div>
   <form class="xsearch card" id="xF"><span class="xs-ic">⌕</span><input type="text" id="xQ" placeholder="مثلاً: هرمز نفتکش، sanctions Iran، «تنگه هرمز»…" value="${esc(st.q)}" autocomplete="off">
    <select id="xH"><option value="24">۲۴ ساعت</option><option value="72">۳ روز</option><option value="168" selected>۷ روز</option><option value="720">۳۰ روز</option><option value="8760">یک سال</option></select>
    <select id="xS"><option value="relevance">مرتبط‌ترین</option><option value="new">جدیدترین</option></select>
    <button class="btn primary" type="submit">جست‌وجو</button><a class="btn" id="xCsv" download>⇩ CSV</a></form>
   <div class="card" style="margin-top:var(--gap);padding:10px 14px"><div class="chart" id="xHist" style="height:110px"></div></div>
   <div class="xmeta small muted" id="xMeta"></div><div class="card flush"><div class="list" id="xRes"></div></div><div class="pager" id="xPg"></div>`;
  const chart = makeChart($("#xHist"));
  const qs = () => { const p = { q: st.q, hours: st.hours, sort: st.sort, page: st.page, size: st.size }; for (const k of ["lang", "category", "source"]) if (st[k].size) p[k] = [...st[k]].join(","); return new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "")).toString(); };
  const hl = (s) => { let h = esc(s || ""); const terms = st.q.replace(/["«»]/g, "").split(/\s+/).filter((t) => t.length > 1); for (const t of terms) h = h.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`); return h; };
  async function load() {
    $("#xRes").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    let r;
    try { r = await api("/api/explore?" + qs()); } catch (e) { $("#xRes").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    $("#xCsv").href = "/api/explore.csv?" + qs();
    $("#xMeta").innerHTML = `${fa(r.total)} نتیجه${st.q ? ` برای «${esc(st.q)}»` : ""} · صفحه ${fa(r.page)} از ${fa(Math.max(1, r.pages))}`;
    $("#xRes").innerHTML = r.items.map((a) => `<div class="row xr" data-sid="${a.story_id || ""}"><span class="bar" style="background:${store.topics[a.category]?.color || "var(--line2)"}"></span><div style="flex:1;min-width:0">
      <div class="t">${hl(a.title_fa || a.title)}</div>${a.title_fa && a.title_fa !== a.title ? `<div class="small dim" dir="auto">${hl(a.title)}</div>` : ""}
      <div class="xsnip small" dir="auto">${a.snip ? hl(a.snip.replace(/[«»]/g, "")) : hl(a.lead)}</div>
      <div class="m"><span>${esc(a.source_name)}</span><span class="tag lang">${LANG[a.lang] || a.lang}</span>${catChip(a.category)}${a.urgency === "flash" ? '<span class="tag critical">فوری</span>' : ""}<time>${dt(a.published_at)}</time><a href="${esc(a.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">منبع اصلی ↗</a></div></div></div>`).join("") || '<div class="empty">نتیجه‌ای یافت نشد. فیلترها را کم کنید یا بازه را بزرگ‌تر کنید.</div>';
    const pages = r.pages, p = r.page, btn = (n, l = fa(n)) => `<button class="btn sm ${n === p ? "primary" : "ghost"}" data-p="${n}">${l}</button>`;
    const nums = [...new Set([1, p - 2, p - 1, p, p + 1, p + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    $("#xPg").innerHTML = pages > 1 ? (p > 1 ? btn(p - 1, "‹ قبلی") : "") + nums.map((n, i) => (i && n - nums[i - 1] > 1 ? '<span class="dim">…</span>' : "") + btn(n)).join("") + (p < pages ? btn(p + 1, "بعدی ›") : "") : "";
    const T = chartTheme();
    chart.setOption({ grid: { left: 30, right: 10, top: 8, bottom: 20 }, tooltip: { trigger: "axis", ...baseTooltip() },
      xAxis: { type: "time", axisLine: { lineStyle: { color: T.line2 } }, axisLabel: { color: T.muted, fontFamily: "Inter" }, splitLine: { show: false } },
      yAxis: { type: "value", axisLabel: { color: T.muted, fontFamily: "Inter" }, splitLine: { lineStyle: { color: T.line } } },
      series: [{ type: "bar", name: "تعداد", data: r.histogram.map((h) => [h.t * 1000, h.n]), itemStyle: { color: T.accent, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 }] }, true);
    const fac = (k, title, lab) => `<div class="h-sec">${title}</div><div class="facet">${(r.facets[k] || []).map((x) => `<label class="fi ${st[k].has(x.k) ? "on" : ""}"><input type="checkbox" data-f="${k}" value="${esc(x.k)}" ${st[k].has(x.k) ? "checked" : ""}><span>${esc(lab(x))}</span><b class="num">${fa(x.n)}</b></label>`).join("") || '<div class="small dim">—</div>'}</div>`;
    side.innerHTML = `<div class="side-h"><h2>فیلترها</h2>${["lang", "category", "source"].some((k) => st[k].size) ? '<button class="btn ghost sm" id="xClr">پاک کردن</button>' : ""}</div>
      ${fac("lang", "زبان", (x) => LANG_FA[x.k] || x.k)}${fac("category", "موضوع", (x) => store.topics[x.k]?.fa || x.k || "—")}${fac("source", "منبع", (x) => x.label || x.k)}
      <div class="h-sec">نحو جست‌وجو</div><div class="small muted" style="line-height:1.9">همه واژه‌ها باید وجود داشته باشند (AND) · نویسه‌های فارسی و عربی نرمال‌سازی می‌شوند (ي/ی، ك/ک) · نتایج تکراری حذف شده‌اند</div>`;
    side.querySelectorAll("[data-f]").forEach((c) => (c.onchange = () => { const s = st[c.dataset.f]; c.checked ? s.add(c.value) : s.delete(c.value); st.page = 1; load(); }));
    $("#xClr") && ($("#xClr").onclick = () => { ["lang", "category", "source"].forEach((k) => st[k].clear()); st.page = 1; load(); });
  }
  $("#xF").onsubmit = (e) => { e.preventDefault(); st.q = $("#xQ").value.trim(); st.page = 1; history.replaceState(null, "", "#/explore" + (st.q ? "/" + encodeURIComponent(st.q) : "")); load(); };
  $("#xH").onchange = (e) => { st.hours = +e.target.value; st.page = 1; load(); };
  $("#xS").onchange = (e) => { st.sort = e.target.value; load(); };
  $("#xPg").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { st.page = +b.dataset.p; load(); view.scrollTop = 0; } };
  $("#xRes").onclick = (e) => { const r = e.target.closest("[data-sid]"); if (r?.dataset.sid) location.hash = "#/stories/" + r.dataset.sid; };
  await load();
  setTimeout(() => $("#xQ").focus(), 50);
}
