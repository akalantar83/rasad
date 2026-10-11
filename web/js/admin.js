// Administration (users, sources, alert channels, system ops, audit) and analyst watchlists.
import { $, $$, esc, fa, ago, dt, hhmm, api, post, store, toast, modal, confirmDlg, bytes, can, LANG, catChip } from "./core.js";

const del = (p) => api(p, { method: "DELETE" });
const SEV_FA = { info: "اطلاع", warning: "هشدار", critical: "بحرانی" };
const ROLE_FA = { viewer: "بیننده", analyst: "تحلیلگر", admin: "مدیر" };
const ST_FA = { active: "فعال", pending: "در انتظار تأیید", quarantine: "قرنطینه", disabled: "غیرفعال" };
const opt = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const yes = (b) => (b ? '<span class="pill ok">فعال</span>' : '<span class="pill off">غیرفعال</span>');

const TABS = [
  ["users", "کاربران و نقش‌ها"], ["sources", "منابع خبری"], ["channels", "کانال‌های اعلان"], ["system", "سامانه و نگهداری"], ["audit", "ردپای ممیزی"],
];

export async function renderAdmin({ view, side, params }) {
  if (!can("admin")) { view.innerHTML = '<div class="empty">این بخش فقط برای نقش «مدیر» در دسترس است.</div>'; return; }
  const tab = TABS.some((t) => t[0] === params[0]) ? params[0] : "users";
  view.innerHTML = `<div class="page-h"><div><h1>مدیریت سامانه</h1><div class="muted small">کاربران، منابع، کانال‌های اعلان، پشتیبان‌گیری و ممیزی</div></div></div>
   <div class="tabs">${TABS.map(([k, v]) => `<a href="#/admin/${k}" class="${k === tab ? "on" : ""}">${v}</a>`).join("")}</div><div id="adm" class="fade-in"></div>`;
  const box = $("#adm");
  await ({ users, sources, channels, system, audit })[tab](box, side);
}

// ---------------- users ----------------
async function users(box, side) {
  const list = await api("/api/users");
  box.innerHTML = `<div class="card flush"><div class="card-h"><h3>کاربران <span class="badge">${fa(list.length)}</span></h3><span class="tb-spacer"></span><button class="btn primary sm" id="uAdd">＋ کاربر جدید</button></div>
   <table class="t"><thead><tr><th>کاربر</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>ایجاد</th><th></th></tr></thead><tbody>
   ${list.map((u) => `<tr><td><div class="who"><span class="avatar r-${u.role}">${esc((u.name || u.username).slice(0, 1).toUpperCase())}</span><div><b>${esc(u.name)}</b><div class="small dim" dir="ltr" style="text-align:right">@${esc(u.username)}</div></div></div></td>
     <td><select data-role="${u.id}" ${u.id === store.user?.id ? "disabled" : ""}>${opt(ROLE_FA, u.role)}</select></td><td>${yes(u.active)}</td><td class="small">${u.last_login ? ago(u.last_login) : "—"}</td><td class="small dim">${u.created ? dt(u.created) : "—"}</td>
     <td class="act"><button class="btn ghost sm" data-pw="${u.id}">بازنشانی رمز</button>${u.id !== store.user?.id ? `<button class="btn ghost sm" data-act="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? "تعلیق" : "فعال‌سازی"}</button><button class="btn ghost sm danger" data-del="${u.id}">حذف</button>` : '<span class="small dim">شما</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  side.innerHTML = `<h2>نقش‌ها و دسترسی</h2><div class="role-doc"><div><span class="avatar r-viewer">ب</span><b>بیننده</b><p>مشاهده داشبورد، گراف، داستان‌ها، بریف‌ها و پرسش از دستیار.</p></div>
   <div><span class="avatar r-analyst">ت</span><b>تحلیلگر</b><p>به‌علاوه: تأیید/رد دروازه‌های انسانی، ویرایش بریف، تعریف فهرست پایش، بازخورد.</p></div>
   <div><span class="avatar r-admin">م</span><b>مدیر</b><p>به‌علاوه: کنترل اجرا (حالت، توقف اضطراری)، منابع، کاربران، کانال‌های اعلان، تنظیمات مدل، پشتیبان و ممیزی.</p></div></div>
   <div class="h-sec">امنیت</div><div class="small muted" style="line-height:1.9">رمزها با PBKDF2-SHA256 (۲۰۰هزار تکرار) ذخیره می‌شوند · کوکی نشست HttpOnly/SameSite · قفل موقت پس از ۵ تلاش ناموفق در ۵ دقیقه · تعلیق یا تغییر رمز همه نشست‌های کاربر را می‌بندد.</div>`;
  const reload = () => users(box, side);
  $("#uAdd").onclick = async () => {
    const v = await modal({ title: "کاربر جدید", submit: "ایجاد کاربر", body: `<div class="form"><label>نام کاربری<input name="username" type="text" dir="ltr" placeholder="analyst1"></label><label>نام نمایشی<input name="name" type="text"></label><label>نقش<select name="role">${opt(ROLE_FA, "analyst")}</select></label><label>رمز اولیه<input name="password" type="password" dir="ltr" autocomplete="new-password"></label></div>`,
      onOpen: (f) => (f._validate = async (x) => { try { await post("/api/users", x); } catch (e) { return e.message; } }) });
    if (v) { toast("کاربر ایجاد شد", "success"); reload(); }
  };
  box.onchange = async (e) => { const s = e.target.closest("[data-role]"); if (!s) return; try { await post(`/api/users/${s.dataset.role}`, { role: s.value }); toast("نقش به‌روز شد", "success"); } catch (er) { toast(er.message, "error"); reload(); } };
  box.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pw) { const v = await modal({ title: "بازنشانی رمز", submit: "ثبت رمز جدید", body: `<div class="form"><label>رمز جدید<input name="password" type="password" dir="ltr" autocomplete="new-password"></label></div><p class="small dim">نشست‌های فعلی کاربر بسته می‌شود.</p>`, onOpen: (f) => (f._validate = async (x) => { try { await post(`/api/users/${b.dataset.pw}`, x); } catch (er) { return er.message; } }) }); if (v) toast("رمز بازنشانی شد", "success"); }
    if (b.dataset.act) { try { await post(`/api/users/${b.dataset.act}`, { active: b.dataset.v === "1" }); reload(); } catch (er) { toast(er.message, "error"); } }
    if (b.dataset.del && (await confirmDlg("حذف کاربر", "این کاربر و همه نشست‌هایش حذف می‌شود. ادامه؟", "حذف"))) { try { await del(`/api/users/${b.dataset.del}`); toast("کاربر حذف شد", "success"); reload(); } catch (er) { toast(er.message, "error"); } }
  };
}

// ---------------- sources ----------------
function sourceForm(s = {}) {
  const m = s.meta || {};
  return `<div class="form two">
   <label class="full">آدرس فید (RSS/Atom)<input name="url" type="text" dir="ltr" value="${esc(s.url || "")}" placeholder="https://example.com/rss.xml"></label>
   <label>نام منبع<input name="name" type="text" value="${esc(s.name || "")}" placeholder="از عنوان فید پر می‌شود"></label>
   <label>زبان<select name="lang">${opt({ fa: "فارسی", ar: "عربی", en: "انگلیسی", other: "سایر" }, s.lang || "en")}</select></label>
   <label>نوع<select name="kind" ${s.id ? "disabled" : ""}>${opt({ rss: "RSS / Atom", gdelt: "GDELT DOC API" }, m.kind || "rss")}</select></label>
   <label>پرس‌وجوی GDELT<input name="query" type="text" dir="ltr" value="${esc(m.query || "")}" placeholder="(Iran OR Hormuz) sourcelang:eng"></label>
   <label>کشور<input name="country" type="text" value="${esc(s.country || "")}" placeholder="IR / GB / QA"></label>
   <label>گروه مالکیت<input name="ownership_group" type="text" value="${esc(s.ownership_group || "")}" placeholder="برای سنجش استقلال منابع"></label>
   <label>اعتبار (۰ تا ۱)<input name="credibility" type="text" dir="ltr" value="${s.credibility ?? 0.6}"></label>
   <label>نوع رسانه<select name="type">${opt({ news: "خبرگزاری/رسانه", agency: "خبرگزاری بین‌المللی", gov: "دولتی/رسمی", think_tank: "اندیشکده", social: "شبکه اجتماعی", other: "سایر" }, s.type || "news")}</select></label>
   <label class="full">صفحه اصلی<input name="homepage" type="text" dir="ltr" value="${esc(s.homepage || "")}"></label>
   ${s.id ? "" : '<label class="chk full"><input name="activate" type="checkbox"> در صورت اعتبارسنجی موفق، بی‌درنگ فعال شود (در غیر این صورت «در انتظار تأیید» می‌ماند)</label>'}
   </div><div class="toolbar" style="margin-top:10px"><button type="button" class="btn sm" id="sVal">⟲ اعتبارسنجی فید</button><span class="small" id="sValR"></span></div>`;
}
function bindValidate(f) {
  f.querySelector("#sVal").onclick = async () => {
    const r = $("#sValR"); r.innerHTML = '<span class="dim">در حال دریافت فید…</span>';
    try {
      const x = await post("/api/sources/validate", { url: f.url.value, kind: f.kind.value, query: f.query.value });
      r.innerHTML = x.ok ? `<span class="ok-t">✓ معتبر · ${fa(x.entries ?? 0)} مدخل</span> <span class="dim">${esc(x.title || "")}</span>${(x.sample || []).length ? `<div class="sample">${x.sample.map((t) => `<div>• ${esc(t)}</div>`).join("")}</div>` : ""}` : `<span class="err">✕ نامعتبر: ${esc(x.error || "HTTP " + (x.status || "?") + " · مدخلی یافت نشد")}</span>`;
      if (x.ok && x.title && !f.name.value) f.name.value = x.title;
    } catch (e) { r.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
}
async function sources(box, side) {
  const { sources: list } = await api("/api/sources");
  const by = (st) => list.filter((s) => s.status === st).length;
  box.innerHTML = `<div class="grid kpis4"><div class="card kpi"><div class="l">فعال</div><div class="v ok-t">${fa(by("active"))}</div></div><div class="card kpi"><div class="l">در انتظار تأیید</div><div class="v warn-t">${fa(by("pending"))}</div></div><div class="card kpi"><div class="l">قرنطینه</div><div class="v err">${fa(by("quarantine"))}</div></div><div class="card kpi"><div class="l">غیرفعال</div><div class="v dim">${fa(by("disabled"))}</div></div></div>
   <div class="card flush" style="margin-top:var(--gap)"><div class="card-h"><h3>منابع <span class="badge">${fa(list.length)}</span></h3><input type="text" id="sFilter" placeholder="فیلتر…" style="width:180px"><span class="tb-spacer"></span>
   <a class="btn sm" href="/api/sources/export.opml" download>⇩ خروجی OPML</a><button class="btn sm" id="sImp">⇧ ورود OPML</button><button class="btn primary sm" id="sAdd">＋ منبع جدید</button></div>
   <div style="overflow:auto"><table class="t" id="sTbl"><thead><tr><th>منبع</th><th>زبان</th><th>نوع</th><th>اعتبار</th><th>خبر ۲۴س</th><th>کیفیت</th><th>وضعیت</th><th>آخرین دریافت</th><th></th></tr></thead><tbody>
   ${list.map((s) => `<tr data-q="${esc((s.name + " " + s.url + " " + s.id).toLowerCase())}"><td><b>${esc(s.name)}</b>${s.meta?.origin === "ui" ? ' <span class="chip">افزوده دستی</span>' : ""}<div class="small dim ltr-r">${esc(s.url || "")}</div>${s.last_error ? `<div class="small err ltr-r">${esc(s.last_error.slice(0, 90))}</div>` : ""}</td>
    <td><span class="tag lang">${LANG[s.lang] || s.lang}</span></td><td class="small">${esc(s.meta?.kind || "rss")}</td><td class="num">${fa(Math.round((s.credibility || 0) * 100))}</td><td class="num">${fa(s.items_24h)}</td><td class="num">${fa(Math.round((s.extract_q || 0) * 100))}٪</td>
    <td><span class="dot ${s.status}"></span> ${ST_FA[s.status] || s.status}${s.fail_count ? ` <span class="small err">(${fa(s.fail_count)})</span>` : ""}</td><td class="small dim">${s.last_fetch ? ago(s.last_fetch) : "—"}</td>
    <td class="act"><button class="btn ghost sm" data-edit="${esc(s.id)}">ویرایش</button>${s.status === "active" ? `<button class="btn ghost sm" data-st="${esc(s.id)}" data-v="disabled">غیرفعال</button>` : `<button class="btn ghost sm" data-st="${esc(s.id)}" data-v="active">فعال‌سازی</button>`}<button class="btn ghost sm danger" data-del="${esc(s.id)}">حذف</button></td></tr>`).join("")}</tbody></table></div></div>`;
  side.innerHTML = `<h2>مدیریت منابع</h2><p class="small muted" style="line-height:1.9">منابع افزوده‌شده پس از اعتبارسنجی (دریافت واقعی فید و شمارش مدخل‌ها) ذخیره می‌شوند و به‌طور پیش‌فرض در وضعیت «در انتظار تأیید» می‌مانند تا مدیر فعالشان کند. حذف منبعی که خبر ثبت‌شده دارد، آن را برای حفظ ردپا فقط غیرفعال می‌کند.</p>
   <div class="h-sec">قواعد سلامت</div><div class="small muted" style="line-height:1.9">• درخواست شرطی ETag/Last-Modified و رعایت robots.txt<br>• قرنطینه خودکار پس از ۵ خطای پیاپی<br>• منابع هم‌گروه مالکیتی در راستی‌آزمایی «مستقل» شمرده نمی‌شوند</div>
   <div class="h-sec">OPML</div><div class="small muted">برای انتقال منابع به/از Feedly، Inoreader یا نمونه دیگری از رصد.</div>`;
  const reload = () => sources(box, side);
  $("#sFilter").oninput = (e) => { const v = e.target.value.toLowerCase(); $$("#sTbl tbody tr").forEach((tr) => (tr.style.display = tr.dataset.q.includes(v) ? "" : "none")); };
  $("#sAdd").onclick = async () => {
    const v = await modal({ title: "افزودن منبع خبری", submit: "ذخیره منبع", wide: true, body: sourceForm(), onOpen: (f) => { bindValidate(f); f._validate = async (x) => { try { const r = await post("/api/sources", { ...x, credibility: +x.credibility, check: true }); f._r = r; } catch (e) { return e.message; } }; } });
    if (v) { toast("منبع ذخیره شد", "success"); reload(); }
  };
  $("#sImp").onclick = async () => {
    const v = await modal({ title: "ورود منابع از OPML", submit: "ورود", wide: true, body: `<div class="form"><label class="full">فایل OPML<input type="file" id="opF" accept=".opml,.xml,text/xml"></label><label class="full">یا متن OPML را بچسبانید<textarea name="opml" rows="8" dir="ltr" style="min-height:160px"></textarea></label><label>زبان پیش‌فرض<select name="lang">${opt({ "": "تشخیص/سایر", fa: "فارسی", ar: "عربی", en: "انگلیسی" }, "")}</select></label></div><p class="small dim">منابع واردشده در وضعیت «در انتظار تأیید» قرار می‌گیرند.</p>`,
      onOpen: (f) => { $("#opF").onchange = async (e) => { const file = e.target.files[0]; if (file) f.opml.value = await file.text(); }; f._validate = async (x) => { try { f._r = await post("/api/sources/import", { opml: x.opml, lang: x.lang || null }); toast(`${fa(f._r.added.length)} منبع افزوده شد · ${fa(f._r.skipped)} تکراری`, "success"); } catch (e) { return e.message; } }; } });
    if (v) reload();
  };
  box.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.edit) {
      const s = list.find((x) => x.id === b.dataset.edit);
      const v = await modal({ title: "ویرایش منبع · " + s.name, submit: "ذخیره تغییرات", wide: true, body: sourceForm(s), onOpen: (f) => { bindValidate(f); f._validate = async (x) => { delete x.kind; try { await post(`/api/sources/${encodeURIComponent(s.id)}`, { ...x, credibility: +x.credibility }); } catch (er) { return er.message; } }; } });
      if (v) { toast("منبع به‌روز شد", "success"); reload(); }
    }
    if (b.dataset.st) { await post(`/api/sources/${encodeURIComponent(b.dataset.st)}/status`, { status: b.dataset.v }); toast("وضعیت منبع تغییر کرد", "success"); reload(); }
    if (b.dataset.del && (await confirmDlg("حذف منبع", "اگر این منبع خبر ثبت‌شده داشته باشد، فقط غیرفعال می‌شود. ادامه؟", "حذف"))) { const r = await del(`/api/sources/${encodeURIComponent(b.dataset.del)}`); toast(r.deleted ? "منبع حذف شد" : "منبع دارای سابقه بود و غیرفعال شد", "success"); reload(); }
  };
}

// ---------------- notification channels ----------------
const CH_FIELDS = {
  telegram: [["bot_token", "توکن ربات", "password", "123456:ABC…"], ["chat_id", "شناسه چت/کانال", "text", "@my_channel یا -100…"]],
  webhook: [["url", "آدرس وب‌هوک", "password", "https://hooks.slack.com/…"], ["header_name", "سرآیند اختیاری (نام)", "text", "Authorization"], ["header_value", "سرآیند اختیاری (مقدار)", "text", "Bearer …"]],
  email: [["host", "سرور SMTP", "text", "smtp.example.com"], ["port", "پورت", "text", "587"], ["user", "نام کاربری SMTP", "text", ""], ["password", "رمز SMTP", "password", ""], ["sender", "فرستنده", "text", "rasad@example.com"], ["to", "گیرندگان (با ویرگول)", "text", "team@example.com"], ["starttls", "STARTTLS", "select", { "1": "بله", "0": "خیر" }]],
};
const SIG_TYPES = { volume_spike: "جهش حجم موضوع", entity_spike: "جهش اشاره به بازیگر", new_actor: "بازیگر نوظهور", fast_spread: "گسترش سریع", watch: "فهرست پایش" };
function channelForm(c = {}) {
  const typ = c.type || "telegram", cfg = c.config || {};
  const fields = (t) => CH_FIELDS[t].map(([k, l, ty, ph]) => ty === "select" ? `<label>${l}<select name="cfg_${k}">${opt(ph, String(cfg[k] === true ? "1" : cfg[k] === false ? "0" : cfg[k] ?? Object.keys(ph)[0]))}</select></label>`
    : `<label>${l}<input name="cfg_${k}" type="${ty}" dir="ltr" value="${esc(ty === "password" ? "" : cfg[k] ?? "")}" placeholder="${esc(ty === "password" && c.secrets_set?.includes(k) ? cfg[k] + " (برای حفظ، خالی بگذارید)" : ph)}" autocomplete="off"></label>`).join("");
  return `<div class="form two"><label>نام کانال<input name="name" type="text" value="${esc(c.name || "")}" placeholder="مثلاً: تیم تحلیل"></label>
   <label>نوع<select name="type" id="chType" ${c.id ? "disabled" : ""}>${opt({ telegram: "تلگرام", webhook: "وب‌هوک (JSON/Slack)", email: "ایمیل (SMTP)" }, typ)}</select></label>
   <div class="full form two" id="chFields">${fields(typ)}</div>
   <label>حداقل شدت هشدار<select name="min_severity">${opt(SEV_FA, c.min_severity || "warning")}</select></label>
   <label>انواع سیگنال (خالی = همه)<select name="signal_types" multiple size="4">${Object.entries(SIG_TYPES).map(([k, v]) => `<option value="${k}" ${(c.signal_types || []).includes(k) ? "selected" : ""}>${v}</option>`).join("")}</select></label>
   <label class="chk"><input name="briefs" type="checkbox" ${c.briefs !== false ? "checked" : ""}> ارسال بریف‌های منتشرشده</label>
   <label class="chk"><input name="enabled" type="checkbox" ${c.enabled !== false ? "checked" : ""}> کانال فعال باشد</label></div>`;
  // (fields re-rendered on type change in onOpen)
}
function packChannel(x) {
  const config = {};
  for (const [k, v] of Object.entries(x)) if (k.startsWith("cfg_")) { const kk = k.slice(4); config[kk] = kk === "port" ? (+v || undefined) : kk === "starttls" ? v === "1" : v; }
  return { name: x.name, type: x.type, config, min_severity: x.min_severity, signal_types: x.signal_types || [], briefs: x.briefs, enabled: x.enabled };
}
async function channels(box, side) {
  const [{ channels: list }, dels, dg] = await Promise.all([api("/api/notify/channels"), api("/api/notify/deliveries?limit=60"), api("/api/notify/digest")]);
  const ICON = { telegram: "✈", webhook: "⌁", email: "✉" };
  box.innerHTML = `<div class="card-h bare"><h3>کانال‌ها <span class="badge">${fa(list.length)}</span></h3><span class="tb-spacer"></span><button class="btn primary sm" id="cAdd">＋ کانال جدید</button></div>
   <div class="grid cards3">${list.map((c) => `<div class="card ch-card ${c.enabled ? "" : "is-off"}"><div class="ch-top"><span class="ch-ic t-${c.type}">${ICON[c.type] || "•"}</span><div style="min-width:0;flex:1"><b>${esc(c.name)}</b><div class="small dim">${esc(c.type_fa)}</div></div>${yes(c.enabled)}</div>
     <div class="kv small" style="margin:10px 0"><dt>حداقل شدت</dt><dd>${SEV_FA[c.min_severity]}</dd><dt>سیگنال‌ها</dt><dd>${c.signal_types.length ? c.signal_types.map((t) => SIG_TYPES[t] || t).join("، ") : "همه"}</dd><dt>بریف</dt><dd>${c.briefs ? "بله" : "خیر"}</dd>${Object.entries(c.config).filter(([k]) => !["starttls", "port", "header_value"].includes(k)).slice(0, 2).map(([k, v]) => `<dt>${esc(k)}</dt><dd dir="ltr" style="text-align:right">${esc(String(v))}</dd>`).join("")}</div>
     <div class="toolbar" style="margin:0"><button class="btn sm" data-test="${c.id}">ارسال آزمایشی</button><button class="btn ghost sm" data-edit="${c.id}">ویرایش</button><button class="btn ghost sm danger" data-del="${c.id}">حذف</button></div></div>`).join("") || '<div class="card empty">هنوز کانالی تعریف نشده است. هشدارهای بحرانی و بریف‌ها را به تلگرام، Slack/وب‌هوک یا ایمیل بفرستید.</div>'}</div>
   <div class="card digest" style="margin-top:var(--gap)"><div class="card-h bare"><h3>خلاصه روزانه زمان‌بندی‌شده</h3>${yes(dg.config.enabled)}<span class="tb-spacer"></span><span class="small dim">آخرین ارسال: ${dg.last ? ago(dg.last.t) + " · " + fa(dg.last.sent) + " کانال" : "—"}</span></div>
    <div class="dg-grid"><div class="form"><label class="chk"><input type="checkbox" id="dgOn" ${dg.config.enabled ? "checked" : ""}> ارسال خودکار روزانه به کانال‌هایی که «ارسال بریف» دارند</label>
     <label>ساعت ارسال (${esc(dg.tz)})<select id="dgH">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === dg.config.hour ? "selected" : ""}>${fa(h)}:۰۰</option>`).join("")}</select></label>
     <label>بازه پوشش<select id="dgW">${[[12, "۱۲ ساعت"], [24, "۲۴ ساعت"], [48, "۴۸ ساعت"], [168, "۷ روز"]].map(([v, l]) => `<option value="${v}" ${v === dg.config.hours ? "selected" : ""}>${l}</option>`).join("")}</select></label>
     <label>تعداد داستان برتر<select id="dgT">${[5, 8, 10, 15].map((v) => `<option ${v === dg.config.top ? "selected" : ""}>${v}</option>`).join("")}</select></label>
     <div class="toolbar" style="margin:4px 0 0"><button class="btn primary sm" id="dgSave">ذخیره زمان‌بندی</button><button class="btn sm" id="dgSend">ارسال اکنون</button></div></div>
     <div><div class="small muted" style="margin-bottom:4px">پیش‌نمایش پیام</div><pre class="dg-prev">${esc(dg.preview)}</pre></div></div></div>
   <div class="card flush" style="margin-top:var(--gap)"><div class="card-h"><h3>تاریخچه ارسال</h3></div><table class="t"><thead><tr><th>زمان</th><th>کانال</th><th>عنوان</th><th>نتیجه</th></tr></thead><tbody>
   ${dels.map((d) => `<tr><td class="small"><time>${dt(d.ts)}</time></td><td class="small">${esc(d.channel_name || "#" + d.channel_id)}</td><td>${esc(d.title || d.ref)}</td><td>${d.ok ? '<span class="pill ok">ارسال شد</span>' : `<span class="pill err" title="${esc(d.error || "")}">خطا</span> <span class="small dim">${esc((d.error || "").slice(0, 70))}</span>`}</td></tr>`).join("") || '<tr><td colspan="4" class="empty small">ارسالی ثبت نشده</td></tr>'}</tbody></table></div>`;
  side.innerHTML = `<h2>اعلان‌ها</h2><p class="small muted" style="line-height:1.9">پس از هر اجرا، سیگنال‌های جدید یا تأییدشده (۲۴ ساعت اخیر) طبق قواعد هر کانال ارسال می‌شوند؛ هر مورد فقط یک‌بار به هر کانال می‌رود. بریف‌ها پس از تأیید در دروازه انسانی ارسال می‌شوند.</p><div class="h-sec">محرمانگی</div><div class="small muted">توکن‌ها، رمزها و آدرس‌های وب‌هوک فقط‌نوشتنی‌اند و در API با «•••» پوشانده می‌شوند.</div>`;
  const reload = () => channels(box, side);
  const open = async (c) => modal({ title: c ? "ویرایش کانال · " + c.name : "کانال اعلان جدید", submit: c ? "ذخیره" : "ایجاد کانال", wide: true, body: channelForm(c || {}),
    onOpen: (f) => {
      const t = f.querySelector("#chType");
      t.onchange = () => { const tmp = document.createElement("div"); tmp.innerHTML = channelForm({ type: t.value }); f.querySelector("#chFields").innerHTML = tmp.querySelector("#chFields").innerHTML; };
      f._validate = async (x) => { if (c) x.type = c.type; try { await post(c ? `/api/notify/channels/${c.id}` : "/api/notify/channels", packChannel(x)); } catch (e) { return e.message; } };
    } });
  $("#cAdd").onclick = async () => { if (await open(null)) { toast("کانال ایجاد شد", "success"); reload(); } };
  $("#dgSave").onclick = async () => { try { await post("/api/notify/digest", { enabled: $("#dgOn").checked, hour: +$("#dgH").value, hours: +$("#dgW").value, top: +$("#dgT").value }); toast("زمان‌بندی خلاصه روزانه ذخیره شد", "success"); reload(); } catch (e) { toast(e.message, "error"); } };
  $("#dgSend").onclick = async (e) => { e.target.disabled = true; const r = await post("/api/notify/digest/send"); toast(r.sent ? `خلاصه به ${fa(r.sent)} کانال ارسال شد` : "کانال فعالی با «ارسال بریف» وجود ندارد یا ارسال ناموفق بود", r.sent ? "success" : "warn"); reload(); };
  box.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.test) { b.disabled = true; b.textContent = "در حال ارسال…"; const r = await post(`/api/notify/channels/${b.dataset.test}/test`).catch((er) => ({ ok: false, error: er.message })); toast(r.ok ? "پیام آزمایشی ارسال شد ✓" : "ارسال ناموفق: " + (r.error || ""), r.ok ? "success" : "error"); reload(); }
    if (b.dataset.edit && (await open(list.find((c) => c.id === +b.dataset.edit)))) { toast("کانال به‌روز شد", "success"); reload(); }
    if (b.dataset.del && (await confirmDlg("حذف کانال", "این کانال و قواعد مسیریابی آن حذف می‌شود.", "حذف"))) { await del(`/api/notify/channels/${b.dataset.del}`); reload(); }
  };
}

// ---------------- system ----------------
async function system(box, side) {
  const [info, backups] = await Promise.all([api("/api/system/info"), api("/api/system/backups")]);
  const up = info.uptime_s, upTxt = up > 86400 ? fa(Math.floor(up / 86400)) + " روز" : up > 3600 ? fa(Math.floor(up / 3600)) + " ساعت" : fa(Math.floor(up / 60)) + " دقیقه";
  const C = info.counts || {};
  box.innerHTML = `<div class="grid kpis4"><div class="card kpi"><div class="l">نسخه</div><div class="v num">${esc(info.version)}</div><div class="d">زمان کارکرد ${upTxt}</div></div>
   <div class="card kpi"><div class="l">حجم پایگاه داده</div><div class="v">${bytes(info.db_size)}</div><div class="d">WAL ${bytes(info.wal_size)}</div></div>
   <div class="card kpi"><div class="l">خبرها / داستان‌ها</div><div class="v">${fa(C.articles)} <span class="small dim">/ ${fa(C.stories)}</span></div><div class="d">${fa(C.entities)} موجودیت · ${fa(C.relations)} رابطه</div></div>
   <div class="card kpi"><div class="l">آخرین پشتیبان</div><div class="v" style="font-size:18px">${info.last_backup ? ago(info.last_backup.t || info.last_backup) : "—"}</div><div class="d">نگهداری ${fa(info.backup_keep)} نسخه</div></div></div>
   <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:var(--gap)">
    <div class="card flush"><div class="card-h"><h3>پشتیبان‌ها</h3><span class="tb-spacer"></span><button class="btn primary sm" id="bkNow">＋ پشتیبان‌گیری اکنون</button></div>
     <table class="t"><thead><tr><th>فایل</th><th>حجم</th><th>زمان</th><th></th></tr></thead><tbody>${backups.map((b) => `<tr><td class="small ltr-r num">${esc(b.file)}</td><td class="small">${bytes(b.size)}</td><td class="small">${dt(b.t)}</td><td class="act"><a class="btn ghost sm" href="/api/system/backups/${encodeURIComponent(b.file)}" download>⇩ دانلود</a></td></tr>`).join("") || '<tr><td colspan="4" class="empty small">هنوز پشتیبانی گرفته نشده است (پشتیبان خودکار روزانه فعال است).</td></tr>'}</tbody></table></div>
    <div class="grid" style="align-content:start">
     <div class="card"><h3>نگهداری داده</h3><div class="small muted" style="margin-bottom:8px">خبرها، سیگنال‌ها و فراخوانی‌های مدل قدیمی‌تر از این بازه در نگهداری روزانه پاک می‌شوند.</div>
      <div class="toolbar" style="margin:0"><input type="text" id="retD" value="${fa(info.retention_days)}" style="width:80px;text-align:center"><span class="small">روز</span><button class="btn sm" id="retSave">ذخیره</button><span class="tb-spacer"></span><button class="btn sm danger" id="purge">پاک‌سازی اکنون</button></div>
      <div class="small dim" style="margin-top:6px">آخرین پاک‌سازی: ${info.last_purge ? ago(info.last_purge.t || info.last_purge) : "—"}</div></div>
     <div class="card"><h3>خروجی‌ها و پایش</h3><div class="exp-grid">
      <a class="exp" href="/api/export/stories.csv?hours=168" download><b>CSV</b>داستان‌ها · ۷ روز</a><a class="exp" href="/api/export/articles.csv?hours=48" download><b>CSV</b>خبرها · ۴۸ ساعت</a>
      <a class="exp" href="/api/graph/export.gexf?hours=168" download><b>GEXF</b>گراف دانش (Gephi)</a><a class="exp" href="/api/sources/export.opml" download><b>OPML</b>فهرست منابع</a>
      <a class="exp" href="/metrics" target="_blank"><b>Prom</b>متریک‌های Prometheus</a><a class="exp" href="/healthz" target="_blank"><b>Health</b>بررسی سلامت</a></div></div>
    </div></div>
   <div class="card" style="margin-top:var(--gap)"><h3>شمارش جداول</h3><div class="count-grid">${Object.entries(C).map(([k, v]) => `<div><span class="num">${fa(v)}</span><small>${esc(k)}</small></div>`).join("")}</div></div>`;
  side.innerHTML = `<h2>سامانه</h2><div class="kv small"><dt>پایگاه داده</dt><dd class="ltr-r" style="word-break:break-all">${esc(info.db_path)}</dd><dt>احراز هویت</dt><dd>${info.auth ? "فعال" : "غیرفعال"}</dd><dt>آدرس عمومی</dt><dd class="ltr-r">${esc(info.public_url || "—")}</dd></div>
   <div class="h-sec">نگهداری خودکار</div><div class="small muted" style="line-height:1.9">هر ۲۴ ساعت: پشتیبان آنلاین SQLite (backup API، بدون توقف)، هرس نسخه‌های قدیمی، پاک‌سازی طبق بازه نگهداری و checkpoint فایل WAL.</div>
   <div class="h-sec">بازیابی</div><div class="small muted" style="line-height:1.9">سرویس را متوقف کنید، فایل پشتیبان را جایگزین <span class="ltr-r">data/rasad.db</span> کنید و دوباره اجرا کنید.</div>`;
  const reload = () => system(box, side);
  $("#bkNow").onclick = async (e) => { e.target.disabled = true; const r = await post("/api/system/backup"); toast("پشتیبان ساخته شد: " + r.file, "success"); reload(); };
  $("#retSave").onclick = async () => { const d = +$("#retD").value.replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)); await post("/api/system/retention", { days: d }); toast("بازه نگهداری ذخیره شد", "success"); reload(); };
  $("#purge").onclick = async () => { if (!(await confirmDlg("پاک‌سازی داده‌های قدیمی", "داده‌های قدیمی‌تر از بازه نگهداری برای همیشه حذف می‌شوند. پیشنهاد می‌شود ابتدا پشتیبان بگیرید.", "پاک‌سازی"))) return; const r = await post("/api/system/purge", {}); toast(`پاک‌سازی انجام شد: ${fa(r.articles)} خبر و ${fa(r.stories)} داستان قدیمی‌تر از ${fa(r.days)} روز حذف شد`, "success"); reload(); };
}

// ---------------- audit ----------------
async function audit(box, side) {
  const rows = await api("/api/audit?limit=300");
  const actors = [...new Set(rows.map((r) => r.actor))];
  box.innerHTML = `<div class="card flush"><div class="card-h"><h3>ردپای ممیزی <span class="badge">${fa(rows.length)}</span></h3><select id="aAct"><option value="">همه کنشگرها</option>${actors.map((a) => `<option>${esc(a)}</option>`).join("")}</select><input type="text" id="aQ" placeholder="فیلتر کنش…" style="width:170px"></div>
   <div style="overflow:auto"><table class="t" id="aTbl"><thead><tr><th>زمان</th><th>کنشگر</th><th>کنش</th><th>هدف</th><th>جزئیات</th></tr></thead><tbody>
   ${rows.map((r) => `<tr data-a="${esc(r.actor)}" data-q="${esc((r.action + " " + (r.target || "")).toLowerCase())}"><td class="small"><time>${dt(r.ts)}</time></td><td><span class="chip">${esc(r.actor)}</span></td><td class="ltr-r small"><b>${esc(r.action)}</b></td><td class="small ltr-r">${esc(r.target || "")}</td><td class="small dim ltr-r" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.detail || "")}">${esc(r.detail && r.detail !== "{}" ? r.detail : "")}</td></tr>`).join("")}</tbody></table></div></div>`;
  side.innerHTML = `<h2>ممیزی</h2><p class="small muted" style="line-height:1.9">هر تصمیم انسانی (تأیید/رد دروازه‌ها، تغییر حالت اجرا، توقف اضطراری)، تغییرات منابع، کاربران، کانال‌ها و تنظیمات مدل با نام کاربر ثبت می‌شود.</p>`;
  const f = () => { const a = $("#aAct").value, q = $("#aQ").value.toLowerCase(); $$("#aTbl tbody tr").forEach((tr) => (tr.style.display = (!a || tr.dataset.a === a) && tr.dataset.q.includes(q) ? "" : "none")); };
  $("#aAct").onchange = f; $("#aQ").oninput = f;
}

// ================= Watchlists (analyst) =================
function watchForm(w = {}) {
  const topics = store.topics || {};
  return `<div class="form two"><label class="full">نام فهرست<input name="name" type="text" value="${esc(w.name || "")}" placeholder="مثلاً: امنیت کشتیرانی خلیج فارس"></label>
   <label class="full">واژه‌های کلیدی (با ویرگول؛ هر زبان)<input name="terms" type="text" value="${esc((w.terms || []).join("، "))}" placeholder="هرمز، Hormuz، هرمز، tanker"></label>
   <label class="full">موجودیت‌ها<div class="ent-pick"><div class="chips" id="entChips"></div><input type="text" id="entQ" placeholder="جست‌وجوی موجودیت…" autocomplete="off"><div class="g-sres" id="entRes"></div></div><input type="hidden" name="entities" value="${esc((w.entities || []).join(","))}"></label>
   <label>موضوع‌ها (خالی = همه)<select name="topics" multiple size="5">${Object.entries(topics).map(([k, t]) => `<option value="${k}" ${(w.topics || []).includes(k) ? "selected" : ""}>${esc(t.fa)}</option>`).join("")}</select></label>
   <label>زبان‌ها (خالی = همه)<select name="langs" multiple size="5">${opt({ fa: "فارسی", ar: "عربی", en: "انگلیسی" })}</select></label>
   <label>حداقل خبر در ۶ ساعت<input name="min_articles" type="text" dir="ltr" value="${w.min_articles || 1}"></label>
   <label>شدت هشدار<select name="severity">${opt(SEV_FA, w.severity || "warning")}</select></label>
   <label class="chk full"><input name="enabled" type="checkbox" ${w.enabled !== false ? "checked" : ""}> فعال (تولید سیگنال «فهرست پایش» و ارسال به کانال‌های اعلان)</label></div>`;
}
function bindEntityPicker(f, w = {}) {
  const hid = f.querySelector("[name=entities]"), chips = f.querySelector("#entChips"), q = f.querySelector("#entQ"), res = f.querySelector("#entRes");
  [...(f.querySelector("[name=langs]")?.options || [])].forEach((o) => (o.selected = (w.langs || []).includes(o.value)));
  const names = Object.fromEntries((w.entity_names || []).map((e) => [e.id, e.name_fa]));
  const draw = () => { const ids = hid.value.split(",").filter(Boolean); chips.innerHTML = ids.map((id) => `<span class="chip">${esc(names[id] || id)} <button type="button" data-rm="${esc(id)}">✕</button></span>`).join(""); };
  chips.onclick = (e) => { const id = e.target.dataset.rm; if (id) { hid.value = hid.value.split(",").filter((x) => x && x !== id).join(","); draw(); } };
  let t; q.oninput = () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2) return res.classList.remove("open"); t = setTimeout(async () => { const r = await api("/api/search?q=" + encodeURIComponent(v)); res.innerHTML = r.entities.slice(0, 8).map((e) => `<div class="it" data-id="${esc(e.id)}" data-n="${esc(e.name_fa)}">${esc(e.name_fa)} <span class="dim small" dir="ltr">${esc(e.name_en || "")}</span></div>`).join("") || '<div class="it dim">موردی نیست</div>'; res.classList.add("open"); }, 160); };
  res.onclick = (e) => { const it = e.target.closest("[data-id]"); if (!it) return; names[it.dataset.id] = it.dataset.n; const ids = new Set(hid.value.split(",").filter(Boolean)); ids.add(it.dataset.id); hid.value = [...ids].join(","); q.value = ""; res.classList.remove("open"); draw(); };
  draw();
}
function packWatch(x) { return { ...x, entities: (x.entities || "").split(",").filter(Boolean), min_articles: +String(x.min_articles).replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)) || 1 }; }

export async function renderWatch({ view, side, params }) {
  const list = await api("/api/watchlists");
  const ents = {}; // resolve entity names lazily from search index
  const sel = +params[0] || list[0]?.id;
  const editable = can("analyst");
  view.innerHTML = `<div class="page-h"><div><h1>فهرست‌های پایش</h1><div class="muted small">واژه‌ها، موجودیت‌ها و موضوع‌های مورد علاقه را دنبال کنید؛ هر انطباق تازه یک سیگنال «فهرست پایش» می‌سازد و از کانال‌های اعلان ارسال می‌شود.</div></div><span class="tb-spacer"></span>${editable ? '<button class="btn primary" id="wAdd">＋ فهرست جدید</button>' : ""}</div>
   <div class="grid cards3" id="wGrid">${list.map((w) => `<div class="card w-card ${w.id === sel ? "sel" : ""} ${w.enabled ? "" : "is-off"}" data-w="${w.id}"><div class="ch-top"><span class="sev-dot ${w.severity}"></span><b style="flex:1;min-width:0">${esc(w.name)}</b>${yes(w.enabled)}</div>
     <div class="w-hits"><span class="num">${fa(w.hits_24h)}</span><small>انطباق در ۲۴ ساعت</small></div>
     <div class="chips">${w.terms.slice(0, 6).map((t) => `<span class="chip">«${esc(t)}»</span>`).join("")}${w.entities.slice(0, 4).map((e) => `<span class="chip ent">◆ ${esc(e)}</span>`).join("")}${w.topics.map((t) => catChip(t)).join("")}${w.langs.map((l) => `<span class="tag lang">${LANG[l] || l}</span>`).join("")}</div>
     <div class="small dim" style="margin-top:8px">آستانه ${fa(w.min_articles)} خبر/۶ساعت · ${SEV_FA[w.severity]} · آخرین انطباق ${w.last_hit ? ago(w.last_hit) : "—"} · ${esc(w.owner || "")}</div>
     ${editable ? `<div class="toolbar" style="margin:10px 0 0"><button class="btn ghost sm" data-edit="${w.id}">ویرایش</button><button class="btn ghost sm" data-tog="${w.id}">${w.enabled ? "توقف" : "فعال‌سازی"}</button><button class="btn ghost sm danger" data-del="${w.id}">حذف</button></div>` : ""}</div>`).join("") || `<div class="card empty" style="grid-column:1/-1">هنوز فهرستی تعریف نشده است.${editable ? " با «فهرست جدید» شروع کنید؛ مثلاً واژه «هرمز» با موجودیت «ایران» و موضوع امنیت دریایی." : ""}</div>`}</div>`;
  const reload = () => renderWatch({ view, side, params: [String(sel || "")] });
  const open = (w) => modal({ title: w ? "ویرایش فهرست پایش" : "فهرست پایش جدید", submit: w ? "ذخیره" : "ایجاد", wide: true, body: watchForm(w || {}),
    onOpen: (f) => { bindEntityPicker(f, w || {}); f._validate = async (x) => { try { await post(w ? `/api/watchlists/${w.id}` : "/api/watchlists", packWatch(x)); } catch (e) { return e.message; } }; } });
  $("#wAdd") && ($("#wAdd").onclick = async () => { if (await open(null)) { toast("فهرست پایش ایجاد شد", "success"); reload(); } });
  $("#wGrid").onclick = async (e) => {
    const b = e.target.closest("button");
    if (b) {
      const w = list.find((x) => x.id === +(b.dataset.edit || b.dataset.tog || b.dataset.del));
      if (b.dataset.edit && (await open(w))) { toast("ذخیره شد", "success"); reload(); }
      if (b.dataset.tog) { await post(`/api/watchlists/${w.id}`, { ...w, enabled: !w.enabled }); reload(); }
      if (b.dataset.del && (await confirmDlg("حذف فهرست پایش", `«${esc(w.name)}» حذف شود؟`, "حذف"))) { await api(`/api/watchlists/${w.id}`, { method: "DELETE" }); reload(); }
      return;
    }
    const c = e.target.closest("[data-w]"); if (c) location.hash = "#/watch/" + c.dataset.w;
  };
  const w = list.find((x) => x.id === sel);
  if (!w) { side.innerHTML = `<h2>فهرست پایش</h2><p class="small muted">یک فهرست را انتخاب کنید تا خبرهای منطبق ۴۸ ساعت اخیر را ببینید.</p>`; return; }
  side.innerHTML = `<h2>${esc(w.name)}</h2><div class="small muted">خبرهای منطبق · ۴۸ ساعت اخیر</div><div class="list" id="wHits"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
  const hits = await api(`/api/watchlists/${w.id}/hits?hours=48&limit=60`).catch(() => []);
  const h = $("#wHits"); if (!h) return;
  h.innerHTML = hits.map((a) => `<div class="row" data-sid="${a.story_id || ""}"><span class="bar" style="background:${store.topics[a.category]?.color || "var(--line2)"}"></span><div style="flex:1;min-width:0"><div class="t">${esc(a.title_fa || a.title)}</div><div class="m"><span>${esc(a.sname)}</span><span class="tag lang">${LANG[a.lang] || a.lang}</span><time>${hhmm(a.published_at)}</time><span class="dim">${ago(a.published_at)}</span></div></div></div>`).join("") || '<div class="empty small">در ۴۸ ساعت اخیر انطباقی نبوده است.</div>';
  h.onclick = (e) => { const r = e.target.closest("[data-sid]"); if (r?.dataset.sid) location.hash = "#/stories/" + r.dataset.sid; };
}
