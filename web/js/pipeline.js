// Pipeline view: live agent graph, controls, approvals, step inspector, run replay
import { $, $$, esc, fa, ago, dt, hhmm, api, post, on, store, toast, STATUS_FA, MODE_FA, reducedMotion } from "./core.js";

const LAYERS = [
  { fa: "گردآوری", agents: ["scout", "ingestion", "extractor"] },
  { fa: "غنی‌سازی", agents: ["classifier", "entities", "dedup", "translator"] },
  { fa: "تحلیل", agents: ["storyline", "anomaly", "verifier"] },
  { fa: "خروجی و ارزیابی", agents: ["writer", "viz", "qa"] },
];
const W = 1000, H = 560, NW = 190, NH = 64;
const COLX = [790, 555, 320, 85]; // RTL: first layer on the right
const ROW0 = 130, ROWH = 100;

function layout(pipeline) {
  const pos = {};
  LAYERS.forEach((L, c) => L.agents.forEach((a, r) => { pos[a] = { x: COLX[c], y: ROW0 + r * ROWH + (4 - L.agents.length) * ROWH / 2 }; }));
  // any agent not in layers (future-proof)
  pipeline.filter((p) => !pos[p.name]).forEach((p, i) => { pos[p.name] = { x: 85 + i * 210, y: H - 70 }; });
  return pos;
}
const edgePath = (a, b) => {
  const x1 = a.x, y1 = a.y + NH / 2, x2 = b.x + NW, y2 = b.y + NH / 2;
  if (Math.abs(a.x - b.x) < 5) { // same column, vertical
    const xa = a.x + NW / 2; return `M${xa},${a.y + NH} L${xa},${b.y}`;
  }
  const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

export async function renderPipeline({ view, side, params }) {
  const offs = [];
  let pipeline = store.state?.pipeline || (await api("/api/state")).pipeline;
  const pos = layout(pipeline);
  const title = Object.fromEntries(pipeline.map((p) => [p.name, p]));
  let runs = [], run = null, steps = {}, selAgent = null, follow = !params[0], replayK = null;

  view.innerHTML = `<div class="pipe-wrap">
    <div class="pipe-controls" id="pc"></div>
    <svg class="pipe-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" id="psvg" role="img" aria-label="نمودار زنده خط لوله عامل‌ها"></svg>
    <div id="replay" style="display:flex;gap:10px;align-items:center;padding:6px 12px" class="small muted"></div>
  </div>`;
  const svg = $("#psvg", view);

  // ---------- static graph ----------
  const order = pipeline.map((p) => p.name);
  let g = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10z" fill="var(--line2)"/></marker></defs>`;
  LAYERS.forEach((L, c) => { g += `<text x="${COLX[c] + NW / 2}" y="${ROW0 - 30}" text-anchor="middle" class="sub" style="fill:var(--muted);font:600 12px Vazirmatn">${L.fa}</text>`; });
  // supervisor
  g += `<g class="node sup" id="n-supervisor" transform="translate(${W / 2 - 150},18)"><rect class="box" width="300" height="56" rx="12"/>
        <text x="150" y="24" text-anchor="middle">ناظر (Supervisor)</text><text x="150" y="43" text-anchor="middle" class="sub" id="supSub">—</text></g>`;
  for (let i = 0; i < order.length - 1; i++) g += `<path class="edge" id="e-${order[i + 1]}" d="${edgePath(pos[order[i]], pos[order[i + 1]])}" marker-end="url(#arr)"/>`;
  order.forEach((a) => {
    const p = pos[a], t = title[a];
    g += `<g class="node queued" id="n-${a}" data-a="${a}" transform="translate(${p.x},${p.y})" tabindex="0">
      <rect class="box" width="${NW}" height="${NH}" rx="12"/>
      <rect class="prog" x="10" y="${NH - 8}" width="0" height="3" rx="1.5" fill="var(--accent)"/>
      <circle class="sd" cx="${NW - 16}" cy="18" r="5" fill="var(--line2)"/>
      ${t.gate ? `<text x="16" y="22" class="sub" style="fill:var(--c-amber)">⛨</text>` : ""}
      <text x="${NW - 28}" y="23" text-anchor="start">${esc(t.title_fa)}</text>
      <text x="${NW - 16}" y="44" text-anchor="start" class="sub st">در صف</text></g>`;
  });
  g += `<g id="parts"></g>`;
  svg.innerHTML = g;
  svg.addEventListener("click", (e) => { const n = e.target.closest(".node[data-a]"); if (n) { selAgent = n.dataset.a; paint(); renderSide(); } });
  svg.addEventListener("keydown", (e) => { if (e.key === "Enter") { const n = e.target.closest(".node[data-a]"); if (n) { selAgent = n.dataset.a; paint(); renderSide(); } } });

  const SC = { queued: "var(--line2)", running: "var(--c-blue)", succeeded: "var(--c-green)", failed: "var(--c-coral)", awaiting_approval: "var(--c-amber)", skipped: "var(--muted)", rejected: "var(--c-coral)" };

  function viewSteps() {
    if (replayK == null) return steps;
    const seq = Object.values(steps).sort((a, b) => a.idx - b.idx);
    const out = {};
    seq.forEach((s, i) => { out[s.agent] = i < replayK ? s : i === replayK ? { ...s, status: "running", progress: 0.5 } : { ...s, status: "queued", progress: 0 }; });
    return out;
  }

  function paint() {
    const vs = viewSteps();
    const parts = $("#parts", svg); let ph = "";
    order.forEach((a) => {
      const s = vs[a] || { status: "queued", progress: 0 };
      const n = $(`#n-${a}`, svg);
      n.setAttribute("class", `node ${s.status}${selAgent === a ? " sel" : ""}`);
      $(".sd", n).setAttribute("fill", SC[s.status] || "var(--line2)");
      const prog = s.status === "running" ? Math.max(0.04, s.progress || 0) : s.status === "succeeded" ? 1 : 0;
      $(".prog", n).setAttribute("width", (NW - 20) * prog);
      let sub = STATUS_FA[s.status] || s.status;
      if (s.status === "succeeded" && s.output_summary) sub = s.output_summary;
      if (s.status === "running" && s.note) sub = s.note;
      if (s.status === "failed") sub = "خطا: " + (s.error || "");
      $(".st", n).textContent = sub.length > 27 ? sub.slice(0, 26) + "…" : sub;
      const e = $(`#e-${a}`, svg);
      if (e) {
        const live = s.status === "running" || s.status === "awaiting_approval";
        e.classList.toggle("live", live);
        if (live && !reducedMotion()) {
          const d = e.getAttribute("d");
          for (let k = 0; k < 3; k++) ph += `<circle class="particle" r="3.2"><animateMotion dur="1.6s" begin="${k * 0.53}s" repeatCount="indefinite" path="${d}"/></circle>`;
        }
      }
    });
    parts.innerHTML = ph;
    const st = store.state || {};
    $("#supSub", svg).textContent = `${MODE_FA[st.mode] || ""} · ${STATUS_FA[st.status] || st.status || ""}${st.killed ? " · کلید توقف فعال" : ""}`;
    $("#n-supervisor", svg).setAttribute("class", `node sup ${st.killed ? "failed" : st.status === "awaiting" ? "awaiting_approval" : st.status === "running" ? "running" : "succeeded"}`);
  }

  // ---------- controls ----------
  function renderControls() {
    const st = store.state || {}, busy = ["running", "awaiting", "paused"].includes(st.status);
    $("#pc", view).innerHTML = `
      <button class="btn primary" data-c="start" ${busy || st.killed ? "disabled" : ""}>▶ اجرای چرخه</button>
      ${st.status === "paused" ? `<button class="btn" data-c="resume">⏵ ادامه</button>` : `<button class="btn" data-c="pause" ${st.status !== "running" ? "disabled" : ""}>⏸ مکث</button>`}
      <button class="btn" data-c="takeover" ${st.mode === "manual" ? "disabled" : ""} title="بازگشت کنترل به انسان؛ حالت دستی">✋ تحویل کنترل</button>
      ${st.killed ? `<button class="btn danger solid" data-c="arm">⟲ فعال‌سازی</button>` : `<button class="btn danger" data-c="kill">⏻ توقف اضطراری</button>`}
      <span class="seg" id="intSeg" title="فاصله اجرای زمان‌بند">${[300, 600, 1800, 3600].map((s) => `<button data-s="${s}" class="${st.interval == s ? "on" : ""}">${fa(s / 60)} د</button>`).join("")}</span>`;
  }
  $("#pc", view).addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    try {
      if (b.dataset.s) { await post("/api/control", { action: "set_interval", seconds: +b.dataset.s }); toast("فاصله زمان‌بند به‌روز شد", "success"); return; }
      const c = b.dataset.c;
      if (c === "kill" && !confirm("همه اجراها فوراً متوقف و زمان‌بند غیرفعال می‌شود. ادامه؟")) return;
      if (c === "arm") { const v = prompt("برای فعال‌سازی مجدد عبارت ARM را تایپ کنید"); if (v !== "ARM") return; await post("/api/control", { action: "arm", confirm: "ARM" }); return; }
      if (c === "start") follow = true;
      await post("/api/control", { action: c });
    } catch (err) { toast(err.message, "error"); }
  });

  // ---------- side ----------
  async function renderSide() {
    const st = store.state || {};
    let h = "";
    if (st.pending) h += await approvalHtml(st.pending);
    if (selAgent) {
      const s = steps[selAgent], t = title[selAgent];
      h += `<h2>${esc(t.title_fa)} <span class="small dim" style="font-family:Inter">${selAgent}</span></h2><p class="small muted">${esc(t.role_fa || "")}</p>`;
      if (t.gate) h += `<p class="small" style="color:var(--c-amber)">⛨ دروازه تأیید انسانی: ${t.gate === "writer" ? "انتشار بریف" : "هشدارهای بحرانی"}</p>`;
      if (s) {
        h += `<dl class="kv"><dt>وضعیت</dt><dd><span class="dot ${s.status}"></span> ${STATUS_FA[s.status] || s.status}</dd>
          <dt>شروع</dt><dd>${s.started ? dt(s.started) : "—"}</dd><dt>مدت</dt><dd>${s.started && s.ended ? fa(Math.round((s.ended - s.started) * 10) / 10) + " ثانیه" : "—"}</dd>
          <dt>توکن LLM</dt><dd>${fa(s.tokens || 0)}</dd><dt>ورودی</dt><dd>${esc(s.input_summary || "—")}</dd><dt>خروجی</dt><dd>${esc(s.output_summary || "—")}</dd>
          ${s.edited_by_user ? `<dt>ویرایش</dt><dd>خروجی توسط کاربر ویرایش شد</dd>` : ""}</dl>`;
        if (s.reasoning) h += `<div class="h-sec">استدلال / توضیح عامل</div><p class="small" style="line-height:1.8">${esc(s.reasoning)}</p>`;
        if (s.error) h += `<div class="h-sec" style="color:var(--c-coral)">خطا</div><pre class="json">${esc(s.error)}</pre>`;
        h += `<div class="h-sec">خروجی ساخت‌یافته</div><pre class="json">${esc(JSON.stringify(s.output ?? null, null, 2)?.slice(0, 6000))}</pre>`;
      } else h += `<p class="muted small">این عامل در اجرای انتخاب‌شده اجرا نشده است.</p>`;
      const busy = ["running", "awaiting", "paused"].includes(st.status);
      h += `<div style="display:flex;gap:6px;margin-top:10px"><button class="btn" id="rerunBtn" ${busy || st.killed ? "disabled" : ""}>↻ اجرای مجدد فقط این عامل</button></div>`;
    } else if (!st.pending) {
      h += `<h2>خط لوله عامل‌ها</h2><p class="muted small" style="line-height:1.8">۱۳ عامل تخصصی زیر نظر ناظر. روی هر گره کلیک کنید تا ورودی، خروجی، استدلال و خطاها را ببینید. سطح اجرا: <b>${MODE_FA[st.mode] || ""}</b>. دروازه‌های تأیید: ${(st.gates || []).map((x) => x === "writer" ? "انتشار بریف" : "هشدار بحرانی").join("، ") || "—"}.</p>`;
    }
    h += `<div class="h-sec">تاریخچه اجراها</div><div class="list">${runs.map((r) => `<div class="row ${run && r.id === run.id ? "sel" : ""}" data-run="${r.id}">
      <span class="bar" style="background:${SC[r.status === "awaiting" ? "awaiting_approval" : r.status] || "var(--line2)"}"></span>
      <div style="flex:1;min-width:0"><div class="t small">${dt(r.started)} · ${esc(STATUS_FA[r.status] || r.status)}</div>
      <div class="m"><span>${esc(r.trigger || "")}</span><span>${MODE_FA[r.mode] || ""}</span>${r.ended ? `<span>${fa(Math.round(r.ended - r.started))} ث</span>` : ""}</div></div></div>`).join("") || '<div class="empty">هنوز اجرایی ثبت نشده</div>'}</div>`;
    side.innerHTML = h;
    $$("[data-run]", side).forEach((el) => el.addEventListener("click", () => { location.hash = `#/pipeline/${el.dataset.run}`; }));
    $("#rerunBtn", side)?.addEventListener("click", async () => { try { follow = true; await post(`/api/rerun/${selAgent}`); toast("اجرای مجدد آغاز شد", "info"); } catch (e) { toast(e.message, "error"); } });
    bindApproval();
  }

  async function approvalHtml(p) {
    const t = title[p.agent] || { title_fa: p.agent };
    let body = "";
    if (p.kind === "writer" && p.brief_id) {
      try { const b = await api(`/api/briefs/${p.brief_id}`); body = `<div class="h-sec">پیش‌نویس بریف (قابل ویرایش پیش از انتشار)</div><textarea id="apprMd" style="width:100%;min-height:260px;direction:rtl;font:13px/1.8 Vazirmatn;background:var(--panel2);color:var(--text);border:1px solid var(--line2);border-radius:8px;padding:8px">${esc(b.markdown || "")}</textarea>`; } catch {}
    } else if (p.kind === "alerts") {
      try { const sg = await api("/api/signals"); const items = sg.filter((x) => x.status === "pending").slice(0, 20); body = `<div class="h-sec">هشدارهای در انتظار</div>${(items || []).map((s) => `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><span class="tag ${s.severity}">${esc(s.severity)}</span> ${esc(s.label || s.type)}</div>`).join("") || '<p class="small muted">—</p>'}`; } catch {}
    } else body = `<p class="small muted">حالت دستی: پیش از اجرای این مرحله تأیید شما لازم است.</p>`;
    return `<div class="approval"><div style="font-weight:700;margin-bottom:6px">⛨ منتظر تأیید: ${esc(t.title_fa)} <span class="small muted">(${p.phase === "pre" ? "پیش از اجرا" : "پس از اجرا"})</span></div>${body}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" data-d="approve">✓ تأیید${p.kind === "writer" ? " و انتشار" : ""}</button><button class="btn danger" data-d="reject">✕ رد</button><button class="btn" data-d="skip">⤼ رد شدن از مرحله</button></div></div>`;
  }
  function bindApproval() {
    $$("[data-d]", side).forEach((b) => b.addEventListener("click", async () => {
      const p = store.state?.pending; if (!p) return;
      const md = $("#apprMd", side);
      const body = { decision: b.dataset.d };
      if (md && b.dataset.d === "approve" && md.value !== md.defaultValue) body.edited_output = md.value;
      try { const r = await post(`/api/steps/${p.step_id}/decision`, body); if (r.ok === false) toast(r.error, "warn"); else toast("تصمیم ثبت شد", "success"); } catch (e) { toast(e.message, "error"); }
    }));
  }

  // ---------- replay ----------
  function renderReplay() {
    const n = Object.keys(steps).length, el = $("#replay", view);
    if (!run || !n) { el.innerHTML = ""; return; }
    el.innerHTML = `<span>بازپخش اجرا</span><input type="range" min="0" max="${n}" value="${replayK ?? n}" id="rk" style="flex:1;accent-color:var(--accent)" aria-label="بازپخش مراحل اجرا">
      <span id="rkl">${replayK == null ? "زنده/نهایی" : `مرحله ${fa(replayK + 1)} از ${fa(n)}`}</span><button class="btn ghost" id="rkp">▶ پخش</button>`;
    $("#rk", el).addEventListener("input", (e) => { const v = +e.target.value; replayK = v >= n ? null : v; $("#rkl", el).textContent = replayK == null ? "زنده/نهایی" : `مرحله ${fa(replayK + 1)} از ${fa(n)}`; paint(); });
    $("#rkp", el).addEventListener("click", () => {
      let k = 0; clearInterval(timer);
      timer = setInterval(() => { replayK = k; $("#rk", el).value = k; $("#rkl", el).textContent = `مرحله ${fa(k + 1)} از ${fa(n)}`; paint(); if (++k > n) { clearInterval(timer); replayK = null; paint(); $("#rkl", el).textContent = "زنده/نهایی"; } }, 700);
    });
  }
  let timer = null;

  async function loadRun(id) {
    if (!id) { run = null; steps = {}; return; }
    run = await api(`/api/runs/${id}`);
    steps = Object.fromEntries((run.steps || []).map((s) => [s.agent, s]));
  }
  async function refresh() {
    const rr = await api("/api/runs?limit=25"); runs = rr.items || rr;
    const id = params[0] || store.state?.run_id || runs[0]?.id;
    await loadRun(id);
    renderControls(); paint(); renderReplay(); renderSide();
  }
  await refresh();

  // ---------- live ----------
  let sideT = null; const sideSoon = () => { clearTimeout(sideT); sideT = setTimeout(renderSide, 250); };
  offs.push(on("step", (ev) => {
    if (!run || ev.run_id !== run.id) return;
    steps[ev.agent] = { ...(steps[ev.agent] || {}), ...ev };
    paint();
    if (ev.status !== "running" || !steps[ev.agent]._seen) { steps[ev.agent]._seen = true; if (ev.status !== "running" || selAgent === ev.agent) sideSoon(); }
    if (["succeeded", "failed", "skipped"].includes(ev.status) && selAgent === ev.agent) api(`/api/runs/${run.id}`).then((r) => { const s = r.steps.find((x) => x.agent === ev.agent); if (s) { steps[ev.agent] = s; sideSoon(); } }).catch(() => {});
  }));
  offs.push(on("run", async (ev) => {
    if (ev.status === "running" && follow && !params[0]) { run = { id: ev.id }; steps = {}; replayK = null; paint(); }
    const rr = await api("/api/runs?limit=25"); runs = rr.items || rr;
    if (run && ev.id === run.id) await loadRun(run.id);
    paint(); renderReplay(); sideSoon();
  }));
  offs.push(on("state", () => { renderControls(); paint(); sideSoon(); }));
  return () => { offs.forEach((f) => f()); clearInterval(timer); clearTimeout(sideT); };
}
