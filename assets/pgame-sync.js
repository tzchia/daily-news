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

  /* 載入/切換玩家時呼叫。回傳 true = 本機被雲端更新，畫面需重繪 */
  async function pull() {
    const u = user(); if (!u) return false;
    setStatus("sync");
    try {
      const d = await api({ action: "get", u: u });
      setStatus("ok");
      if (!d.ok) { if (localTs()) push(); return false; } /* 雲端還沒有這位玩家 */
      if (d.ts > localTs()) {
        applyBlob(u, JSON.parse(d.s || "{}"), d.ts);
        return true;
      }
      if (localTs() > d.ts) push();
      return false;
    } catch (e) { setStatus("err"); return false; }
  }

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

  /* 選定（或建立）玩家。全新玩家會認領這台裝置的舊版未分帳進度 */
  async function selectUser(name) {
    name = String(name || "").trim().slice(0, 12).replace(/[<>&"':]/g, "");
    if (!name) return false;
    let cloudHas = false;
    try { const d = await api({ action: "get", u: name }); cloudHas = !!d.ok; } catch (e) {}
    localStorage.setItem("pgame:user", name);
    const hasLocal = localTs() > 0 || Object.keys(collect()).length > 0;
    if (!cloudHas && !hasLocal) {
      const legacy = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && LEGACY.test(k)) legacy[k.slice("pgame:".length)] = localStorage.getItem(k);
      }
      Object.keys(legacy).forEach(s => localStorage.setItem(prefix(name) + s, legacy[s]));
      Object.keys(legacy).forEach(s => localStorage.removeItem("pgame:" + s));
      touch();
      await pushNow();
      return true;
    }
    await pull();
    return true;
  }

  /* 離開頁面前把還沒推送的進度送出（keepalive 讓請求在跳頁後仍完成） */
  window.addEventListener("pagehide", () => { if (pushTimer) pushNow(); });

  return {
    user: user, K: K, touch: touch, push: push, pushNow: pushNow,
    pull: pull, listUsers: listUsers, selectUser: selectUser,
    set onstatus(f) { onStatus = f; if (f) f(status); },
    get status() { return status; }
  };
})();
