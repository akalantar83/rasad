import { storyAiCard, bindStoryAi, richText } from "./ai.js";
import { $, $$, esc, fa, pct, ago, hhmm, dt, api, post, store, toast, makeChart, chartTheme, baseTooltip, LANG, VER, CONF, STATUS_FA, catChip, verTag, reducedMotion } from "./core.js";

const T = () => chartTheme();
const axisCommon = () => ({ axisLine: { lineStyle: { color: T().line2 } }, axisLabel: { color: T().muted, fontFamily: "Inter, Vazirmatn" }, splitLine: { lineStyle: { color: T().line } } });
const topicColor = (k) => store.topics[k]?.color || "#888";
const topicFa = (k) => store.topics[k]?.fa || k;

function storyRow(s, sel) {
  return `<div class="row ${sel ? "sel" : ""}" data-sid="${s.id}"><span class="bar" style="background:${s.color}"></span><div style="flex:1;min-width:0">
  <div class="t">${esc(s.title_fa || s.title)}</div><div class="m">${catChip(s.category)}<span class="num">${fa(s.source_count)} منبع</span><span>${fa(s.lang_count)} زبان</span>
  ${verTag(s.verification)}${s.urgency === "flash" ? '<span class="tag critical">فوری</span>' : s.urgency === "high" ? '<span class="tag warning">مهم</span>' : ""}<span class="dim">${ago(s.last_update)}</span></div></div></div>`;
}

// ============ 1) Command Center ============
export async function renderCommand({ view, side }) {
  const [st, stories, sigs] = await Promise.all([api("/api/stats?hours=24"), api("/api/stories?limit=12&hours=24"), api("/api/signals?hours=24")]);
  const qa = st.qa?.metrics || {};
  const meta = store.meta;
  view.innerHTML = `
  <div class="grid kpis">
    <div class="card kpi"><div class="l">خبر یکتا · ۲۴ ساعت</div><div class="v">${fa(st.unique)}</div><div class="d">${fa(st.per_hour_last)} خبر در ساعت گذشته · ${fa(st.sources)} منبع</div></div>
    <div class="card kpi"><div class="l">داستان فعال</div><div class="v">${fa(st.stories)}</div><div class="d">خوشه‌بندی چندزبانه</div></div>
    <div class="card kpi"><div class="l">سیگنال / بحرانی</div><div class="v">${fa(st.signals)} <span style="color:var(--c-coral);font-size:18px">/ ${fa(st.critical)}</span></div><div class="d">جهش حجم، بازیگر نوظهور، گسترش سریع</div></div>
    <div class="card kpi"><div class="l">تازگی (p50)</div><div class="v">${qa.freshness_p50_min != null ? fa(qa.freshness_p50_min) : "—"}<span style="font-size:13px"> دقیقه</span></div><div class="d">از انتشار تا دریافت · تکرار ${pct(qa.duplicate_rate)}</div></div>
    <div class="card kpi"><div class="l">مدل زبانی</div><div class="v" style="font-size:18px;margin-top:6px">${meta.llm.configured ? esc(meta.llm.model) : "غیرفعال"}</div><div class="d">${meta.llm.configured ? fa(meta.llm.tokens_today) + " توکن امروز" : "پردازش کامل بدون LLM؛ برای ترجمه LLM_BASE_URL را تنظیم کنید"}</div></div>
  </div>
  <div class="grid" style="grid-template-columns:2fr 1fr;margin-top:var(--gap)">
    <div class="card"><h3>حجم خبر در ساعت <span class="r small">۲۴ ساعت اخیر</span></h3><div class="chart" id="cHourly"></div></div>
    <div class="card"><h3>ترکیب موضوعی</h3><div class="chart" id="cCats"></div></div>
  </div>
  <div class="grid" style="grid-template-columns:1.3fr 1fr;margin-top:var(--gap)">
    <div class="card" style="padding:0"><h3 style="padding:14px 14px 0">داستان‌های برتر <span class="r"><a href="#/stories">همه ←</a></span></h3><div class="list" id="topStories">${stories.map((s) => storyRow(s)).join("") || '<div class="empty">هنوز داستانی نیست — یک اجرا را شروع کنید.</div>'}</div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>وضعیت عامل‌ها <span class="r"><a href="#/pipeline">خط لوله ←</a></span></h3><div id="agentGrid" class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:6px"></div></div>
      <div class="card" style="padding:0"><h3 style="padding:14px 14px 0">هشدارها</h3><div class="list">${sigs.slice(0, 6).map((g) => `<div class="row"><span class="bar" style="background:${g.severity === "critical" ? "var(--c-coral)" : "var(--c-amber)"}"></span><div><div class="t" style="font-weight:500">${esc(g.label)}</div><div class="m"><span class="tag ${g.severity}">${g.severity === "critical" ? "بحرانی" : "هشدار"}</span><span>${esc(g.status)}</span><span>${ago(g.created)}</span></div></div></div>`).join("") || '<div class="empty small">سیگنالی ثبت نشده (در شروع سرد، تشخیص جهش پس از ۱۲ ساعت فعال می‌شود).</div>'}</div></div>
    </div>
  </div>`;
  const pipe = store.state?.pipeline || [];
  $("#agentGrid").innerHTML = pipe.map((p) => { const a = st.agents_last[p.name]; return `<div class="row" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px" title="${esc(a?.output_summary || "")}"><span class="dot ${a?.status || ""}" style="margin-top:7px"></span><div style="min-width:0"><div style="font-size:12.5px;font-weight:600">${esc(p.title_fa)}</div><div class="small dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a ? ago(a.ended) : "اجرا نشده"}</div></div></div>`; }).join("");
  const h = makeChart($("#cHourly"));
  h.setOption({ grid: { left: 36, right: 12, top: 10, bottom: 24 }, tooltip: { trigger: "axis", ...baseTooltip() },
    xAxis: { type: "category", data: st.hourly.map((x) => hhmm(x.t)), ...axisCommon() }, yAxis: { type: "value", ...axisCommon() },
    series: [{ type: "bar", data: st.hourly.map((x) => x.n), itemStyle: { color: T().accent, borderRadius: [4, 4, 0, 0] }, animationDuration: reducedMotion() ? 0 : 700 }] });
  const c = makeChart($("#cCats"));
  const cats = Object.entries(st.categories).sort((a, b) => b[1] - a[1]);
  c.setOption({ tooltip: { ...baseTooltip() }, series: [{ type: "pie", radius: ["52%", "78%"], itemStyle: { borderColor: T().panel, borderWidth: 2 },
    label: { color: T().muted, fontFamily: "Vazirmatn", formatter: "{b}" }, data: cats.map(([k, v]) => ({ name: topicFa(k), value: v, itemStyle: { color: topicColor(k) } })) }] });
  $("#topStories").addEventListener("click", (e) => { const r = e.target.closest("[data-sid]"); if (r) location.hash = "#/stories/" + r.dataset.sid; });
  side.innerHTML = `<h2>خلاصه وضعیت</h2><p class="muted small">زبان‌های ورودی ۲۴ ساعت اخیر</p>
   <div class="kv">${Object.entries(st.languages).map(([k, v]) => `<dt><span class="tag lang">${LANG[k] || k}</span></dt><dd class="num">${fa(v)}</dd>`).join("")}</div>
   <div class="h-sec">شاخص‌های کیفیت (ارزیاب)</div>
   <div class="kv"><dt>پوشش طبقه‌بندی</dt><dd>${pct(qa.classification_coverage)}</dd><dt>پوشش موجودیت</dt><dd>${pct(qa.entity_coverage)}</dd><dt>کیفیت استخراج</dt><dd>${pct(qa.extraction_quality)}</dd><dt>سلامت منابع</dt><dd>${pct(qa.source_health)}</dd><dt>پوشش ارجاع بریف</dt><dd>${pct(qa.citation_coverage)}</dd></div>
   ${qa.judge ? `<div class="h-sec">✦ داوری مدل بر بریف #${fa(qa.judge.brief_id)} · وفاداری ${pct(qa.judge.faithfulness)}</div>${(qa.judge.flagged || []).map((f) => `<div class="small" style="margin-bottom:8px;padding:6px 8px;border-inline-start:3px solid var(--c-amber);background:var(--panel2)"><div class="dim">${esc((f.sentence || "").slice(0, 160))}…</div>${esc(f.reason)}</div>`).join("")}${qa.judge.notes_fa ? `<div class="small muted">${esc(qa.judge.notes_fa)}</div>` : ""}` : ""}
   <div class="h-sec">بازخورد ارزیاب</div><div class="small">${(st.qa?.issues || []).map((i) => `<div style="margin-bottom:6px">• ${esc(i)}</div>`).join("") || '<span class="dim">موردی نیست.</span>'}</div>
   <div class="h-sec">میان‌بر</div><div class="small muted">Ctrl+K: پالت فرمان · ▶: حالت نمایش روایی</div>`;
}

// ============ 2) Globe / Map ============
let globeLib;
export function loadGlobeLib() {
  if (window.Globe) return Promise.resolve();
  return (globeLib ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/globe.gl.min.js"; s.onload = res; s.onerror = rej; document.head.append(s); }));
}
let worldReg;
async function ensureWorld() { if (!worldReg) { const w = await api("/static/vendor/world.json"); echarts.registerMap("world", w); worldReg = true; } }

export async function renderMap({ view, side, params }) {
  let mode = params[0] === "flat" ? "flat" : "globe", hours = 48, g = null, data;
  view.style.padding = 0;
  view.innerHTML = `<div id="mapStage" style="position:absolute;inset:0"></div>
   <div class="float" style="top:10px;right:10px;display:flex;gap:8px;align-items:center">
     <div class="seg" id="mMode"><button data-m="globe">کره سه‌بعدی</button><button data-m="flat">نقشه تخت</button></div>
     <select id="mHours"><option value="6">۶ ساعت</option><option value="24">۲۴ ساعت</option><option value="48" selected>۴۸ ساعت</option><option value="168">۷ روز</option></select>
   </div>
   <div class="float small" style="bottom:12px;right:10px;max-width:420px" id="mLegend"></div>`;
  const stage = $("#mapStage");
  const legend = () => ($("#mLegend").innerHTML = `<b>راهنما</b> · اندازه = حجم اشاره · رنگ = موضوع غالب · کمان = هم‌آیی دو کشور در خبرها<br>${Object.entries(store.topics).map(([k, t]) => `<span class="chip" style="margin:3px 0 0 3px"><span class="sw" style="background:${t.color}"></span>${t.fa}</span>`).join("")}`);
  async function draw() {
    data = await api(`/api/geo?hours=${hours}`);
    $$("#mMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    if (g) { g._destructor?.(); g = null; }
    stage.innerHTML = "";
    const max = Math.max(1, ...data.points.map((p) => p.n));
    if (mode === "globe") {
      await loadGlobeLib();
      g = Globe()(stage).globeImageUrl("/static/vendor/earth-night.jpg").bumpImageUrl("/static/vendor/earth-topology.png")
        .backgroundColor(getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()).atmosphereColor("#5E9FE8").atmosphereAltitude(0.16)
        .width(stage.clientWidth).height(stage.clientHeight)
        .pointsData(data.points).pointLat("lat").pointLng("lon").pointColor("color").pointAltitude((d) => 0.01 + 0.25 * d.n / max).pointRadius((d) => 0.25 + 1.1 * Math.sqrt(d.n / max))
        .pointLabel((d) => `<div style="font-family:Vazirmatn;background:#1e1e1e;padding:6px 9px;border-radius:8px;border:1px solid #333">${esc(d.name_fa)} · ${fa(d.n)} اشاره<br>${esc(topicFa(d.category))}</div>`)
        .onPointClick((d) => showEntity(d))
        .arcsData(data.arcs).arcStartLat((d) => d.coords[0][1]).arcStartLng((d) => d.coords[0][0]).arcEndLat((d) => d.coords[1][1]).arcEndLng((d) => d.coords[1][0])
        .arcColor(() => ["rgba(94,159,232,.15)", "rgba(94,159,232,.85)"]).arcStroke((d) => Math.min(1.6, 0.25 + d.w / 6)).arcDashLength(0.45).arcDashGap(0.2).arcDashAnimateTime(reducedMotion() ? 0 : 2400)
        .labelsData(data.points.filter((p) => p.n >= max * 0.15)).labelLat("lat").labelLng("lon").labelText("name_fa").labelSize(0.9).labelColor(() => "rgba(255,255,255,.8)").labelDotRadius(0).labelAltitude(0.02);
      g.pointOfView({ lat: 28, lng: 48, altitude: 2.1 }, 0);
      g.controls().autoRotate = !reducedMotion(); g.controls().autoRotateSpeed = 0.25;
    } else {
      await ensureWorld();
      stage.innerHTML = '<div id="flat" style="position:absolute;inset:0"></div>';
      const ch = makeChart($("#flat"));
      ch.setOption({ backgroundColor: "transparent", tooltip: { ...baseTooltip(), formatter: (p) => p.data?.name_fa ? `${p.data.name_fa} · ${fa(p.data.n)} اشاره` : p.name },
        geo: { map: "world", roam: true, center: [45, 28], zoom: 2.2, itemStyle: { areaColor: T().line, borderColor: T().line2 }, emphasis: { itemStyle: { areaColor: T().line2 }, label: { show: false } } },
        series: [
          { type: "lines", coordinateSystem: "geo", data: data.arcs.map((a) => ({ coords: a.coords, w: a.w })), lineStyle: { color: T().accent, opacity: 0.35, curveness: 0.25, width: 1 },
            effect: { show: !reducedMotion(), period: 5, trailLength: 0.25, symbolSize: 3, color: T().accent } },
          { type: "effectScatter", coordinateSystem: "geo", data: data.points.map((p) => ({ ...p, value: [p.lon, p.lat, p.n], itemStyle: { color: p.color } })),
            symbolSize: (v) => 6 + 26 * Math.sqrt(v[2] / max), rippleEffect: { scale: 2.6, brushType: "stroke" }, showEffectOn: reducedMotion() ? "emphasis" : "render" }] });
      ch.on("click", (p) => p.data?.id && showEntity(p.data));
    }
    legend();
  }
  async function showEntity(e) {
    const ss = await api(`/api/stories?entity=${encodeURIComponent(e.id)}&hours=${hours}&limit=30`);
    side.innerHTML = `<h2>${esc(e.name_fa)} <span class="small dim">${esc(e.name_en)}</span></h2><div class="small muted">${fa(e.n)} اشاره · موضوع غالب ${catChip(e.category)}</div>
      <div class="toolbar" style="margin-top:10px"><a class="btn" href="#/graph/${e.id}">گراف روابط</a></div><div class="h-sec">داستان‌ها</div><div class="list">${ss.map((s) => storyRow(s)).join("") || '<div class="empty">—</div>'}</div>`;
    side.querySelector(".list").onclick = (ev) => { const r = ev.target.closest("[data-sid]"); if (r) location.hash = "#/stories/" + r.dataset.sid; };
  }
  $("#mMode").onclick = (e) => { if (e.target.dataset.m) { mode = e.target.dataset.m; draw(); } };
  $("#mHours").onchange = (e) => { hours = +e.target.value; draw(); };
  side.innerHTML = '<h2>کره و نقشه رویدادها</h2><p class="muted small">روی هر نقطه کلیک کنید تا داستان‌های مرتبط با آن کشور، تنگه، بندر یا سازمان را ببینید. نقشه‌ها از فایل‌های محلی بارگذاری می‌شوند و بدون اینترنت بین‌الملل کار می‌کنند.</p>';
  await draw();
  const ro = new ResizeObserver(() => g && g.width(stage.clientWidth).height(stage.clientHeight)); ro.observe(stage);
  return () => { ro.disconnect(); g?._destructor?.(); view.style.padding = ""; };
}

// ============ 3) Knowledge Graph ============
export async function renderGraph({ view, side, params }) {
  let focus = params[0] || null, hours = 72;
  view.style.padding = 0;
  view.innerHTML = `<div id="gStage" style="position:absolute;inset:0"></div>
  <div class="float" style="top:10px;right:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <select id="gHours"><option value="24">۲۴ ساعت</option><option value="72" selected>۷۲ ساعت</option><option value="168">۷ روز</option></select>
    <button class="btn" id="gAll">نمای کامل</button><span class="small muted">مسیر:</span><select id="pA"></select><span>↔</span><select id="pB"></select><button class="btn" id="pGo">یافتن مسیر</button>
  </div>`;
  const TYPE = { GPE: ["کشور", "#5E9FE8"], ORG: ["سازمان", "#A98BE0"], LOC: ["مکان/تنگه", "#4FB9C9"], PORT: ["بندر", "#72BC8F"], PERSON: ["شخص", "#E07FA2"], EVENT: ["رویداد", "#E97366"], PRODUCT: ["کالا/سامانه", "#E0A84E"] };
  const ch = makeChart($("#gStage"));
  let data;
  async function draw(pathIds = []) {
    data = await api(`/api/graph?hours=${hours}&min_weight=${focus ? 1 : 2}${focus ? "&focus=" + focus : ""}`);
    const max = Math.max(1, ...data.nodes.map((n) => n.mentions));
    const opts = data.nodes.slice().sort((a, b) => b.mentions - a.mentions).map((n) => `<option value="${n.id}">${esc(n.name_fa)}</option>`).join("");
    $("#pA").innerHTML = opts; $("#pB").innerHTML = opts; if (data.nodes[1]) $("#pB").selectedIndex = 1;
    const onPath = new Set(pathIds);
    const pairs = new Set(pathIds.slice(1).map((x, i) => [pathIds[i], x].sort().join("|")));
    ch.setOption({ tooltip: { ...baseTooltip(), formatter: (p) => p.dataType === "edge" ? (p.data.predicate && p.data.predicate !== "co_mentioned" ? `${esc(p.data.sName)} <b>${esc(p.data.predicate_fa)}</b> ${esc(p.data.tName)} · ✦ استخراج مدل` : `${p.data.sName} ↔ ${p.data.tName}: ${fa(p.data.weight)} هم‌آیی`) : `${p.data.name} · ${fa(p.data.mentions)} اشاره` },
      legend: [{ data: Object.values(TYPE).map((t) => t[0]), bottom: 10, textStyle: { color: T().muted, fontFamily: "Vazirmatn" } }],
      series: [{ type: "graph", layout: "force", roam: true, draggable: true, animation: !reducedMotion(),
        categories: Object.values(TYPE).map(([n, c]) => ({ name: n, itemStyle: { color: c } })),
        force: { repulsion: 220, edgeLength: [40, 160], gravity: 0.06, friction: 0.15 },
        label: { show: true, position: "right", color: T().text, fontFamily: "Vazirmatn", fontSize: 11 },
        emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        lineStyle: { color: "source", opacity: 0.35, curveness: 0.08 },
        data: data.nodes.map((n) => ({ id: n.id, name: n.name_fa, mentions: n.mentions, category: Object.keys(TYPE).indexOf(n.type) < 0 ? 0 : Object.keys(TYPE).indexOf(n.type),
          symbolSize: 8 + 38 * Math.sqrt(n.mentions / max), itemStyle: onPath.has(n.id) || n.id === focus ? { borderColor: "#E0A84E", borderWidth: 3 } : undefined })),
        links: data.links.map((l) => ({ source: l.source, target: l.target, weight: l.weight, evidence: l.evidence, predicate: l.predicate, predicate_fa: l.predicate_fa,
          symbol: l.predicate && l.predicate !== "co_mentioned" ? ["none", "arrow"] : ["none", "none"], symbolSize: 8,
          label: l.predicate && l.predicate !== "co_mentioned" ? { show: true, formatter: l.predicate_fa, fontSize: 9, color: "#E0A84E", fontFamily: "Vazirmatn" } : undefined,
          sName: data.nodes.find((n) => n.id === l.source)?.name_fa, tName: data.nodes.find((n) => n.id === l.target)?.name_fa,
          lineStyle: pairs.has([l.source, l.target].sort().join("|")) ? { color: "#E0A84E", width: 4, opacity: 1 } : l.predicate && l.predicate !== "co_mentioned" ? { color: "#E0A84E", width: 1.6, opacity: 0.8, type: "dashed" } : { width: Math.min(6, 0.6 + l.weight / 3) } })) }] }, true);
    if (focus) showNode(focus);
    else side.innerHTML = `<h2>گراف دانش</h2><p class="muted small">${fa(data.nodes.length)} موجودیت و ${fa(data.links.length)} رابطه. روی گره کلیک کنید تا جزئیات، و دوبار کلیک کنید تا همسایه‌ها گسترش یابند. ابزار مسیر کوتاه‌ترین زنجیره ارتباط دو بازیگر را پیدا می‌کند.</p><p class="small dim">دو نوع لبه: هم‌آیی در یک خبر (خط پیوسته، با شاهد) و رابطه نوع‌دار صریح که عامل «استخراج موجودیت و رابطه» با مدل زبانی و نقل‌قول شاهد استخراج کرده است (خط‌چین کهربایی با برچسب؛ مثلاً «تحریم می‌کند»، «مذاکره می‌کند با»). گره‌های شخص و رویداد نیز از همین مسیر کشف می‌شوند.</p>`;
  }
  async function showNode(id) {
    const n = data.nodes.find((x) => x.id === id) || { id, name_fa: id };
    const ss = await api(`/api/stories?entity=${encodeURIComponent(id)}&hours=${hours}&limit=20`);
    const nb = data.links.filter((l) => l.source === id || l.target === id).sort((a, b) => b.weight - a.weight).slice(0, 12);
    side.innerHTML = `<h2>${esc(n.name_fa)} <span class="small dim">${esc(n.name_en || "")}</span></h2><div class="small muted">${fa(n.mentions)} اشاره در ${fa(hours)} ساعت</div>
     <div class="toolbar" style="margin-top:8px"><button class="btn" id="gFocus">گسترش همسایه‌ها</button></div>
     <div class="h-sec">قوی‌ترین روابط</div>${nb.map((l) => { const o = l.source === id ? l.target : l.source; const on_ = data.nodes.find((x) => x.id === o); return `<div class="row" data-n="${o}"><div style="flex:1">${l.predicate && l.predicate !== "co_mentioned" ? `<span class="small" style="color:var(--c-amber)">${esc(l.predicate_fa)}</span> ` : ""}${esc(on_?.name_fa || o)}</div><span class="num small">${fa(l.weight)}</span></div>`; }).join("")}
     <div class="h-sec">داستان‌ها</div><div class="list" id="gStories">${ss.map((s) => storyRow(s)).join("") || '<div class="empty">—</div>'}</div>`;
    $("#gFocus").onclick = () => { focus = id; draw(); };
    side.querySelectorAll("[data-n]").forEach((r) => (r.onclick = () => showNode(r.dataset.n)));
    $("#gStories").onclick = (e) => { const r = e.target.closest("[data-sid]"); if (r) location.hash = "#/stories/" + r.dataset.sid; };
  }
  ch.on("click", (p) => { if (p.dataType === "node") showNode(p.data.id); else if (p.dataType === "edge") { const typed = p.data.predicate && p.data.predicate !== "co_mentioned"; const quotes = (p.data.evidence || []).filter((x) => typeof x === "object"); side.innerHTML = `<h2>${esc(p.data.sName)} ${typed ? `<span style="color:var(--c-amber)">${esc(p.data.predicate_fa)}</span>` : "↔"} ${esc(p.data.tName)}</h2><div class="muted small">${typed ? "✦ رابطه صریح استخراج‌شده با مدل زبانی" : fa(p.data.weight) + " خبر مشترک"} · شواهد اخیر:</div>${quotes.map((q) => `<blockquote class="small" style="border-inline-start:3px solid var(--c-amber);margin:8px 0;padding:4px 10px">«${esc(q.quote)}» <a href="#/stories/${q.story_id}">داستان ←</a></blockquote>`).join("")}<div id="ev"></div>`; loadEvidence((p.data.evidence || []).filter((x) => typeof x === "string")); } });
  ch.on("dblclick", (p) => { if (p.dataType === "node") { focus = p.data.id; draw(); } });
  async function loadEvidence(ids) { const arts = await Promise.all(ids.map((i) => api("/api/articles/" + i).catch(() => null))); $("#ev").innerHTML = arts.filter(Boolean).map((a) => `<div class="row" onclick="location.hash='#/stories/${a.story_id}'"><div><div class="t">${esc(a.title)}</div><div class="m">${esc(a.source_name)} · ${hhmm(a.published_at)}</div></div></div>`).join(""); }
  $("#gHours").onchange = (e) => { hours = +e.target.value; draw(); };
  $("#gAll").onclick = () => { focus = null; draw(); };
  $("#pGo").onclick = async () => { const r = await api(`/api/path?a=${$("#pA").value}&b=${$("#pB").value}`); if (!r.path.length) return toast("مسیری یافت نشد", "warn"); const ids = r.path.map((x) => x.id); toast("مسیر: " + r.path.map((x) => x.name_fa).join(" ← "), "info"); focus = null; await draw(ids); };
  await draw();
  return () => { view.style.padding = ""; };
}

// ============ 4) Stories & Timeline ============
export async function renderStories({ view, side, params }) {
  const list = await api("/api/stories?limit=80&hours=72");
  let sel = params[0] || list[0]?.id;
  side.innerHTML = `<div class="toolbar"><select id="sCat"><option value="">همه موضوع‌ها</option>${Object.entries(store.topics).map(([k, t]) => `<option value="${k}">${t.fa}</option>`).join("")}</select>
    <select id="sMin"><option value="1">همه</option><option value="2">≥۲ منبع</option><option value="3">≥۳ منبع</option></select></div><div class="list" id="sList"></div>`;
  async function drawList() {
    const rows = await api(`/api/stories?limit=80&hours=72&category=${$("#sCat").value}&min_sources=${$("#sMin").value}`);
    $("#sList").innerHTML = rows.map((s) => storyRow(s, s.id === sel)).join("") || '<div class="empty">—</div>';
  }
  $("#sCat").onchange = drawList; $("#sMin").onchange = drawList;
  $("#sList").onclick = (e) => { const r = e.target.closest("[data-sid]"); if (r) location.hash = "#/stories/" + r.dataset.sid; };
  await drawList();
  if (!sel) { view.innerHTML = '<div class="empty">هنوز داستانی نیست.</div>'; return; }
  const s = await api("/api/stories/" + sel);
  const cmp = await api("/api/compare/" + sel);
  const evFa = { first_report: "اولین گزارش", continuation: "ادامه", escalation: "تشدید", denial: "تکذیب" };
  const evC = { first_report: "#5E9FE8", continuation: "#4FB9C9", escalation: "#E97366", denial: "#E0A84E" };
  view.innerHTML = `
   <div class="card"><div class="small muted">${catChip(s.category)} · ${fa(s.article_count)} خبر از ${fa(s.source_count)} منبع در ${fa(s.lang_count)} زبان · اولین گزارش ${dt(s.first_seen)} · آخرین به‌روزرسانی ${ago(s.last_update)}</div>
     <h2 style="margin:6px 0 4px;font-size:19px;line-height:1.6">${esc(s.title_fa || s.title)}</h2>${s.title_fa && s.title_fa !== s.title ? `<div class="small dim">${esc(s.title)}</div>` : ""}
     <p class="muted" style="margin:8px 0 0">${esc(s.summary || "")}</p>
     <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${verTag(s.verification)}${s.verification?.contradictions ? `<span class="tag critical">${fa(s.verification.contradictions)} تکذیب/تناقض</span>` : ""}${s.entity_objs.map((e) => `<a class="chip" href="#/graph/${e.id}">${esc(e.name_fa)}</a>`).join("")}</div></div>
   ${storyAiCard(s)}
   <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:var(--gap)">
     <div class="card"><h3>خط داستان · نسخه منابع در زمان</h3><div class="chart" id="sTl" style="height:${Math.max(180, 46 + 28 * cmp.sources.length)}px"></div></div>
     <div class="card"><h3>سرعت انتشار منابع <span class="r small">دقیقه پس از اولین گزارش</span></h3><div class="chart" id="sLag" style="height:${Math.max(180, 46 + 28 * cmp.sources.length)}px"></div></div>
   </div>
   <div class="card" style="margin-top:var(--gap)"><h3>ادعاها و راستی‌آزمایی</h3>${s.claims.map((c) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="tag ${c.kind}">${VER[c.kind]} · اطمینان ${CONF[c.confidence]}</span>${c.method === "llm" ? ' <span class="chip">✦ مدل</span>' : ""} ${esc(c.text)}
      <div class="small muted" style="margin-top:4px">شواهد: ${c.evidence.map((e) => `<a href="#" data-aid="${e.article_id}">${esc(e.source || "")}</a>`).join("، ")}${c.contradicted_by.length ? ` · <span style="color:var(--c-coral)">تناقض: ${c.contradicted_by.map((x) => esc(x.quote)).join(" | ")}</span>` : ""}</div></div>`).join("") || '<div class="dim small">ادعایی استخراج نشده.</div>'}</div>
   <div class="card" style="margin-top:var(--gap)"><h3>نسخه‌های منابع کنار هم</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
     ${s.articles.map((a) => `<div class="card" style="background:var(--panel2)"><div class="small muted">${esc(a.source_name)} <span class="tag lang">${LANG[a.lang]}</span> · ${dt(a.published_at)} ${a.duplicate_of ? '<span class="tag assumption">تکراری</span>' : ""}</div>
       <div style="font-weight:600;margin:6px 0">${esc(a.title)}</div>${a.lang !== "fa" && a.title_fa ? `<div class="small" style="color:var(--accent);margin-bottom:4px">${esc(a.title_fa)}</div>` : ""}<div class="small muted" data-lead="${a.id}">${esc((a.lead || "").slice(0, 260))}</div>
       ${a.lang !== "fa" ? `<button class="btn ghost small" data-tr="${a.id}" style="height:24px;padding:0 6px">✦ ترجمه متن</button>` : ""}
       <div class="small" style="margin-top:6px"><a href="${esc(a.url)}" target="_blank" rel="noopener">سند منبع اصلی ↗</a> · <span class="dim">${esc(a.extraction_method || "")}</span></div></div>`).join("")}</div></div>`;
  bindStoryAi(s, view);
  view.querySelectorAll("[data-tr]").forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = "در حال ترجمه…"; try { const r = await post(`/api/articles/${b.dataset.tr}/translate`); const el = view.querySelector(`[data-lead="${b.dataset.tr}"]`); el.innerHTML = `<div style="color:var(--text);line-height:1.8">${esc(r.lead_fa || "")}</div>`; b.remove(); } catch (e) { toast(e.message, "error"); b.disabled = false; b.textContent = "✦ ترجمه متن"; } }));
  view.querySelectorAll("[data-aid]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); const a = s.articles.find((y) => y.id === x.dataset.aid); if (a) window.open(a.url, "_blank"); }));
  const srcs = [...new Set(s.articles.map((a) => a.source_name))];
  const tl = makeChart($("#sTl"));
  tl.setOption({ grid: { left: 110, right: 16, top: 10, bottom: 28 }, tooltip: { ...baseTooltip(), formatter: (p) => `${esc(p.data.title)}<br>${dt(p.data.value[0] / 1000)} · ${evFa[p.data.ev] || ""}` },
    xAxis: { type: "time", inverse: true, ...axisCommon() }, yAxis: { type: "category", data: srcs, ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn" } },
    series: [{ type: "scatter", symbolSize: 14, data: s.articles.map((a) => { const ev = s.timeline.find((t) => t.article_id === a.id)?.type; return { value: [a.published_at * 1000, a.source_name], title: a.title, ev, itemStyle: { color: evC[ev] || "#888", opacity: a.duplicate_of ? 0.4 : 1 } }; }) }] });
  const lag = makeChart($("#sLag"));
  const cs = cmp.sources.sort((a, b) => a.lag_min - b.lag_min);
  lag.setOption({ grid: { left: 110, right: 16, top: 10, bottom: 28 }, tooltip: { ...baseTooltip() }, xAxis: { type: "value", inverse: true, ...axisCommon() },
    yAxis: { type: "category", data: cs.map((x) => x.source), inverse: true, ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn" } },
    series: [{ type: "bar", data: cs.map((x) => ({ value: x.lag_min, itemStyle: { color: x.sentiment < -0.2 ? "#E97366" : x.sentiment > 0.2 ? "#72BC8F" : "#5E9FE8", borderRadius: 4 } })), label: { show: true, position: "insideRight", color: "#fff", formatter: (p) => fa(p.value) } }] });
}

// ============ 5) Trends ============
export async function renderTrends({ view, side }) {
  const d = await api("/api/trends?hours=72&bucket=3600");
  view.innerHTML = `<div class="card"><h3>رودخانه موضوعی (Theme River) · ظهور و افول موضوع‌ها <span class="r small">۷۲ ساعت، بازه ساعتی</span></h3><div class="chart" id="tRiver" style="height:340px"></div></div>
   <div class="card" style="margin-top:var(--gap)"><h3>نقشه حرارتی منطقه × موضوع</h3><div class="chart" id="tHeat" style="height:${120 + 26 * d.regions.length}px"></div></div>`;
  const river = makeChart($("#tRiver"));
  const cats = Object.keys(store.topics);
  river.setOption({ color: cats.map(topicColor), tooltip: { trigger: "axis", ...baseTooltip(), axisPointer: { type: "line", lineStyle: { color: T().line2 } } },
    legend: { data: cats.map(topicFa), top: 0, textStyle: { color: T().muted, fontFamily: "Vazirmatn" } },
    singleAxis: { type: "time", top: 40, bottom: 30, inverse: true, ...axisCommon() },
    series: [{ type: "themeRiver", label: { show: false }, emphasis: { itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,.4)" } },
      data: (() => { const ts = [...new Set(d.river.map((r) => r.t))].sort(); const m = {}; d.river.forEach((r) => (m[r.t + "|" + r.category] = r.n)); return ts.flatMap((t) => cats.map((c) => [t * 1000, m[t + "|" + c] || 0, topicFa(c)])); })() }] });
  const heat = makeChart($("#tHeat"));
  const vals = d.heat.map((h) => [cats.indexOf(h.category), d.regions.findIndex((r) => r.id === h.region), h.n]);
  heat.setOption({ tooltip: { ...baseTooltip(), formatter: (p) => `${d.regions[p.value[1]].fa} · ${topicFa(cats[p.value[0]])}: ${fa(p.value[2])}` }, grid: { left: 110, right: 20, top: 10, bottom: 60 },
    xAxis: { type: "category", data: cats.map(topicFa), ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn", rotate: 20 } },
    yAxis: { type: "category", data: d.regions.map((r) => r.fa), ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn" } },
    visualMap: { min: 0, max: Math.max(1, ...vals.map((v) => v[2])), orient: "horizontal", left: "center", bottom: 0, inRange: { color: [T().line, "#4FB9C9", "#5E9FE8", "#E0A84E", "#E97366"] }, textStyle: { color: T().muted } },
    series: [{ type: "heatmap", data: vals, label: { show: true, color: "#fff", formatter: (p) => fa(p.value[2]) }, itemStyle: { borderColor: T().panel, borderWidth: 2, borderRadius: 4 } }] });
  heat.on("click", (p) => (location.hash = "#/map"));
  const sigs = await api("/api/signals?hours=72");
  side.innerHTML = `<h2>جهش‌ها و سیگنال‌ها</h2><p class="small muted">آستانه: z ≥ ۲٫۵ (حجم موضوع) و ≥۳ برابر نرخ پایه (موجودیت).</p>${sigs.map((g) => `<div class="row"><span class="bar" style="background:${g.severity === "critical" ? "var(--c-coral)" : "var(--c-amber)"}"></span><div><div class="t" style="font-weight:500">${esc(g.label)}</div><div class="m num">score ${g.score} · obs ${g.observed} · base ${g.baseline} · ${ago(g.created)}</div>${g.ai ? `<div class="small" style="margin-top:4px;line-height:1.8"><span class="ai-badge">✦</span> ${esc(g.ai.explanation_fa || "")}${g.ai.watch_fa ? `<div class="dim">پایش: ${esc(g.ai.watch_fa)}</div>` : ""}</div>` : ""}<div class="small dim">فرضیه‌های جایگزین: ${esc((g.explanation?.alternatives || []).join(" / "))}</div></div></div>`).join("") || '<div class="empty small">سیگنالی نیست.</div>'}`;
}

// ============ 6) Sources ============
export async function renderSources({ view, side }) {
  const { sources, scout } = await api("/api/sources");
  const active = sources.filter((s) => s.status !== "pending");
  const pend = sources.filter((s) => s.status === "pending");
  view.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr"><div class="card"><h3>خبر ۲۴ ساعت به تفکیک منبع</h3><div class="chart" id="srcVol" style="height:${60 + 18 * active.length}px"></div></div>
    <div class="card"><h3>سرعت انتشار (میانه دقیقه پس از اولین گزارش) و اولین گزارش‌ها</h3><div class="chart" id="srcLag" style="height:${60 + 18 * active.length}px"></div></div></div>
   <div class="card" style="margin-top:var(--gap);padding:0;overflow:auto"><table class="t"><thead><tr><th>منبع</th><th>زبان</th><th>نوع</th><th>گروه مالکیت</th><th>اعتبار</th><th>خبر ۲۴س</th><th>کیفیت استخراج</th><th>میانه تأخیر</th><th>اولین گزارش</th><th>وضعیت</th><th></th></tr></thead><tbody>
   ${active.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="small dim" style="direction:ltr;text-align:right">${esc(s.last_error || "")}</div></td><td><span class="tag lang">${LANG[s.lang] || s.lang}</span></td><td class="small">${esc(s.type)}</td><td class="small">${esc(s.ownership_group)}</td>
     <td class="num">${fa(Math.round(s.credibility * 100))}</td><td class="num">${fa(s.items_24h)}</td><td>${pct(s.extract_q)}</td><td class="num">${s.lag_median_min != null ? fa(s.lag_median_min) : "—"}</td><td class="num">${fa(s.first_reports)}</td>
     <td><span class="dot ${s.status}"></span> ${esc(s.status)} ${s.fail_count ? `<span class="small" style="color:var(--c-coral)">(${fa(s.fail_count)} خطا)</span>` : ""}</td>
     <td><button class="btn ghost small" data-src="${s.id}" data-st="${s.status === "active" ? "disabled" : "active"}">${s.status === "active" ? "غیرفعال" : "فعال‌سازی"}</button></td></tr>`).join("")}</tbody></table></div>`;
  const by = active.slice().sort((a, b) => a.items_24h - b.items_24h);
  const v = makeChart($("#srcVol"));
  v.setOption({ grid: { left: 130, right: 20, top: 6, bottom: 20 }, tooltip: { ...baseTooltip() }, xAxis: { type: "value", inverse: true, ...axisCommon() },
    yAxis: { type: "category", data: by.map((s) => s.name), ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn", fontSize: 11 } },
    series: [{ type: "bar", data: by.map((s) => ({ value: s.items_24h, itemStyle: { color: { fa: "#5E9FE8", ar: "#A98BE0", en: "#4FB9C9" }[s.lang] || "#888", borderRadius: 3 } })) }] });
  const lg = active.filter((s) => s.lag_median_min != null).sort((a, b) => b.lag_median_min - a.lag_median_min);
  const l = makeChart($("#srcLag"));
  l.setOption({ grid: { left: 130, right: 20, top: 6, bottom: 20 }, tooltip: { ...baseTooltip() }, legend: { data: ["میانه تأخیر", "اولین گزارش"], textStyle: { color: T().muted, fontFamily: "Vazirmatn" }, top: 0 },
    xAxis: { type: "value", inverse: true, ...axisCommon() }, yAxis: { type: "category", data: lg.map((s) => s.name), ...axisCommon(), axisLabel: { color: T().muted, fontFamily: "Vazirmatn", fontSize: 11 } },
    series: [{ name: "میانه تأخیر", type: "bar", data: lg.map((s) => s.lag_median_min), itemStyle: { color: "#E0A84E", borderRadius: 3 } }, { name: "اولین گزارش", type: "bar", data: lg.map((s) => s.first_reports), itemStyle: { color: "#72BC8F", borderRadius: 3 } }] });
  const val = Object.fromEntries((scout.validated || []).map((x) => [x.id, x]));
  side.innerHTML = `<h2>کاشف منابع · در انتظار تأیید انسانی</h2><p class="small muted">منابع جدید هرگز خودکار فعال نمی‌شوند. Source Scout هر منبع کاندید را اعتبارسنجی می‌کند و تصمیم با شماست.</p>
   ${pend.map((s) => { const x = val[s.id] || {}; return `<div class="card" style="margin-bottom:8px;background:var(--panel2)"><b>${esc(s.name)}</b> <span class="tag lang">${LANG[s.lang]}</span><div class="small muted" style="direction:ltr;text-align:right">${esc(s.url)}</div>
     <div class="small" style="margin:6px 0">نتیجه اعتبارسنجی: <b>${esc(x.verdict || "بررسی نشده")}</b> · ${fa(x.entries || 0)} مدخل · robots: ${x.robots_ok ? "مجاز" : "نامشخص/ممنوع"}</div>
     ${s.meta?.ai_profile ? (() => { const p = s.meta.ai_profile; return `<div class="small ai-card" style="padding:8px;border-radius:8px;margin-bottom:8px;line-height:1.8"><span class="ai-badge">✦ پروفایل مدل</span> ${esc(p.description_fa || "")}<div><b>مالکیت:</b> ${esc(p.ownership || "—")} · <b>گرایش:</b> ${esc(p.bias || "—")} · <b>اعتبار پیشنهادی:</b> ${p.credibility != null ? fa(Math.round(p.credibility * 100)) : "—"}</div>${p.risks ? `<div class="dim">ریسک: ${esc(p.risks)}</div>` : ""}</div>`; })() : ""}
     <button class="btn primary" data-src="${s.id}" data-st="active">تأیید و فعال‌سازی</button> <button class="btn ghost" data-src="${s.id}" data-st="disabled">رد</button></div>`; }).join("") || '<div class="empty small">منبع کاندیدی نیست. برای افزودن، sources.yaml را با status: pending ویرایش کنید.</div>'}
   <div class="h-sec">اصول</div><div class="small muted">رعایت robots.txt · درخواست شرطی ETag · قرنطینه پس از ۵ خطا · منابع هم‌مالکیت مستقل محسوب نمی‌شوند.</div>`;
  const act = async (e) => { const b = e.target.closest("[data-src]"); if (!b) return; await post(`/api/sources/${b.dataset.src}/status`, { status: b.dataset.st }); toast("وضعیت منبع به‌روزرسانی شد (در اجرای بعد اعمال می‌شود)", "success"); renderSources({ view, side }); };
  view.onclick = act; side.onclick = act;
}

// ============ 8) Briefs ============
export async function renderBriefs({ view, side, params }) {
  const list = await api("/api/briefs");
  const sel = +(params[0] || list[0]?.id || 0);
  const ST = { draft: ["پیش‌نویس", "assumption"], published: ["منتشرشده", "documented_fact"], rejected: ["ردشده", "critical"] };
  const ents = await api("/api/graph?hours=72&min_weight=2&limit=120").then((g) => g.nodes.sort((a, b) => b.mentions - a.mentions).slice(0, 60)).catch(() => []);
  side.innerHTML = `<div class="card ai-card" style="margin-bottom:12px"><h3><span class="ai-badge">✦ بریف سفارشی</span></h3>
     <div class="form"><label>موضوع<select id="cbT"><option value="">همه</option>${Object.entries(store.topics).map(([k, t]) => `<option value="${k}">${t.fa}</option>`).join("")}</select></label>
     <label>بازیگر/مکان<select id="cbE"><option value="">همه</option>${ents.map((e) => `<option value="${esc(e.id)}">${esc(e.name_fa)}</option>`).join("")}</select></label>
     <label>بازه<select id="cbH"><option value="12">۱۲ ساعت</option><option value="24" selected>۲۴ ساعت</option><option value="72">۷۲ ساعت</option></select></label></div>
     <button class="btn primary" id="cbGo" style="margin-top:8px;width:100%">تولید بریف با هوش مصنوعی</button></div>
   <h2>بریف‌ها</h2><div class="list">${list.map((b) => `<div class="row ${b.id === sel ? "sel" : ""}" onclick="location.hash='#/briefs/${b.id}'"><div style="flex:1"><div class="t">#${fa(b.id)} · ${dt(b.created)}</div><div class="m"><span class="tag ${ST[b.status]?.[1]}">${ST[b.status]?.[0] || b.status}</span>${b.edited_by_user ? '<span class="chip">ویرایش انسانی</span>' : ""}${b.run_id === "custom" ? '<span class="chip">سفارشی</span>' : ""}</div></div></div>`).join("") || '<div class="empty">—</div>'}</div>`;
  $("#cbGo").onclick = async () => { const btn = $("#cbGo"); btn.disabled = true; btn.textContent = "عامل نویسنده در حال نگارش…"; try { const r = await post("/api/briefs/custom", { topic: $("#cbT").value, entity: $("#cbE").value, hours: +$("#cbH").value }); toast("بریف سفارشی ساخته شد", "success"); location.hash = "#/briefs/" + r.id; } catch (e) { toast(e.message, "error"); btn.disabled = false; btn.textContent = "تولید بریف با هوش مصنوعی"; } };
  if (!sel) { view.innerHTML = '<div class="empty">هنوز بریفی تولید نشده.</div>'; return; }
  const b = await api("/api/briefs/" + sel);
  view.innerHTML = `<div class="toolbar no-print"><span class="tag ${ST[b.status]?.[1]}">${ST[b.status]?.[0]}</span><span class="tb-spacer" style="flex:1"></span>
     <a class="btn" href="/api/briefs/${b.id}.md" download="rasad-brief-${b.id}.md">خروجی Markdown</a><button class="btn" onclick="window.print()">خروجی PDF</button>
     <button class="btn" id="bPresent">نسخه ویدئویی (حالت نمایش)</button></div>
   <div class="card md" style="max-width:900px">${richText(b.markdown)}</div>`;
  view.querySelectorAll(".md a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  $("#bPresent").onclick = () => $("#presentBtn").click();
}

// ============ QA & Audit ============
export async function renderQA({ view, side }) {
  const [qa, audit, runs] = await Promise.all([api("/api/qa"), api("/api/audit?limit=60"), api("/api/runs?limit=20")]);
  const m = qa.current.metrics || {};
  const targets = [["تازگی p50 (دقیقه)", m.freshness_p50_min, "< ۱۰"], ["تازگی p95 (دقیقه)", m.freshness_p95_min, "< ۲۰"], ["نرخ تکرار", pct(m.duplicate_rate), "< ۵٪"], ["پوشش طبقه‌بندی", pct(m.classification_coverage), "≥ ۷۰٪"],
    ["پوشش موجودیت", pct(m.entity_coverage), "—"], ["کیفیت استخراج", pct(m.extraction_quality), "—"], ["سلامت منابع", pct(m.source_health), "≥ ۹۵٪"], ["پوشش ارجاع بریف", pct(m.citation_coverage), "۱۰۰٪"], ["توکن LLM امروز", fa(m.llm_tokens_today), "بودجه"], ["✦ وفاداری بریف به منابع", m.llm_faithfulness != null ? pct(m.llm_faithfulness) : "—", "≥ ۹۰٪"]];
  view.innerHTML = `<div class="grid" style="grid-template-columns:repeat(3,1fr)">${targets.map(([k, v, t]) => `<div class="card kpi"><div class="l">${k}</div><div class="v" style="font-size:22px">${v ?? "—"}</div><div class="d">هدف MVP: ${t}</div></div>`).join("")}</div>
   <div class="card" style="margin-top:var(--gap)"><h3>روند شاخص‌ها در اجراها</h3><div class="chart" id="qaH" style="height:260px"></div></div>
   <div class="card" style="margin-top:var(--gap);padding:0"><h3 style="padding:14px 14px 0">اجراهای اخیر</h3><table class="t"><thead><tr><th>شناسه</th><th>حالت</th><th>محرک</th><th>وضعیت</th><th>شروع</th><th>مدت</th><th>توکن</th></tr></thead><tbody>
   ${runs.map((r) => `<tr onclick="location.hash='#/pipeline/${r.id}'" style="cursor:pointer"><td class="num small">${esc(r.id)}</td><td>${esc(r.mode)}</td><td class="small">${esc(r.trigger)}</td><td><span class="dot ${r.status}"></span> ${STATUS_FA[r.status] || r.status}</td><td>${dt(r.started)}</td><td class="num">${r.ended ? fa(Math.round(r.ended - r.started)) + "ث" : "—"}</td><td class="num">${fa(r.cost_tokens)}</td></tr>`).join("")}</tbody></table></div>`;
  const h = makeChart($("#qaH"));
  const H = qa.history;
  h.setOption({ tooltip: { trigger: "axis", ...baseTooltip() }, legend: { textStyle: { color: T().muted, fontFamily: "Vazirmatn" } }, grid: { left: 40, right: 40, top: 40, bottom: 30 },
    xAxis: { type: "time", inverse: true, ...axisCommon() }, yAxis: [{ type: "value", max: 1, ...axisCommon() }, { type: "value", ...axisCommon(), name: "دقیقه" }],
    series: [["پوشش طبقه‌بندی", "classification_coverage"], ["نرخ تکرار", "duplicate_rate"], ["سلامت منابع", "source_health"], ["پوشش موجودیت", "entity_coverage"]].map(([n, k]) => ({ name: n, type: "line", smooth: true, data: H.map((x) => [x.t * 1000, x[k]]) }))
      .concat([{ name: "تازگی p50", type: "line", yAxisIndex: 1, data: H.map((x) => [x.t * 1000, x.freshness_p50_min]), lineStyle: { type: "dashed" } }]) });
  side.innerHTML = `<h2>ثبت ممیزی (Audit Log)</h2><p class="small muted">همه فرمان‌ها، تصمیم‌های تأیید و ویرایش‌های انسانی ثبت می‌شوند.</p><div class="log" style="padding:0">${audit.map((a) => `<div><time>${hhmm(a.ts)}</time><b>${esc(a.actor)}</b><span>${esc(a.action)} ${esc(a.target)}</span></div>`).join("")}</div>
   ${qa.judge ? `<div class="h-sec">✦ داوری مدل بر بریف #${fa(qa.judge.brief_id)} · وفاداری ${pct(qa.judge.faithfulness)}</div>${(qa.judge.flagged || []).map((f) => `<div class="small" style="margin-bottom:8px;padding:6px 8px;border-inline-start:3px solid var(--c-amber);background:var(--panel2)"><div class="dim">${esc((f.sentence || "").slice(0, 160))}…</div>${esc(f.reason)}</div>`).join("")}${qa.judge.notes_fa ? `<div class="small muted">${esc(qa.judge.notes_fa)}</div>` : ""}` : ""}
   <div class="h-sec">بازخورد ارزیاب</div>${(qa.current.issues || []).map((i) => `<div class="small" style="margin-bottom:5px">• ${esc(i)}</div>`).join("") || '<span class="dim small">—</span>'}`;
}
