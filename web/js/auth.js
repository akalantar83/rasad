// Authentication UI: first-run setup, sign-in screen, user menu, password change, role gating.
import { $, esc, fa, ago, dt, api, post, store, toast, modal, ROLE_RANK } from "./core.js";

export async function authStatus() {
  const s = await api("/api/auth/status");
  store.auth = s; store.user = s.user || null;
  return s;
}

export function applyRole() {
  const r = !store.auth?.auth_enabled ? 2 : ROLE_RANK[store.user?.role] ?? -1;
  document.body.dataset.rank = r;
}

export function showLogin(setup = false, reason = "") {
  if ($("#authScreen")) return;
  const el = document.createElement("div");
  el.id = "authScreen"; el.className = "auth-screen";
  el.innerHTML = `<div class="auth-bg"></div><form class="auth-card" novalidate>
    <div class="brand auth-brand"><div class="logo"></div><div>رصد<br><small>سامانه چندعاملی پایش خبر</small></div></div>
    <h2>${setup ? "راه‌اندازی اولیه" : "ورود به رصد"}</h2>
    <p class="muted small">${setup ? "هنوز کاربری تعریف نشده است. نخستین حساب با نقش «مدیر» ساخته می‌شود؛ سپس می‌توانید تحلیلگران و بینندگان را از بخش مدیریت اضافه کنید." : esc(reason || "برای دسترسی به داشبورد، با حساب سازمانی خود وارد شوید.")}</p>
    ${setup ? `<label class="fld"><span>نام نمایشی</span><input name="name" type="text" autocomplete="name" placeholder="مثلاً: مدیر رصد"></label>` : ""}
    <label class="fld"><span>نام کاربری</span><input name="username" type="text" autocomplete="username" dir="ltr" required></label>
    <label class="fld"><span>رمز عبور</span><input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" dir="ltr" required></label>
    ${setup ? `<label class="fld"><span>تکرار رمز عبور</span><input name="password2" type="password" autocomplete="new-password" dir="ltr" required></label><div class="small dim">حداقل ۸ نویسه.</div>` : ""}
    <div class="err small" id="authErr"></div>
    <button class="btn primary lg" type="submit">${setup ? "ساخت حساب مدیر و ورود" : "ورود"}</button>
    <div class="auth-foot small dim">نشست امن HttpOnly · محدودیت تلاش ناموفق · نقش‌ها: بیننده، تحلیلگر، مدیر</div>
  </form>`;
  document.body.append(el);
  const f = el.querySelector("form");
  setTimeout(() => f.querySelector("input")?.focus(), 50);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const err = $("#authErr");
    if (!v.username || !v.password) return (err.textContent = "نام کاربری و رمز عبور را وارد کنید");
    if (setup && v.password !== v.password2) return (err.textContent = "تکرار رمز عبور یکسان نیست");
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; err.textContent = "";
    try {
      await post(setup ? "/api/auth/setup" : "/api/auth/login", { username: v.username, password: v.password, name: v.name });
      location.reload();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; f.querySelector("[name=password]").select(); }
  };
}

export function renderUserMenu() {
  const host = $("#userMenu");
  if (!host) return;
  if (!store.auth?.auth_enabled) { host.innerHTML = `<span class="chip" title="RASAD_AUTH=0">احراز هویت غیرفعال</span>`; return; }
  const u = store.user; if (!u) { host.innerHTML = ""; return; }
  const ini = (u.name || u.username).trim().slice(0, 1).toUpperCase();
  host.innerHTML = `<button class="user-btn" id="userBtn"><span class="avatar r-${u.role}">${esc(ini)}</span><span class="un"><b>${esc(u.name || u.username)}</b><small>${esc(u.role_fa || u.role)}</small></span></button>
   <div class="menu" id="userDrop"><div class="menu-h"><b>${esc(u.name || u.username)}</b><div class="small dim" dir="ltr">@${esc(u.username)}</div></div>
   <button data-a="pw">تغییر رمز عبور</button><button data-a="tok">توکن‌های API</button>${u.role === "admin" ? '<button data-a="admin">مدیریت سامانه</button>' : ""}<button data-a="watch">فهرست‌های پایش</button><hr><button data-a="out" class="danger">خروج</button></div>`;
  const drop = $("#userDrop");
  $("#userBtn").onclick = (e) => { e.stopPropagation(); drop.classList.toggle("open"); };
  document.addEventListener("click", () => drop.classList.remove("open"));
  drop.onclick = async (e) => {
    const a = e.target.dataset.a; if (!a) return;
    drop.classList.remove("open");
    if (a === "admin") location.hash = "#/admin";
    if (a === "watch") location.hash = "#/watch";
    if (a === "out") { await post("/api/auth/logout").catch(() => {}); location.reload(); }
    if (a === "pw") changePassword();
    if (a === "tok") apiTokens();
  };
}

async function changePassword() {
  const v = await modal({ title: "تغییر رمز عبور", submit: "ذخیره رمز جدید",
    body: `<div class="form"><label>رمز فعلی<input name="old" type="password" dir="ltr" autocomplete="current-password"></label><label>رمز جدید<input name="new" type="password" dir="ltr" autocomplete="new-password"></label><label>تکرار رمز جدید<input name="new2" type="password" dir="ltr" autocomplete="new-password"></label></div><p class="small dim">پس از تغییر، سایر نشست‌های شما بسته می‌شوند.</p>`,
    onOpen: (f) => (f._validate = async (x) => { if (x.new !== x.new2) return "تکرار رمز یکسان نیست"; if ((x.new || "").length < 8) return "رمز جدید باید حداقل ۸ نویسه باشد"; try { await post("/api/auth/password", { old: x.old, new: x.new }); } catch (e) { return e.message; } }) });
  if (v) toast("رمز عبور تغییر کرد", "success");
}

async function apiTokens() {
  const list = await api("/api/me/tokens");
  const rows = (l) => l.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="ltr-r small num">${esc(t.prefix)}…</td><td class="small">${dt(t.created)}</td><td class="small">${t.last_used ? ago(t.last_used) : "—"}</td><td class="small">${t.expires ? dt(t.expires) : "بدون انقضا"}</td><td><button type="button" class="btn ghost sm danger" data-rv="${t.id}">ابطال</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty small">توکنی ساخته نشده است</td></tr>';
  await modal({ title: "توکن‌های API شخصی", submit: null, wide: true,
    body: `<p class="small muted" style="margin-top:0;line-height:1.9">برای اسکریپت‌ها و یکپارچه‌سازی (Power BI، n8n، cron) از هدر <code dir="ltr">Authorization: Bearer rsd_…</code> استفاده کنید. توکن با سطح دسترسی نقش شما (${esc(store.user?.role_fa || "")}) کار می‌کند و فقط یک‌بار نمایش داده می‌شود.</p>
      <div class="toolbar"><input type="text" id="tkN" placeholder="نام توکن، مثلاً: گزارش‌گیری روزانه" style="flex:1"><select id="tkD"><option value="30">۳۰ روز</option><option value="90" selected>۹۰ روز</option><option value="365">یک سال</option><option value="">بدون انقضا</option></select><button type="button" class="btn primary sm" id="tkC">ساخت توکن</button></div>
      <div id="tkNew"></div><table class="t"><thead><tr><th>نام</th><th>پیشوند</th><th>ایجاد</th><th>آخرین استفاده</th><th>انقضا</th><th></th></tr></thead><tbody id="tkRows">${rows(list)}</tbody></table>`,
    onOpen: (f) => {
      const refresh = async () => ($("#tkRows").innerHTML = rows(await api("/api/me/tokens")));
      $("#tkC").onclick = async () => {
        try {
          const d = $("#tkD").value, r = await post("/api/me/tokens", { name: $("#tkN").value || "token", days: d ? +d : null });
          $("#tkNew").innerHTML = `<div class="tok-new"><div class="small"><b>توکن جدید — همین حالا کپی کنید؛ دوباره نمایش داده نمی‌شود:</b></div><div class="tok-box"><code dir="ltr" id="tkV">${esc(r.token)}</code><button type="button" class="btn sm" id="tkCp">کپی</button></div></div>`;
          $("#tkCp").onclick = () => { navigator.clipboard?.writeText(r.token); toast("کپی شد", "success"); };
          refresh();
        } catch (e) { toast(e.message, "error"); }
      };
      f.addEventListener("click", async (e) => { const id = e.target.dataset.rv; if (!id) return; await api("/api/me/tokens/" + id, { method: "DELETE" }); toast("توکن ابطال شد", "success"); refresh(); });
    } });
}
