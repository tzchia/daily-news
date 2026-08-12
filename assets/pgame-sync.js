/* ═══════════ 帕恰狗圖鑑 · 玩家切換與雲端同步 ═══════════
 * 後端：Google Apps Script Web App（免費、不會過期），資料存 ScriptProperties。
 *   GET  ?action=list        → {ok, users:{名字:ts}}
 *   GET  ?action=get&u=NAME  → {ok, s, ts}
 *   POST {u, s, ts}（text/plain 簡單請求免 preflight）→ {ok}
 * 策略：last-write-wins —— 每次進度變動更新本機 ts，
 *       載入時比對雲端 ts 決定拉下來或推上去；變動後 2 秒合併推送。
 * 未選玩家時走舊版 pgame:* key（本機模式），選了玩家改用 pgame:u:{名字}:*。 */
window.PSYNC = (function () {
  const API = "https://script.google.com/macros/s/AKfycbxpie5wf-Us74oLuEciug1aCkIZzvR4Q00SbPFQCjo0QZPNY6KsZxLA5BlxnPKJmeHu/exec";
  const LEGACY = /^pgame:(food$|pity$|ssrpity:|draws:|col:|meta:|earned:)/;

  function user() { return localStorage.getItem("pgame:user") || null; }
  function prefix(u) { return "pgame:u:" + u + ":"; }
  function K(suffix) { const u = user(); return u ? prefix(u) + suffix : "pgame:" + suffix; }

  /* 蒐集目前玩家的所有進度 { suffix: value }（不含 ts 自身） */
  function collect() {
    const u = user(); if (!u) return {};
    const p = prefix(u), out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(p) === 0 && k !== p + "ts") out[k.slice(p.length)] = localStorage.getItem(k);
    }
    return out;
  }
  function localTs() { const u = user(); return u ? +(localStorage.getItem(prefix(u) + "ts") || 0) : 0; }
  function touch() { const u = user(); if (u) localStorage.setItem(prefix(u) + "ts", Date.now()); }

  /* 用雲端存檔完整覆蓋本機該玩家進度 */
  function applyBlob(u, blob, ts) {
    const p = prefix(u), doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(p) === 0) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
    Object.keys(blob).forEach(s => localStorage.setItem(p + s, blob[s]));
    localStorage.setItem(p + "ts", ts);
  }

  let pushTimer = null, status = "idle", onStatus = null;
  function setStatus(s) { status = s; if (onStatus) onStatus(s); }

  async function api(params) {
    const qs = new URLSearchParams(params); qs.set("t", Date.now());
    const r = await fetch(API + "?" + qs, { cache: "no-store", redirect: "follow" });
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }

  async function pushNow() {
    const u = user(); if (!u) return;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    setStatus("sync");
    try {
      /* text/plain = CORS 簡單請求，GAS 不吃 preflight */
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ u: u, s: JSON.stringify(collect()), ts: localTs() }),
        redirect: "follow",
        keepalive: true
      });
      const d = await r.json();
      if (!d.ok) throw 0;
      setStatus("ok");
    } catch (e) { setStatus("err"); }
  }
  /* 進度變動後 2 秒合併推送（連續答題/十連抽只打一次 API） */
  function push() {
    if (!user()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 2000);
  }

  /* ── 逐項合併（兩台裝置交錯玩也不互蓋）──
   * 🍨/保底/抽數取較大值；圖鑑每張卡取較多張數；答題與登入記號取聯集；
   * 其他鍵取 ts 較新一方。特例：rst（重置世代）較新的一方整包獲勝，
   * 否則 ?reset=1 清掉的進度會被別台裝置的舊存檔「合併」回來。 */
  function jparse(v) { try { return JSON.parse(v) || {}; } catch (e) { return {}; } }
  function merge(a, at, b, bt) {
    const ra = +(a.rst || 0), rb = +(b.rst || 0);
    if (ra !== rb) return ra > rb ? a : b;
    const out = {}, keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(k => {
      const va = a[k], vb = b[k];
      if (va === undefined) { out[k] = vb; return; }
      if (vb === undefined || va === vb) { out[k] = va; return; }
      if (k === "food" || k === "pity" || k.indexOf("ssrpity:") === 0 || k.indexOf("draws:") === 0) {
        out[k] = String(Math.max(+va || 0, +vb || 0));
      } else if (k.indexOf("col:") === 0) {
        const oa = jparse(va), ob = jparse(vb), m = {};
        new Set(Object.keys(oa).concat(Object.keys(ob))).forEach(id => {
          m[id] = Math.max(+oa[id] || 0, +ob[id] || 0);
        });
        out[k] = JSON.stringify(m);
      } else if (k.indexOf("earned:") === 0) {
        /* 聯集；1（已發）優先於 2（舊版看過答案記號） */
        const oa = jparse(va), ob = jparse(vb), m = {};
        new Set(Object.keys(oa).concat(Object.keys(ob))).forEach(q => {
          m[q] = (oa[q] === 1 || ob[q] === 1) ? 1 : (oa[q] || ob[q]);
        });
        out[k] = JSON.stringify(m);
      } else if (k.indexOf("login:") === 0) {
        out[k] = "1";
      } else {
        out[k] = at >= bt ? va : vb;
      }
    });
    return out;
  }

  /* 載入/切換玩家/切回分頁時呼叫。回傳 true = 本機進度有變，畫面需重繪 */
  async function pull() {
    const u = user(); if (!u) return false;
    setStatus("sync");
    try {
      const d = await api({ action: "get", u: u });
      setStatus("ok");
      lastPull = Date.now();
      if (!d.ok) { if (localTs()) push(); return false; } /* 雲端還沒有這位玩家 */
      const lts = localTs(), local = collect();
      if (d.ts === lts) return false; /* 已同步 */
      const cloud = JSON.parse(d.s || "{}");
      if (!Object.keys(local).length) { applyBlob(u, cloud, d.ts); return true; } /* 本機空 → 採雲端 */
      const merged = merge(cloud, d.ts, local, lts);
      const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
      const changedCloud = JSON.stringify(merged) !== JSON.stringify(cloud);
      if (changedLocal) applyBlob(u, merged, Math.max(d.ts, lts));
      else localStorage.setItem(prefix(u) + "ts", Math.max(d.ts, lts));
      if (changedCloud) { touch(); push(); } /* 合併結果回推，雲端也不丟進度 */
      return changedLocal;
    } catch (e) { setStatus("err"); return false; }
  }

  /* 切回分頁自動重新同步（手機還原舊分頁不重載，最容易看到舊進度）。
   * 15 秒節流，避免快速切換狂打 GAS。 */
  let lastPull = 0, onUpdate = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !user()) return;
    if (Date.now() - lastPull < 15000) return;
    pull().then(updated => { if (updated && onUpdate) onUpdate(); });
  });

  /* 玩家名單：雲端 + 本機出現過的名字（離線也列得出來） */
  async function listUsers() {
    const names = new Set();
    try {
      const d = await api({ action: "list" });
      Object.keys((d && d.users) || {}).forEach(n => names.add(n));
      setStatus("ok");
    } catch (e) { setStatus("err"); }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^pgame:u:([^:]+):ts$/);
      if (m) names.add(m[1]);
    }
    return Array.from(names).sort();
  }

  /* 選定（或建立）玩家 —— 樂觀切換：名字合法就立刻生效並回傳，
   * 雲端對帳（拉存檔／認領舊進度）丟到背景跑，UI 不用等。
   * 回傳 false = 名字不合法；否則回傳 { ok:true, synced:Promise<boolean> }，
   * synced resolve true = 本機進度被雲端更新，畫面需要重繪。 */
  function selectUser(name) {
    name = String(name || "").trim().slice(0, 12).replace(/[<>&"':]/g, "");
    if (!name) return false;
    localStorage.setItem("pgame:user", name);
    return { ok: true, synced: reconcile(name) };
  }
  /* 背景對帳：整個流程最多只打一次 GET（舊版會連打兩次一樣的 get，慢一倍） */
  async function reconcile(name) {
    const hasLocal = localTs() > 0 || Object.keys(collect()).length > 0;
    if (hasLocal) return pull(); /* 本機已有此玩家進度 → 比 ts 決定拉或推 */
    setStatus("sync");
    let d = null;
    try { d = await api({ action: "get", u: name }); setStatus("ok"); }
    catch (e) { setStatus("err"); return false; } /* 離線：先玩本機，之後變動會再推 */
    if (d && d.ok) { applyBlob(name, JSON.parse(d.s || "{}"), d.ts); return true; }
    /* 雲端沒有、本機也沒有 → 全新玩家：認領這台裝置的舊版未分帳進度 */
    const legacy = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LEGACY.test(k)) legacy[k.slice("pgame:".length)] = localStorage.getItem(k);
    }
    Object.keys(legacy).forEach(s => localStorage.setItem(prefix(name) + s, legacy[s]));
    Object.keys(legacy).forEach(s => localStorage.removeItem("pgame:" + s));
    touch();
    pushNow();
    return Object.keys(legacy).length > 0;
  }

  /* ── 每日登入禮：每天第一次打開就送 🍨×1 ──
   * 記號 key = login:YYYY-MM-DD（跟著玩家同步上雲，跨裝置也只領一次）。
   * 呼叫時機：pull() 完成之後（先看過雲端記號才不會重複發）。
   * 回傳 true = 這次有發，頁面可跳提示。 */
  function dailyLogin() {
    try {
      const today = new Date().toLocaleDateString("sv"); /* YYYY-MM-DD */
      const key = K("login:" + today);
      if (localStorage.getItem(key)) return false;
      /* 清掉舊日期的登入記號，存檔不會越長越肥 */
      const p = K("login:"), doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(p) === 0 && k !== key) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(key, "1");
      const fk = K("food");
      localStorage.setItem(fk, +(localStorage.getItem(fk) || 0) + 1);
      touch(); push();
      return true;
    } catch (e) { return false; }
  }

  /* 離開頁面前把還沒推送的進度送出（keepalive 讓請求在跳頁後仍完成） */
  window.addEventListener("pagehide", () => { if (pushTimer) pushNow(); });

  return {
    user: user, K: K, touch: touch, push: push, pushNow: pushNow,
    pull: pull, listUsers: listUsers, selectUser: selectUser, dailyLogin: dailyLogin,
    set onstatus(f) { onStatus = f; if (f) f(status); },
    set onupdate(f) { onUpdate = f; }, /* 背景 pull 拉到新進度時通知頁面重繪 */
    get status() { return status; }
  };
})();
