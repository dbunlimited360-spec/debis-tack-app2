// Request handling for Debi's Tack Consignment. Storage and Wix are passed in so tests can fake them.
import { syncItem, hideOnWix, deleteOnWix, itemFromWix, tagNo } from "./wix.mjs";

const DEFAULT_SETTINGS = {
  shopName: "Debi's Tack Boutique",
  website: "https://www.debistackboutique.com",
  phone: "(971) 388-2020",
  defaultSplit: 70,
  wixSync: true,
  wixRibbon: "New Arrival",
  wixFooter: "***Buyer pays for shipping***",
  wixClearDays: 3,
};

const enc = new TextEncoder();
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Buffer.from(sig).toString("base64url");
}
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function makeHandler({ store, wix, env }) {
  const password = env.APP_PASSWORD || "";
  const secret = (env.TOKEN_SECRET || "") + "|" + password;
  const publicBase = (env.URL || "").replace(/\/$/, "");

  async function load() {
    const s = (await store.get("state", { type: "json" })) || {};
    s.v = 1;
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.items = s.items || [];
    s.consignors = s.consignors || {};
    s.nextTag = s.nextTag || 101;
    return s;
  }
  const save = s => store.setJSON("state", s);

  async function makeToken() {
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 180; // stays signed in about 6 months
    const body = "v1." + exp;
    return body + "." + (await hmac(secret, body));
  }
  async function authed(req) {
    if (!password) return false;
    const h = req.headers.get("authorization") || "";
    const t = h.replace(/^Bearer\s+/i, "");
    const parts = t.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return false;
    if (Number(parts[1]) < Date.now()) return false;
    return safeEq(parts[2], await hmac(secret, parts[0] + "." + parts[1]));
  }

  async function trySync(s, it) {
    if (!s.settings.wixSync || it.wixSkip) return true;
    if (!wix.configured) { it.wixErr = "The website connection isn't set up yet (Wix API key missing)."; return false; }
    try { await syncItem(wix, it, s.settings, publicBase); return true; }
    catch (e) { it.wixErr = "The website didn't accept it: " + String(e.message || e).slice(0, 180); return false; }
  }

  function cleanItem(input, old, s) {
    const num = v => Math.round(parseFloat(v) * 100) / 100;
    const it = old ? { ...old } : { id: "i" + rid(), tag: s.nextTag, added: today() };
    for (const k of ["title", "cat", "cond", "size", "brand", "desc", "status"]) if (input[k] != null) it[k] = String(input[k]).trim();
    if (input.price != null) it.price = num(input.price);
    if (!it.title) throw new Error("Give the item a name.");
    if (!(it.price >= 0)) throw new Error("Enter a price in dollars, like 450.");
    if (!["available", "hold", "sold"].includes(it.status)) it.status = "available";
    if (Array.isArray(input.photos)) {
      it.photos = input.photos.slice(0, 8).filter(p => p && (p.key || p.mediaId)).map(p => p.mediaId ? { src: String(p.src || ""), mediaId: String(p.mediaId) } : { key: String(p.key).replace(/[^a-z0-9]/gi, "") });
    }
    it.photos = it.photos || [];
    for (const k of ["consignorId", "notes", "dateIn"]) if (input[k] != null) it[k] = String(input[k]);
    if (input.split != null) it.split = Math.max(0, Math.min(100, Number(input.split) || 0));
    if (it.split == null) it.split = s.settings.defaultSplit;
    if (input.toWix != null) it.wixSkip = !input.toWix;
    if (!old) s.nextTag += 1;
    return it;
  }

  const routes = {
    "POST /login": async (req) => {
      if (!password) return fail("The app password hasn't been set up yet.", 503);
      const b = await req.json().catch(() => ({}));
      if (!safeEq(String(b.password || ""), password)) return fail("That password isn't right.", 401);
      return json({ token: await makeToken() });
    },
    "GET /state": async () => json({ ...(await load()), wixReady: wix.configured }),
    "POST /settings": async (req) => {
      const s = await load(); const b = await req.json();
      for (const k of ["shopName", "website", "phone", "wixRibbon", "wixFooter"]) if (b[k] != null) s.settings[k] = String(b[k]).trim();
      if (b.wixSync != null) s.settings.wixSync = !!b.wixSync;
      if (b.defaultSplit != null) s.settings.defaultSplit = Math.max(0, Math.min(100, Number(b.defaultSplit) || 0));
      if (b.wixClearDays != null) s.settings.wixClearDays = Math.max(0, Math.min(60, Number(b.wixClearDays) || 0));
      await save(s); return json({ ok: true, settings: s.settings });
    },
    "POST /items": async (req) => {
      const s = await load(); const b = await req.json();
      const idx = b.id ? s.items.findIndex(i => i.id === b.id) : -1;
      if (b.id && idx < 0) return fail("That item wasn't found. Pull down to refresh.", 404);
      let it; try { it = cleanItem(b, idx >= 0 ? s.items[idx] : null, s); } catch (e) { return fail(e.message); }
      if (b.newConsignor && b.newConsignor.name) {
        const cid = "c" + rid();
        s.consignors[cid] = { id: cid, name: String(b.newConsignor.name).trim(), phone: String(b.newConsignor.phone || "").trim(), email: "", notes: "", added: today() };
        it.consignorId = cid;
      }
      const ok = await trySync(s, it);
      if (idx >= 0) s.items[idx] = it; else s.items.push(it);
      await save(s);
      return json({ ok, item: it, consignors: s.consignors, nextTag: s.nextTag });
    },
    "POST /items/:id/sell": async (req, id) => {
      const s = await load(); const it = s.items.find(i => i.id === id); if (!it) return fail("Item not found.", 404);
      const b = await req.json();
      it.status = "sold"; it.soldPrice = Math.round(parseFloat(b.soldPrice ?? it.price) * 100) / 100; it.soldAt = b.soldDate || today(); delete it.paidDate;
      const ok = it.wixId ? await trySync(s, it) : true;
      await save(s); return json({ ok, item: it });
    },
    "POST /items/:id/unsell": async (req, id) => {
      const s = await load(); const it = s.items.find(i => i.id === id); if (!it) return fail("Item not found.", 404);
      it.status = "available"; delete it.soldAt; delete it.soldPrice; delete it.paidDate; delete it.wixHidden;
      const ok = it.wixId ? await trySync(s, it) : true;
      await save(s); return json({ ok, item: it });
    },
    "POST /items/:id/sync": async (req, id) => {
      const s = await load(); const it = s.items.find(i => i.id === id); if (!it) return fail("Item not found.", 404);
      delete it.wixSkip; const ok = await trySync(s, it);
      await save(s); return json({ ok, item: it });
    },
    "POST /items/:id/delete": async (req, id) => {
      const s = await load(); const it = s.items.find(i => i.id === id); if (!it) return fail("Item not found.", 404);
      let note = "";
      if (it.wixId && wix.configured) { try { await deleteOnWix(wix, it); } catch (e) { note = "It's still on the website; delete it there."; } }
      s.items = s.items.filter(i => i.id !== id);
      for (const p of it.photos || []) if (p.key) await store.delete("photo/" + p.key).catch(() => {});
      await save(s); return json({ ok: !note, note });
    },
    "POST /clear-site": async (req) => {
      const s = await load(); const b = await req.json().catch(() => ({}));
      const min = Number(b.minDays) || 0;
      const due = s.items.filter(i => i.status === "sold" && i.wixId && !i.wixHidden && (Date.now() - Date.parse((i.soldAt || "2000-01-01") + "T12:00:00")) / 864e5 >= min);
      let done = 0, failed = 0;
      for (const it of due) { try { await hideOnWix(wix, it); it.wixHidden = true; delete it.wixErr; done++; } catch (e) { it.wixErr = "Couldn't take it off the website: " + String(e.message).slice(0, 120); failed++; } }
      await save(s); return json({ ok: !failed, done, failed });
    },
    "POST /consignors": async (req) => {
      const s = await load(); const b = await req.json();
      const id = b.id || "c" + rid();
      const cur = s.consignors[id] || { id, added: today() };
      for (const k of ["name", "phone", "email", "notes"]) if (b[k] != null) cur[k] = String(b[k]).trim();
      if (!cur.name) return fail("Add the consignor's name.");
      s.consignors[id] = cur; await save(s); return json({ ok: true, consignor: cur });
    },
    "POST /consignors/:id/delete": async (req, id) => {
      const s = await load(); delete s.consignors[id];
      for (const it of s.items) if (it.consignorId === id) it.consignorId = "";
      await save(s); return json({ ok: true });
    },
    "POST /pay": async (req) => {
      const s = await load(); const b = await req.json(); const d = today(); let n = 0;
      for (const it of s.items) if (it.consignorId === b.consignorId && it.status === "sold" && !it.paidDate) { it.paidDate = d; n++; }
      await save(s); return json({ ok: true, paid: n });
    },
    "POST /clear-sold": async () => {
      const s = await load();
      // Paid-out sold items leave the list; unpaid ones stay so payouts aren't lost.
      const keep = s.items.filter(i => !(i.status === "sold" && (i.paidDate || !i.consignorId || i.consignorId === "__shop")));
      const removed = s.items.length - keep.length;
      s.archive = (s.archive || []).concat(s.items.filter(i => !keep.includes(i)).map(i => ({ ...i, photos: [] }))).slice(-2000);
      s.items = keep; await save(s); return json({ ok: true, removed });
    },
    "POST /import": async () => {
      if (!wix.configured) return fail("Add the Wix API key first.", 503);
      const s = await load();
      const have = new Set(s.items.map(i => i.wixId).filter(Boolean));
      const prods = (await wix.queryProducts()).filter(p => !have.has(p.id))
        .sort((a, b) => String(a.createdDate).localeCompare(String(b.createdDate)));
      for (const p of prods) { const it = itemFromWix(p); it.tag = s.nextTag++; it.split = s.settings.defaultSplit; s.items.push(it); }
      await save(s); return json({ ok: true, added: prods.length });
    },
    "POST /photo": async (req) => {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return fail("No photo was sent.");
      if (buf.byteLength > 5.5e6) return fail("That photo is too large. Try again; the app shrinks photos first.");
      const key = rid() + rid();
      await store.set("photo/" + key, buf, { metadata: { type: req.headers.get("content-type") || "image/jpeg" } });
      return json({ key });
    },
    "GET /img": async (req) => {
      // Lets the phone share website photos (it can't fetch them directly).
      const u = new URL(req.url).searchParams.get("u") || "";
      if (!/^https:\/\/static\.wixstatic\.com\/media\//.test(u)) return fail("Not a website photo.");
      const r = await fetch(u);
      if (!r.ok) return fail("Couldn't load that photo.", 502);
      return new Response(await r.arrayBuffer(), { headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    },
  };

  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
    // Public: photos (Wix fetches them by URL to put them on product pages).
    const pm = path.match(/^\/photo\/([a-z0-9]+)(\.jpg)?$/i);
    if (req.method === "GET" && pm) {
      const r = await store.getWithMetadata("photo/" + pm[1], { type: "arrayBuffer" });
      if (!r) return new Response("Not found", { status: 404 });
      return new Response(r.data, { headers: { "Content-Type": (r.metadata && r.metadata.type) || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    if (req.method === "GET" && path === "/health") return json({ ok: true, passwordSet: !!password, wixReady: wix.configured });

    let handler, param;
    for (const key of Object.keys(routes)) {
      const [m, pat] = key.split(" ");
      if (m !== req.method) continue;
      const rx = new RegExp("^" + pat.replace(/:id/, "([A-Za-z0-9_-]+)") + "$");
      const mm = path.match(rx);
      if (mm) { handler = routes[key]; param = mm[1]; break; }
    }
    if (!handler) return fail("Not found.", 404);
    if (path !== "/login" && !(await authed(req))) return fail("Please sign in again.", 401);
    try { return await handler(req, param); }
    catch (e) { console.error(e); return fail("Something went wrong on the server: " + String(e.message || e).slice(0, 160), 500); }
  };
}

export { tagNo };
