// End-to-end test of the server against an in-memory store and a fake Wix.
import assert from "node:assert/strict";
import { makeHandler } from "../lib/core.mjs";
import { makeWix } from "../lib/wix.mjs";

function memStore() {
  const m = new Map();
  return {
    async get(k, o) { const v = m.get(k); if (v == null) return null; return o && o.type === "json" ? JSON.parse(v.data) : v.data; },
    async getWithMetadata(k) { const v = m.get(k); return v ? { data: v.data, metadata: v.metadata } : null; },
    async set(k, data, o) { m.set(k, { data, metadata: (o && o.metadata) || {} }); },
    async setJSON(k, obj) { m.set(k, { data: JSON.stringify(obj) }); },
    async delete(k) { m.delete(k); },
    _m: m,
  };
}

const calls = [];
const products = {
  "p-existing-0001": { id: "p-existing-0001", name: "Greeley", description: "<p>Greeley black hat 6 7/8</p><p>***Buyer pays for shipping***</p>", visible: true,
    priceData: { price: 450 }, ribbon: "New Arrival", stock: { inStock: true }, createdDate: "2026-09-01T00:00:00Z",
    productPageUrl: { base: "https://www.debistackboutique.com/", path: "/product-page/greeley" },
    media: { items: [{ id: "f2cfaf_aaa~mv2.png", mediaType: "image", image: { url: "https://static.wixstatic.com/media/f2cfaf_aaa~mv2.png/v1/fit/w_4284,h_5712,q_90/file.png" } }] } },
};
let n = 0;
async function fakeFetch(url, init) {
  const u = new URL(url); const body = init.body ? JSON.parse(init.body) : null;
  assert.equal(init.headers.Authorization, "KEY"); assert.equal(init.headers["wix-site-id"], "SITE");
  calls.push([init.method, u.pathname, body]);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (u.pathname === "/stores-reader/v1/products/query") return ok({ products: Object.values(products) });
  if (init.method === "POST" && u.pathname === "/stores/v1/products") { const id = "p-new-" + (++n); return ok({ product: { id, productPageUrl: { base: "https://www.debistackboutique.com/", path: "/product-page/x" + n } } }); }
  if (u.pathname.includes("fail")) return new Response(JSON.stringify({ message: "boom" }), { status: 400 });
  return ok({});
}

const store = memStore();
const wix = makeWix({ apiKey: "KEY", siteId: "SITE", fetchImpl: fakeFetch });
const handle = makeHandler({ store, wix, env: { APP_PASSWORD: "saddle up", URL: "https://tack.example.app" } });
let token = "";
async function req(method, path, body, raw) {
  const init = { method, headers: {} };
  if (token) init.headers.authorization = "Bearer " + token;
  if (body !== undefined) { init.body = raw ? body : JSON.stringify(body); init.headers["content-type"] = raw ? "image/jpeg" : "application/json"; }
  const r = await handle(new Request("https://tack.example.app/api" + path, init));
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, data: ct.includes("json") ? await r.json() : await r.arrayBuffer() };
}
const step = (s) => console.log("✓", s);

// auth
assert.equal((await req("GET", "/state")).status, 401);
assert.equal((await req("POST", "/login", { password: "wrong" })).status, 401);
token = (await req("POST", "/login", { password: "saddle up" })).data.token; assert.ok(token);
let st = (await req("GET", "/state")).data; assert.equal(st.wixReady, true); assert.equal(st.items.length, 0);
token = token.slice(0, -2) + "xx"; assert.equal((await req("GET", "/state")).status, 401);
token = (await req("POST", "/login", { password: "saddle up" })).data.token;
step("sign-in works and bad tokens are refused");

// import
let r = await req("POST", "/import", {}); assert.equal(r.data.added, 1);
st = (await req("GET", "/state")).data;
const g = st.items[0]; assert.equal(g.title, "Greeley"); assert.equal(g.tag, 101); assert.equal(g.photos[0].mediaId, "f2cfaf_aaa~mv2.png"); assert.equal(g.cat, "apparel");
assert.equal((await req("POST", "/import", {})).data.added, 0);
step("website products import once, with their photos");

// sell imported item: only ribbon/visibility + stock, no description rewrite, no photo change
calls.length = 0;
r = await req("POST", `/items/${g.id}/sell`, { soldPrice: 400, soldDate: "2026-10-01" }); assert.equal(r.data.ok, true);
assert.deepEqual(calls.map(c => c[0] + " " + c[1]), ["PATCH /stores/v1/products/p-existing-0001", "PATCH /stores/v2/inventoryItems/product/p-existing-0001"]);
assert.deepEqual(calls[0][2], { product: { visible: true, ribbon: "Sold" } });
assert.equal(calls[1][2].inventoryItem.variants[0].inStock, false);
step("selling an imported item only changes its ribbon and stock");

// upload a photo, create a new item
const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
r = await req("POST", "/photo", jpeg, true); const key = r.data.key; assert.ok(key);
const ph = await req("GET", `/photo/${key}.jpg`); assert.equal(ph.status, 200); assert.equal(new Uint8Array(ph.data)[0], 255);
calls.length = 0;
r = await req("POST", "/items", { title: "Circle Y 16\" Saddle", cat: "saddles", price: "1200", cond: "Good", size: "16\"", desc: "Nice", status: "available", photos: [{ key }], newConsignor: { name: "Jane Rider", phone: "555" }, toWix: true });
assert.equal(r.data.ok, true); const ni = r.data.item; assert.equal(ni.tag, 102); assert.equal(ni.wixId, "p-new-1"); assert.ok(ni.consignorId);
assert.equal(calls[0][2].product.ribbon, "New Arrival");
assert.ok(calls[0][2].product.description.includes("Tag 0102")); assert.ok(calls[0][2].product.description.includes("Buyer pays for shipping"));
const media = calls.find(c => c[1] === "/stores/v1/products/p-new-1/media"); assert.equal(media[2].media[0].url, `https://tack.example.app/api/photo/${key}.jpg`);
step("new item goes to the website with ribbon, description and full-size photo link");

// edit price only → name/desc/price sent, photos untouched
calls.length = 0;
r = await req("POST", "/items", { id: ni.id, title: ni.title, cat: "saddles", price: 1100, cond: "Good", size: "16\"", desc: "Nice", status: "available", photos: [{ key }], consignorId: ni.consignorId, toWix: true });
assert.equal(calls[0][2].product.priceData.price, 1100);
assert.ok(!calls.some(c => c[1].endsWith("/media") || c[1].endsWith("/media/delete")));
// edit nothing → no content fields
calls.length = 0;
await req("POST", "/items", { id: ni.id, title: ni.title, cat: "saddles", price: 1100, cond: "Good", size: "16\"", desc: "Nice", status: "hold", photos: [{ key }], consignorId: ni.consignorId, toWix: true });
assert.deepEqual(calls[0][2], { product: { visible: true, ribbon: "On Hold" } });
step("edits send only what changed; On hold shows a ribbon");

// sell + payout
await req("POST", `/items/${ni.id}/sell`, { soldPrice: 1000, soldDate: "2026-10-05" });
st = (await req("GET", "/state")).data;
const sold = st.items.find(i => i.id === ni.id); assert.equal(sold.split, 70); assert.equal(sold.soldPrice, 1000);
r = await req("POST", "/pay", { consignorId: ni.consignorId }); assert.equal(r.data.paid, 1);
r = await req("POST", "/clear-sold", {}); assert.equal(r.data.removed, 2, "paid consigned + unconsigned sold items clear");
st = (await req("GET", "/state")).data; assert.equal(st.items.length, 0); assert.equal(st.archive.length, 2);
step("sale, payout and clearing paid sold items work");

// clear from site
await req("POST", "/import", {}); // Greeley comes back since it's no longer in items
st = (await req("GET", "/state")).data; const g2 = st.items[0];
await req("POST", `/items/${g2.id}/sell`, { soldPrice: 450, soldDate: "2026-09-01" });
calls.length = 0;
r = await req("POST", "/clear-site", { minDays: 3 }); assert.equal(r.data.done, 1);
assert.deepEqual(calls[0][2], { product: { visible: false } });
r = await req("POST", `/items/${g2.id}/unsell`, {}); assert.equal(r.data.item.status, "available");
st = (await req("GET", "/state")).data; assert.ok(!st.items[0].wixHidden);
step("sold items come off the website after the waiting days; undo puts them back");

// failure path
const wixBad = makeWix({ apiKey: "KEY", siteId: "SITE", fetchImpl: async (u, i) => fakeFetch(u.replace("/stores/v1/products", "/stores/v1/fail"), i) });
const h2 = makeHandler({ store, wix: wixBad, env: { APP_PASSWORD: "saddle up", URL: "https://x" } });
const res = await h2(new Request("https://x/api/items", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ title: "Bit", cat: "bits", price: 40, status: "available", toWix: true }) }));
const d = await res.json(); assert.equal(d.ok, false); assert.ok(d.item.wixErr.includes("boom"));
step("a website error is saved on the item instead of losing it");

// img proxy refuses other hosts
assert.equal((await req("GET", "/img?u=" + encodeURIComponent("https://evil.example/x.jpg"))).status, 400);
step("photo proxy only fetches website photos");
console.log("\nAll tests passed.");
