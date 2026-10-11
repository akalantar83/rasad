// Knowledge graph — WebGL (sigma.js v3 + graphology): ForceAtlas2 layout, Louvain communities, PageRank/betweenness,
// neighbour highlighting, search, filters, path finding, evidence inspection, node drag, PNG/GEXF export.
import { $, esc, fa, ago, hhmm, api, toast, cssVar, store, catChip, verTag } from "./core.js";

export const TYPE = {
  GPE: ["کشور", "#5E9FE8"], ORG: ["سازمان", "#A98BE0"], LOC: ["مکان/تنگه", "#4FB9C9"], PORT: ["بندر", "#72BC8F"],
  PERSON: ["شخص", "#E07FA2"], EVENT: ["رویداد", "#E97366"], PRODUCT: ["کالا/سامانه", "#E0A84E"],
};
const COMM = ["#5E9FE8", "#E0A84E", "#A98BE0", "#E07FA2", "#4FB9C9", "#E97366", "#72BC8F", "#8FA8C8", "#C9A26B", "#B6E07F", "#E0C24E", "#7FD1E0"];
const AMBER = "#E0A84E";
const isTyped = (p) => p && p !== "co_mentioned";

function hashPos(id) { let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return [((h >>> 0) % 1000) / 1000, (((h >>> 10) ^ h) >>> 0) % 1000 / 1000]; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

export async function renderGraph({ view, side, params }) {
  const L = window.graphologyLibrary, G = window.graphology, S = window.Sigma;
  if (!L || !G || !S) { view.innerHTML = '<div class="empty">کتابخانه‌های گراف بارگذاری نشدند.</div>'; return; }
  const st = { hours: 72, minW: 2, focus: params[0] || null, sizeBy: "pagerank", colorBy: "type", typedOnly: false, edgeLabels: true,
    hiddenTypes: new Set(), hovered: null, selected: null, path: null, pathEdges: null, search: null };
  view.style.padding = 0;
  view.innerHTML = `
  <div id="gStage" class="g-stage" dir="ltr"></div>
  <div class="g-toolbar float">
    <div class="g-search"><input id="gQ" type="text" placeholder="جست‌وجوی گره…" autocomplete="off"><div class="g-sres" id="gSres"></div></div>
    <select id="gHours" title="بازه زمانی"><option value="24">۲۴ ساعت</option><option value="72" selected>۷۲ ساعت</option><option value="168">۷ روز</option></select>
    <select id="gSize" title="اندازه گره"><option value="pagerank">اندازه: PageRank</option><option value="mentions">اندازه: اشاره</option><option value="degree">اندازه: درجه</option><option value="betweenness">اندازه: میانجی‌گری</option></select>
    <select id="gColor" title="رنگ گره"><option value="type">رنگ: نوع موجودیت</option><option value="community">رنگ: جامعه (Louvain)</option></select>
    <label class="g-range" title="حداقل وزن هم‌آیی">وزن ≥ <b id="gWv">${fa(2)}</b><input id="gW" type="range" min="1" max="10" value="2"></label>
    <button class="btn sm toggle" id="gTyped" title="فقط روابط نوع‌دار استخراج‌شده با مدل">فقط نوع‌دار</button>
    <button class="btn sm toggle on" id="gLbl" title="برچسب لبه‌ها">برچسب لبه</button>
    <span class="g-div"></span>
    <button class="btn sm" id="gAll" title="نمای کامل گراف">نمای کامل</button>
  </div>
  <div class="g-pathbar float">
    <span class="small muted">مسیر</span><select id="pA"></select><span class="dim">⟷</span><select id="pB"></select>
    <button class="btn sm primary" id="pGo">یافتن</button><button class="btn sm ghost" id="pClr" title="پاک کردن مسیر">✕</button>
  </div>
  <div class="g-zoom float">
    <button class="icon-btn" id="zIn" title="بزرگ‌نمایی"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></button><button class="icon-btn" id="zOut" title="کوچک‌نمایی"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg></button>
    <button class="icon-btn" id="zFit" title="نمای کامل"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button><button class="icon-btn" id="gRelayout" title="اجرای مجدد چیدمان ForceAtlas2 (زنده)"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg></button>
    <span class="g-div h"></span><button class="icon-btn" id="gPng" title="خروجی تصویر PNG"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg></button><a class="icon-btn" id="gGexf" title="خروجی GEXF برای Gephi" download><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></a>
  </div>
  <div class="g-legend float" id="gLegend"></div>
  <div class="g-stats float small" id="gStats"></div>
  <div class="g-loading" id="gLoad"><div class="spinner"></div><span>در حال چیدمان گراف…</span></div>`;

  const stage = $("#gStage");
  let graph, simple, renderer, fa2, metrics = {}, data, nodeIds = [];
  const TH = () => ({ text: cssVar("--text"), muted: cssVar("--muted"), panel: cssVar("--panel-solid"), bg: cssVar("--ink"),
    faded: document.documentElement.dataset.theme === "light" ? "#d8dadd" : "#2c3036", edge: document.documentElement.dataset.theme === "light" ? "#c9d0d9" : "#38404c" });
  let th = TH();

  function nodeColor(id, a) {
    if (st.colorBy === "community") return COMM[(metrics.comm?.[id] ?? 0) % COMM.length];
    return TYPE[a.etype]?.[1] || "#8a8f98";
  }
  function nodeSize(id, a) {
    const m = metrics.max, v = { mentions: a.mentions, pagerank: metrics.pr?.[id] || 0, degree: simple.hasNode(id) ? simple.degree(id) : 0, betweenness: metrics.bc?.[id] || 0 }[st.sizeBy];
    return 3.5 + 20 * Math.sqrt((v || 0) / (m[st.sizeBy] || 1));
  }

  function build() {
    graph = new G.MultiGraph({ type: "mixed", allowSelfLoops: false });
    simple = new G.Graph({ type: "undirected", allowSelfLoops: false });
    for (const n of data.nodes) {
      const [px, py] = hashPos(n.id), R = 10 * Math.sqrt(data.nodes.length), ang = px * Math.PI * 2, rad = R * Math.sqrt(py);
      graph.addNode(n.id, { label: n.name_fa || n.name_en || n.id, etype: n.type, mentions: n.mentions || 0, name_en: n.name_en, x: rad * Math.cos(ang), y: rad * Math.sin(ang) });
      simple.addNode(n.id);
    }
    data.links.forEach((l, i) => {
      if (!graph.hasNode(l.source) || !graph.hasNode(l.target) || l.source === l.target) return;
      const typed = isTyped(l.predicate);
      const attrs = { weight: l.weight || 1, predicate: l.predicate, predicate_fa: l.predicate_fa, evidence: l.evidence, typed, label: typed ? l.predicate_fa : "" };
      if (typed) graph.addDirectedEdgeWithKey("e" + i, l.source, l.target, { ...attrs, type: "arrow", size: 1.6 });
      else graph.addUndirectedEdgeWithKey("e" + i, l.source, l.target, { ...attrs, type: "line", size: Math.min(3.2, 0.35 + 0.55 * Math.log2(1 + (l.weight || 1))) });
      if (simple.hasEdge(l.source, l.target)) simple.updateEdgeAttribute(l.source, l.target, "weight", (w) => w + (l.weight || 1));
      else simple.addEdge(l.source, l.target, { weight: l.weight || 1 });
    });
    // metrics
    metrics = { comm: {}, pr: {}, bc: {}, max: {} };
    try { metrics.comm = simple.size ? L.communitiesLouvain(simple, { getEdgeWeight: "weight", rng: mulberry(7) }) : {}; } catch (e) { console.warn("louvain", e); }
    try { metrics.pr = simple.size ? L.metrics.centrality.pagerank(simple, { getEdgeWeight: "weight", maxIterations: 200, tolerance: 1e-6 }) : {}; } catch (e) { console.warn("pagerank", e); simple.forEachNode((n) => (metrics.pr[n] = simple.degree(n))); }
    try { metrics.bc = simple.order <= 900 ? L.metrics.centrality.betweenness(simple, { normalized: true }) : {}; } catch (e) { console.warn("betweenness", e); }
    const mx = (o) => Math.max(1e-9, ...Object.values(o || {}), 0);
    metrics.max = { mentions: Math.max(1, ...data.nodes.map((n) => n.mentions || 0)), pagerank: mx(metrics.pr), betweenness: mx(metrics.bc), degree: Math.max(1, ...simple.mapNodes((n) => simple.degree(n))) };
    metrics.rank = (obj) => { const s = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]); return Object.fromEntries(s.map(([k], i) => [k, i + 1])); };
    metrics.prRank = metrics.rank(metrics.pr); metrics.bcRank = metrics.rank(metrics.bc);
    metrics.ncomm = new Set(Object.values(metrics.comm)).size;
    graph.forEachNode((id, a) => graph.mergeNodeAttributes(id, { size: nodeSize(id, a), color: nodeColor(id, a) }));
    graph.forEachEdge((e, a) => graph.setEdgeAttribute(e, "color", a.typed ? AMBER : th.edge));
    layout(true);
  }
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function layout(sync) {
    if (!graph.order) return;
    const settings = { ...L.layoutForceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 200, outboundAttractionDistribution: true, strongGravityMode: true, gravity: 0.35, scalingRatio: 18, slowDown: 3, edgeWeightInfluence: 0.4, adjustSizes: false };
    if (sync) {
      L.layoutForceAtlas2.assign(graph, { iterations: graph.order > 300 ? 300 : 600, settings, getEdgeWeight: "weight" });
      try { L.layoutNoverlap.assign(graph, { maxIterations: 60, settings: { ratio: 1.3, margin: 3 } }); } catch {}
      return;
    }
    // live: animate the worker a few seconds, then settle
    fa2?.kill?.();
    fa2 = new L.FA2Layout(graph, { settings: { ...settings, slowDown: 6 }, getEdgeWeight: "weight" });
    fa2.start(); $("#gLoad").classList.add("on");
    setTimeout(() => { try { fa2.stop(); L.layoutNoverlap.assign(graph, { maxIterations: 40, settings: { ratio: 1.15, margin: 2 } }); } catch {} $("#gLoad").classList.remove("on"); renderer?.refresh(); }, 3200);
  }

  function neighbourhood(id) { const s = new Set([id]); graph.forEachNeighbor(id, (n) => s.add(n)); return s; }
  function visibleNode(id, a) { return !st.hiddenTypes.has(a.etype); }
  function visibleEdge(e, a) { return (!st.typedOnly || a.typed) && (a.typed || a.weight >= st.minW); }

  function nodeReducer(id, a) {
    const r = { ...a };
    if (!visibleNode(id, a)) { r.hidden = true; return r; }
    const focusId = st.hovered || st.selected;
    if (st.path) {
      if (st.path.has(id)) { r.highlighted = true; r.zIndex = 2; r.forceLabel = true; } else { r.color = th.faded; r.label = ""; r.zIndex = 0; }
    } else if (focusId) {
      const nb = st._nb;
      if (id === focusId) { r.highlighted = true; r.zIndex = 3; r.forceLabel = true; }
      else if (nb && nb.has(id)) { r.zIndex = 2; r.forceLabel = graph.order < 160; }
      else { r.color = th.faded; r.label = ""; r.zIndex = 0; }
    }
    if (st.search && st.search.has(id)) { r.highlighted = true; r.forceLabel = true; r.zIndex = 3; }
    return r;
  }
  function edgeReducer(e, a) {
    const r = { ...a };
    if (!visibleEdge(e, a)) { r.hidden = true; return r; }
    const [s, t] = graph.extremities(e);
    if (!r.typed || !st.edgeLabels) r.label = "";
    if (st.path) {
      if (st.pathEdges.has([s, t].sort().join("|"))) { r.color = AMBER; r.size = 4; r.zIndex = 2; r.forceLabel = true; } else { r.hidden = true; }
    } else {
      const focusId = st.hovered || st.selected;
      if (focusId) {
        if (s === focusId || t === focusId) { r.color = r.typed ? AMBER : "#5e9fe8"; r.size = (r.size || 1) + 0.6; r.zIndex = 2; r.forceLabel = r.typed && st.edgeLabels; }
        else { r.hidden = true; }
      }
    }
    return r;
  }

  function drawHover(ctx, d, s) {
    const size = s.labelSize, label = d.label || "";
    ctx.font = `${s.labelWeight} ${size}px ${s.labelFont}`;
    const w = ctx.measureText(label).width, x = d.x, y = d.y, R = d.size + 3;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 14; ctx.fillStyle = th.panel;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    if (label) { const h = size + 10; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + R - 2, y - h / 2, w + 14, h, 6) : ctx.rect(x + R - 2, y - h / 2, w + 14, h); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(x, y, d.size, 0, Math.PI * 2); ctx.fill();
    if (label) { ctx.fillStyle = th.text; ctx.fillText(label, x + R + 5, y + size / 3); }
  }
  function drawLabel(ctx, d, s) {
    if (!d.label) return;
    const size = s.labelSize;
    ctx.font = `${s.labelWeight} ${size}px ${s.labelFont}`;
    ctx.lineWidth = 3; ctx.strokeStyle = hexA(th.bg.startsWith("#") && th.bg.length === 7 ? th.bg : "#151515", 0.85); ctx.lineJoin = "round";
    ctx.strokeText(d.label, d.x + d.size + 4, d.y + size / 3);
    ctx.fillStyle = th.text; ctx.fillText(d.label, d.x + d.size + 4, d.y + size / 3);
  }

  function mount() {
    renderer?.kill();
    const R = S.rendering || {};
    const edgeProgramClasses = { arrow: R.EdgeArrowProgram || S.EdgeArrowProgram, line: R.EdgeRectangleProgram || R.EdgeLineProgram || S.EdgeRectangleProgram };
    Object.keys(edgeProgramClasses).forEach((k) => !edgeProgramClasses[k] && delete edgeProgramClasses[k]);
    const Ctor = S.Sigma || S.default || S;
    renderer = new Ctor(graph, stage, {
      renderEdgeLabels: true, enableEdgeEvents: true, zIndex: true, allowInvalidContainer: true, defaultEdgeType: "line", edgeProgramClasses,
      labelFont: "Vazirmatn, Inter, sans-serif", labelSize: 12, labelWeight: "600", labelColor: { color: th.text }, labelDensity: 0.9, labelGridCellSize: 90, labelRenderedSizeThreshold: 7,
      edgeLabelFont: "Vazirmatn, Inter, sans-serif", edgeLabelSize: 10.5, edgeLabelWeight: "600", edgeLabelColor: { color: AMBER },
      minCameraRatio: 0.04, maxCameraRatio: 3, stagePadding: 48, nodeReducer, edgeReducer, defaultDrawNodeHover: drawHover, defaultDrawNodeLabel: drawLabel,
    });
    bindEvents();
  }

  // ---------- interaction ----------
  let dragged = null, dragMoved = false;
  function bindEvents() {
    renderer.on("enterNode", ({ node }) => { st.hovered = node; st._nb = neighbourhood(node); stage.style.cursor = "pointer"; renderer.refresh({ skipIndexation: true }); });
    renderer.on("leaveNode", () => { st.hovered = null; st._nb = st.selected ? neighbourhood(st.selected) : null; stage.style.cursor = ""; renderer.refresh({ skipIndexation: true }); });
    renderer.on("enterEdge", () => (stage.style.cursor = "pointer"));
    renderer.on("leaveEdge", () => (stage.style.cursor = ""));
    renderer.on("clickNode", ({ node }) => { if (dragMoved) return; select(node); });
    renderer.on("doubleClickNode", (e) => { e.preventSigmaDefault?.(); st.focus = e.node; load(); });
    renderer.on("clickEdge", ({ edge }) => showEdge(edge));
    renderer.on("clickStage", () => { if (st.selected || st.path) { st.selected = null; st._nb = null; renderer.refresh({ skipIndexation: true }); overview(); } });
    renderer.on("downNode", (e) => { dragged = e.node; dragMoved = false; graph.setNodeAttribute(dragged, "highlighted", true); if (!renderer.getCustomBBox()) renderer.setCustomBBox(renderer.getBBox()); });
    renderer.getMouseCaptor().on("mousemovebody", (e) => {
      if (!dragged) return; dragMoved = true;
      const p = renderer.viewportToGraph(e); graph.setNodeAttribute(dragged, "x", p.x); graph.setNodeAttribute(dragged, "y", p.y);
      e.preventSigmaDefault(); e.original.preventDefault(); e.original.stopPropagation();
    });
    const up = () => { if (dragged) graph.removeNodeAttribute(dragged, "highlighted"); dragged = null; setTimeout(() => (dragMoved = false), 0); };
    renderer.getMouseCaptor().on("mouseup", up);
  }
  function focusCamera(id, ratio = 0.35) {
    const d = renderer.getNodeDisplayData(id); if (!d) return;
    renderer.getCamera().animate({ x: d.x, y: d.y, ratio }, { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
  }
  function select(id) { st.selected = id; st._nb = neighbourhood(id); st.path = null; renderer.refresh({ skipIndexation: true }); showNode(id); }

  // ---------- side panels ----------
  function overview() {
    const typed = graph.filterEdges((e, a) => a.typed).length;
    const top = Object.entries(metrics.pr).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const counts = {}; graph.forEachNode((_, a) => (counts[a.etype] = (counts[a.etype] || 0) + 1));
    const dens = graph.order > 1 ? (2 * simple.size) / (graph.order * (graph.order - 1)) : 0;
    side.innerHTML = `<div class="side-h"><h2>گراف دانش</h2><span class="chip">WebGL · sigma.js</span></div>
     <div class="mini-kpis"><div><b>${fa(graph.order)}</b><span>موجودیت</span></div><div><b>${fa(graph.size)}</b><span>رابطه</span></div><div><b>${fa(typed)}</b><span>نوع‌دار ✦</span></div><div><b>${fa(metrics.ncomm || 0)}</b><span>جامعه</span></div></div>
     <div class="small dim" style="margin-top:6px">چگالی ${fa(+(dens * 100).toFixed(1))}٪ · بازه ${fa(st.hours)} ساعت${st.focus ? ` · <b>تمرکز بر ${esc(graph.hasNode(st.focus) ? graph.getNodeAttribute(st.focus, "label") : st.focus)}</b>` : ""}</div>
     <div class="h-sec">کانونی‌ترین بازیگران (PageRank)</div>
     <div class="list rank">${top.map(([id, v], i) => `<div class="row" data-n="${esc(id)}"><span class="rk num">${fa(i + 1)}</span><span class="sw" style="background:${nodeColor(id, graph.getNodeAttributes(id))}"></span><div style="flex:1;min-width:0" class="t">${esc(graph.getNodeAttribute(id, "label"))}</div><div class="meter" style="width:64px;margin:0"><i style="width:${Math.round((100 * v) / (metrics.max.pagerank || 1))}%;background:var(--accent)"></i></div></div>`).join("") || '<div class="empty small">داده‌ای نیست</div>'}</div>
     <div class="h-sec">ترکیب انواع</div><div class="chips">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip"><span class="sw" style="background:${TYPE[t]?.[1] || "#888"}"></span>${esc(TYPE[t]?.[0] || t)} <b class="num">${fa(n)}</b></span>`).join("")}</div>
     <div class="h-sec">راهنما</div><div class="small muted" style="line-height:1.9">• کلیک روی گره: جزئیات و برجسته‌سازی همسایه‌ها · دوبار کلیک: گسترش همسایگی<br>• کشیدن گره برای جابه‌جایی · چرخ ماوس برای زوم<br>• کلیک روی لبه: شواهد (نقل‌قول و خبرها)<br>• لبه کهربایی جهت‌دار = رابطه صریح استخراج‌شده با مدل ✦ ؛ لبه خاکستری = هم‌آیی در یک خبر</div>`;
    side.querySelectorAll("[data-n]").forEach((r) => (r.onclick = () => { select(r.dataset.n); focusCamera(r.dataset.n); }));
  }
  async function showNode(id) {
    const a = graph.getNodeAttributes(id);
    const rels = [];
    graph.forEachEdge(id, (e, ea, s, t) => rels.push({ e, ea, other: s === id ? t : s, out: s === id }));
    rels.sort((x, y) => (y.ea.typed - x.ea.typed) || (y.ea.weight - x.ea.weight));
    const cid = metrics.comm[id];
    side.innerHTML = `<div class="side-h"><span class="sw lg" style="background:${nodeColor(id, a)}"></span><div style="min-width:0"><h2>${esc(a.label)}</h2><div class="small dim" dir="ltr" style="text-align:right">${esc(a.name_en || "")}</div></div></div>
     <div class="chips" style="margin:6px 0 10px"><span class="chip"><span class="sw" style="background:${TYPE[a.etype]?.[1] || "#888"}"></span>${esc(TYPE[a.etype]?.[0] || a.etype)}</span>${cid != null ? `<span class="chip"><span class="sw" style="background:${COMM[cid % COMM.length]}"></span>جامعه ${fa(cid + 1)}</span>` : ""}</div>
     <div class="mini-kpis"><div><b>${fa(a.mentions)}</b><span>اشاره</span></div><div><b>${fa(simple.degree(id))}</b><span>درجه</span></div><div><b>#${fa(metrics.prRank[id] || 0)}</b><span>PageRank</span></div><div><b>#${fa(metrics.bcRank[id] || 0)}</b><span>میانجی‌گری</span></div></div>
     <div class="toolbar" style="margin:12px 0 0"><button class="btn sm" id="nFocus">گسترش همسایگی</button><button class="btn sm" id="nZoom">زوم روی گره</button><button class="btn sm ghost" id="nA">مبدأ مسیر</button><button class="btn sm ghost" id="nB">مقصد مسیر</button></div>
     <div class="h-sec">روابط (${fa(rels.length)})</div>
     <div class="list">${rels.slice(0, 18).map((r) => `<div class="row" data-n="${esc(r.other)}" data-e="${r.e}"><div style="flex:1;min-width:0">${r.ea.typed ? `<span class="pred">${r.out ? "" : "← "}${esc(r.ea.predicate_fa)}${r.out ? " →" : ""}</span> ` : '<span class="dim small">هم‌آیی · </span>'}<span class="t">${esc(graph.getNodeAttribute(r.other, "label"))}</span></div><span class="num small dim">${fa(r.ea.weight)}</span></div>`).join("") || '<div class="empty small">—</div>'}</div>
     <div class="h-sec">داستان‌های مرتبط</div><div class="list" id="gStories"><div class="skel"></div><div class="skel"></div></div>`;
    $("#nFocus").onclick = () => { st.focus = id; load(); };
    $("#nZoom").onclick = () => focusCamera(id, 0.2);
    $("#nA").onclick = () => { $("#pA").value = id; toast("مبدأ مسیر: " + a.label, "info"); };
    $("#nB").onclick = () => { $("#pB").value = id; toast("مقصد مسیر: " + a.label, "info"); };
    side.querySelectorAll(".row[data-n]").forEach((r) => (r.onclick = (ev) => { if (ev.altKey) return showEdge(r.dataset.e); select(r.dataset.n); focusCamera(r.dataset.n); }));
    const ss = await api(`/api/stories?entity=${encodeURIComponent(id)}&hours=${st.hours}&limit=15`).catch(() => []);
    const box = $("#gStories"); if (!box) return;
    box.innerHTML = ss.map((s) => `<div class="row" data-sid="${s.id}"><span class="bar" style="background:${s.color}"></span><div style="flex:1;min-width:0"><div class="t">${esc(s.title_fa || s.title)}</div><div class="m">${catChip(s.category)}<span class="num">${fa(s.source_count)} منبع</span>${verTag(s.verification)}<span class="dim">${ago(s.last_update)}</span></div></div></div>`).join("") || '<div class="empty small">داستانی در این بازه نیست</div>';
    box.onclick = (e) => { const r = e.target.closest("[data-sid]"); if (r) location.hash = "#/stories/" + r.dataset.sid; };
  }
  async function showEdge(e) {
    if (!graph.hasEdge(e)) return;
    const a = graph.getEdgeAttributes(e), [s, t] = graph.extremities(e);
    const sn = graph.getNodeAttribute(s, "label"), tn = graph.getNodeAttribute(t, "label");
    st.selected = null; st.path = new Set([s, t]); st.pathEdges = new Set([[s, t].sort().join("|")]); renderer.refresh({ skipIndexation: true });
    const quotes = (a.evidence || []).filter((x) => x && typeof x === "object");
    const ids = (a.evidence || []).filter((x) => typeof x === "string");
    side.innerHTML = `<div class="side-h"><h2>${esc(sn)} ${a.typed ? `<span class="pred">${esc(a.predicate_fa)}</span>` : "⟷"} ${esc(tn)}</h2></div>
     <div class="small muted">${a.typed ? '<span class="ai-badge">✦ رابطه صریح استخراج‌شده با مدل زبانی</span>' : `هم‌آیی در ${fa(a.weight)} خبر`} · وزن ${fa(a.weight)}</div>
     ${quotes.length ? `<div class="h-sec">نقل‌قول‌های شاهد</div>${quotes.map((q) => `<blockquote class="quote">«${esc(q.quote)}»${q.story_id ? ` <a href="#/stories/${q.story_id}">داستان ←</a>` : ""}</blockquote>`).join("")}` : ""}
     <div class="h-sec">خبرهای شاهد</div><div class="list" id="ev">${ids.length ? '<div class="skel"></div>' : '<div class="empty small">—</div>'}</div>
     <div class="toolbar" style="margin-top:10px"><button class="btn sm" data-go="${esc(s)}">${esc(sn)}</button><button class="btn sm" data-go="${esc(t)}">${esc(tn)}</button></div>`;
    side.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { select(b.dataset.go); focusCamera(b.dataset.go); }));
    if (ids.length) {
      const arts = await Promise.all(ids.map((i) => api("/api/articles/" + i).catch(() => null)));
      const ev = $("#ev"); if (ev) ev.innerHTML = arts.filter(Boolean).map((x) => `<div class="row" onclick="location.hash='#/stories/${x.story_id}'"><div style="min-width:0"><div class="t">${esc(x.title_fa || x.title)}</div><div class="m">${esc(x.source_name)} · <time>${hhmm(x.published_at)}</time></div></div></div>`).join("") || '<div class="empty small">—</div>';
    }
  }

  // ---------- chrome ----------
  function legend() {
    const counts = {}; graph.forEachNode((_, a) => (counts[a.etype] = (counts[a.etype] || 0) + 1));
    if (st.colorBy === "community") {
      const cc = {}; Object.values(metrics.comm).forEach((c) => (cc[c] = (cc[c] || 0) + 1));
      const top = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 8);
      $("#gLegend").innerHTML = `<div class="lg-h">جوامع (Louvain)</div>${top.map(([c, n]) => { const lead = Object.keys(metrics.comm).filter((k) => metrics.comm[k] == c).sort((x, y) => (metrics.pr[y] || 0) - (metrics.pr[x] || 0))[0]; return `<div class="lg-i"><span class="sw" style="background:${COMM[c % COMM.length]}"></span>${esc(graph.getNodeAttribute(lead, "label"))}… <b class="num">${fa(n)}</b></div>`; }).join("")}`;
    } else {
      $("#gLegend").innerHTML = `<div class="lg-h">نوع موجودیت <span class="dim">(کلیک = فیلتر)</span></div>${Object.entries(TYPE).filter(([k]) => counts[k]).map(([k, [n, c]]) => `<button class="lg-i ${st.hiddenTypes.has(k) ? "off" : ""}" data-t="${k}"><span class="sw" style="background:${c}"></span>${n} <b class="num">${fa(counts[k])}</b></button>`).join("")}
      <div class="lg-i lg-e"><i class="ln typed"></i>رابطه نوع‌دار ✦</div><div class="lg-i lg-e"><i class="ln"></i>هم‌آیی</div>`;
      $("#gLegend").querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { const t = b.dataset.t; st.hiddenTypes.has(t) ? st.hiddenTypes.delete(t) : st.hiddenTypes.add(t); legend(); renderer.refresh({ skipIndexation: true }); stats(); }));
    }
  }
  function stats() {
    let vn = 0, ve = 0; graph.forEachNode((id, a) => visibleNode(id, a) && vn++);
    graph.forEachEdge((e, a, s, t) => visibleEdge(e, a) && !st.hiddenTypes.has(graph.getNodeAttribute(s, "etype")) && !st.hiddenTypes.has(graph.getNodeAttribute(t, "etype")) && ve++);
    $("#gStats").innerHTML = `<span><b class="num">${fa(vn)}</b> گره</span><span><b class="num">${fa(ve)}</b> لبه</span><span class="dim">ForceAtlas2 · Louvain · PageRank</span>`;
  }
  function fillPathSelects() {
    const opts = graph.mapNodes((id, a) => [id, a]).sort((x, y) => (metrics.pr[y[0]] || 0) - (metrics.pr[x[0]] || 0)).map(([id, a]) => `<option value="${esc(id)}">${esc(a.label)}</option>`).join("");
    $("#pA").innerHTML = opts; $("#pB").innerHTML = opts; if (graph.order > 1) $("#pB").selectedIndex = 1;
  }

  async function load() {
    $("#gLoad").classList.add("on");
    st.selected = null; st.hovered = null; st.path = null; st._nb = null;
    data = await api(`/api/graph?hours=${st.hours}&min_weight=1${st.focus ? "&focus=" + encodeURIComponent(st.focus) : ""}&limit=500`);
    await new Promise((r) => setTimeout(r, 16));
    build(); mount(); legend(); stats(); fillPathSelects();
    $("#gGexf").href = `/api/graph/export.gexf?hours=${st.hours}&min_weight=${st.minW}`;
    $("#gLoad").classList.remove("on");
    if (!graph.order) { side.innerHTML = '<h2>گراف دانش</h2><div class="empty">هنوز رابطه‌ای در این بازه ثبت نشده است. پس از اجرای خط لوله، گراف ساخته می‌شود.</div>'; return; }
    if (st.focus && graph.hasNode(st.focus)) { select(st.focus); setTimeout(() => focusCamera(st.focus, 0.8), 50); } else overview();
  }

  // ---------- controls ----------
  $("#gHours").onchange = (e) => { st.hours = +e.target.value; load(); };
  $("#gSize").onchange = (e) => { st.sizeBy = e.target.value; graph.forEachNode((id, a) => graph.setNodeAttribute(id, "size", nodeSize(id, a))); renderer.refresh(); };
  $("#gColor").onchange = (e) => { st.colorBy = e.target.value; graph.forEachNode((id, a) => graph.setNodeAttribute(id, "color", nodeColor(id, a))); legend(); renderer.refresh(); if (!st.selected) overview(); };
  $("#gW").oninput = (e) => { st.minW = +e.target.value; $("#gWv").textContent = fa(st.minW); renderer.refresh({ skipIndexation: true }); stats(); $("#gGexf").href = `/api/graph/export.gexf?hours=${st.hours}&min_weight=${st.minW}`; };
  $("#gTyped").onclick = (e) => { st.typedOnly = !st.typedOnly; e.currentTarget.classList.toggle("on", st.typedOnly); renderer.refresh({ skipIndexation: true }); stats(); };
  $("#gLbl").onclick = (e) => { st.edgeLabels = !st.edgeLabels; e.currentTarget.classList.toggle("on", st.edgeLabels); renderer.refresh({ skipIndexation: true }); };
  $("#gAll").onclick = () => { st.focus = null; if (location.hash.startsWith("#/graph/")) history.replaceState(null, "", "#/graph"); load(); };
  $("#zIn").onclick = () => renderer.getCamera().animatedZoom({ duration: 250 });
  $("#zOut").onclick = () => renderer.getCamera().animatedUnzoom({ duration: 250 });
  $("#zFit").onclick = () => renderer.getCamera().animatedReset({ duration: 350 });
  $("#gRelayout").onclick = () => layout(false);
  $("#gPng").onclick = () => {
    const { width, height } = renderer.getDimensions(), pr = devicePixelRatio || 1;
    const c = document.createElement("canvas"); c.width = width * pr; c.height = height * pr;
    const ctx = c.getContext("2d"); ctx.fillStyle = th.bg || "#151515"; ctx.fillRect(0, 0, c.width, c.height);
    renderer.refresh();
    const cv = renderer.getCanvases();
    ["edges", "nodes", "edgeLabels", "labels", "hovers", "hoverNodes", "mouse"].forEach((k) => cv[k] && k !== "mouse" && ctx.drawImage(cv[k], 0, 0, c.width, c.height));
    ctx.font = `600 ${13 * pr}px Vazirmatn`; ctx.fillStyle = th.muted; ctx.textAlign = "right"; ctx.direction = "rtl";
    ctx.fillText(`رصد · گراف دانش · ${new Date().toLocaleString("fa-IR")}`, c.width - 16 * pr, c.height - 14 * pr);
    c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `rasad-graph-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  };
  $("#pGo").onclick = async () => {
    const a = $("#pA").value, b = $("#pB").value; if (!a || !b || a === b) return toast("دو گره متفاوت انتخاب کنید", "warn");
    let p = null; try { p = L.shortestPath.bidirectional(simple, a, b); } catch {}
    if (!p) {
      const r = await api(`/api/path?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&hours=${Math.max(st.hours, 168)}`);
      p = (r.path || []).map((x) => x.id);
      if (p.length) toast("مسیر از گراف کامل سرور (بیرون از نمای فعلی): " + r.path.map((x) => x.name_fa || x.id).join(" ← "), "info");
    }
    if (!p || !p.length) return toast("مسیری بین این دو یافت نشد", "warn");
    st.selected = null; st.path = new Set(p); st.pathEdges = new Set(p.slice(1).map((x, i) => [p[i], x].sort().join("|")));
    renderer.refresh({ skipIndexation: true });
    const names = p.map((x) => (graph.hasNode(x) ? graph.getNodeAttribute(x, "label") : x));
    side.innerHTML = `<div class="side-h"><h2>کوتاه‌ترین مسیر · ${fa(p.length - 1)} گام</h2></div><div class="path-steps">${p.map((x, i) => `<div class="ps" data-n="${esc(x)}"><span class="num">${fa(i + 1)}</span>${esc(names[i])}</div>`).join('<div class="ps-arrow">↓</div>')}</div><p class="small muted">زنجیره ارتباط با کمترین واسطه در گراف هم‌آیی و روابط نوع‌دار. روی لبه‌های کهربایی کلیک کنید تا شواهد هر گام را ببینید.</p>`;
    side.querySelectorAll("[data-n]").forEach((r) => (r.onclick = () => graph.hasNode(r.dataset.n) && focusCamera(r.dataset.n)));
  };
  $("#pClr").onclick = () => { st.path = null; renderer.refresh({ skipIndexation: true }); overview(); };
  // search
  const q = $("#gQ"), sres = $("#gSres");
  q.oninput = () => {
    const v = q.value.trim().toLowerCase();
    if (!v) { st.search = null; sres.classList.remove("open"); renderer.refresh({ skipIndexation: true }); return; }
    const hits = graph.filterNodes((id, a) => (a.label || "").toLowerCase().includes(v) || (a.name_en || "").toLowerCase().includes(v)).slice(0, 12);
    st.search = new Set(hits); renderer.refresh({ skipIndexation: true });
    sres.innerHTML = hits.map((id) => `<div class="it" data-n="${esc(id)}"><span class="sw" style="background:${graph.getNodeAttribute(id, "color")}"></span>${esc(graph.getNodeAttribute(id, "label"))} <span class="dim small" dir="ltr">${esc(graph.getNodeAttribute(id, "name_en") || "")}</span></div>`).join("") || '<div class="it dim">موردی یافت نشد</div>';
    sres.classList.add("open");
  };
  q.onkeydown = (e) => { if (e.key === "Enter") sres.querySelector("[data-n]")?.click(); if (e.key === "Escape") { q.value = ""; q.oninput(); } };
  sres.onclick = (e) => { const it = e.target.closest("[data-n]"); if (!it) return; sres.classList.remove("open"); st.search = null; select(it.dataset.n); focusCamera(it.dataset.n, 0.25); };

  const onTheme = new MutationObserver(() => { th = TH(); if (renderer) { renderer.setSetting("labelColor", { color: th.text }); graph.forEachEdge((e, a) => !a.typed && graph.setEdgeAttribute(e, "color", th.edge)); } });
  onTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  await load();
  return () => { onTheme.disconnect(); try { fa2?.kill(); } catch {} try { renderer?.kill(); } catch {} view.style.padding = ""; };
}
