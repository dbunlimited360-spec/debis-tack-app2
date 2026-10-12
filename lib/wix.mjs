// Wix Stores (Catalog V1) sync for Debi's Tack Consignment.
// All calls run server-side with the site's API key; nothing here reaches the phone.

const API = "https://www.wixapis.com";
export const ALL_PRODUCTS = "00000000-000000-000000-000000000001";

export function makeWix({ apiKey, siteId, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        "Authorization": apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.message || data.details?.applicationError?.description)) || text || res.statusText;
      const err = new Error(`Wix ${res.status}: ${String(msg).slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function queryProducts() {
    const out = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const r = await call("POST", "/stores-reader/v1/products/query", { query: { paging: { limit: 100, offset } } });
      const ps = r.products || [];
      out.push(...ps);
      if (ps.length < 100) break;
    }
    return out;
  }

  async function getProduct(id) {
    const filter = JSON.stringify({ id: { $in: [id] } });
    const r = await call("POST", "/stores-reader/v1/products/query", { query: { filter } });
    return (r.products || [])[0] || null;
  }

  async function queryCollections() {
    const r = await call("POST", "/stores-reader/v1/collections/query", { query: { paging: { limit: 100 } } });
    return (r.collections || []).filter(c => c.id !== ALL_PRODUCTS).map(c => ({ id: c.id, name: c.name, visible: c.visible !== false }));
  }

  return { call, queryProducts, getProduct, queryCollections, configured: !!(apiKey && siteId) };
}

export function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function tagNo(n) { return String(n).padStart(4, "0"); }

export function hashStr(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h >>> 0); }

export function coreSigOf(it, settings) {
  return hashStr(JSON.stringify([it.title, it.desc, it.price, it.size, it.brand, it.cond, it.rawDesc ? 1 : 0, it.rawDesc ? "" : (settings.wixFooter || ""), it.rawDesc ? 0 : it.tag]));
}

export function wixDescription(it, settings) {
  const e = t => escHtml(t).replace(/\n/g, "<br>");
  if (it.rawDesc) return "<p>" + e(it.desc || "") + "</p>";
  let h = it.desc ? "<p>" + e(it.desc) + "</p>" : "";
  const facts = [];
  if (it.size) facts.push("Size: " + it.size);
  if (it.brand) facts.push("Maker: " + it.brand);
  if (it.cond) facts.push("Condition: " + it.cond);
  facts.push("Tag " + tagNo(it.tag));
  h += "<p>" + facts.map(e).join("<br>") + "</p>";
  if (settings.wixFooter) h += "<p>" + e(settings.wixFooter) + "</p>";
  return h;
}

function photoPlan(it, publicBase) {
  // Wix-origin photos are re-attached by media id; app photos by public URL.
  return (it.photos || []).map(p => p.mediaId ? { mediaId: p.mediaId } : { url: publicBase + "/api/photo/" + p.key + ".jpg" });
}
function photoSig(it) { return (it.photos || []).map(p => p.mediaId || p.key).join("|"); }

/** Make the Wix product match `it`. Mutates it.wix* fields. Throws on failure. */
export async function syncItem(wix, it, settings, publicBase) {
  const base = "/stores/v1/products";
  const avail = it.status === "available";
  if (it.wixRibbon == null) it.wixRibbon = settings.wixRibbon || "";
  const ribbon = it.status === "sold" ? "Sold" : it.status === "hold" ? "On Hold" : it.wixRibbon;
  const core = { name: it.title.slice(0, 80), description: wixDescription(it, settings), priceData: { price: it.price } };
  const coreSig = coreSigOf(it, settings);

  if (!it.wixId) {
    const prod = { ...core, visible: true, productType: "physical" };
    if (ribbon) prod.ribbon = ribbon;
    const r = await wix.call("POST", base, { product: prod });
    const p = r.product;
    if (!p || !p.id) throw new Error("Wix didn't return the new product.");
    it.wixId = p.id;
    if (p.productPageUrl && p.productPageUrl.base) it.wixUrl = p.productPageUrl.base.replace(/\/$/, "") + p.productPageUrl.path;
    it.wixSig = coreSig;
    it.wixPhotoSig = "";
  } else {
    const upd = { visible: !(it.wixHidden && it.status === "sold"), ribbon: ribbon };
    if (it.wixSig !== coreSig) Object.assign(upd, core);
    await wix.call("PATCH", base + "/" + it.wixId, { product: upd });
    it.wixSig = coreSig;
  }

  const ps = photoSig(it);
  if (ps !== (it.wixPhotoSig || "")) {
    await wix.call("POST", base + "/" + it.wixId + "/media/delete", { mediaIds: [] });
    const plan = photoPlan(it, publicBase);
    if (plan.length) await wix.call("POST", base + "/" + it.wixId + "/media", { media: plan });
    it.wixPhotoSig = ps;
  }

  await syncCollections(wix, it);

  await wix.call("PATCH", "/stores/v2/inventoryItems/product/" + it.wixId, {
    inventoryItem: { productId: it.wixId, trackQuantity: false, variants: [{ variantId: "00000000-0000-0000-0000-000000000000", inStock: avail }] },
  });
  delete it.wixErr;
}

/** Put the product in exactly the store categories chosen in the app. */
export async function syncCollections(wix, it) {
  if (!Array.isArray(it.collections)) return;
  const want = it.collections.filter(c => c && c !== ALL_PRODUCTS);
  const have = Array.isArray(it.wixCollections) ? it.wixCollections : [];
  for (const cid of want.filter(c => !have.includes(c))) await wix.call("POST", "/stores/v1/collections/" + cid + "/productIds", { productIds: [it.wixId] });
  for (const cid of have.filter(c => !want.includes(c))) await wix.call("POST", "/stores/v1/collections/" + cid + "/productIds/delete", { productIds: [it.wixId] });
  it.wixCollections = want.slice();
}

export async function hideOnWix(wix, it) {
  await wix.call("PATCH", "/stores/v1/products/" + it.wixId, { product: { visible: false } });
}

export async function deleteOnWix(wix, it) {
  await wix.call("DELETE", "/stores/v1/products/" + it.wixId);
}

// ---------- import existing website products ----------
function htmlToText(h) {
  return String(h || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function guessCat(name, desc) {
  const t = (name + " " + desc).toLowerCase();
  if (/saddle/.test(t) && !/pad|blanket/.test(t)) return "saddles";
  if (/\bbit\b/.test(t)) return "bits";
  if (/headstall|bridle/.test(t)) return "headstalls";
  if (/\bpad\b|blanket|sheet|cooler|liner|neck cover|big d/.test(t)) return "pads";
  if (/spur|leggin|fly boot|shoulder guard/.test(t)) return "other";
  if (/hat|stetson|greeley|serratelli|bailey|shirt|jacket|vest|chaps|boot|ariat|western wear|showmanship|horsemanship/.test(t)) return "apparel";
  return "other";
}

export function collectionsOf(p) { return (p.collectionIds || []).filter(c => c !== ALL_PRODUCTS); }

export function itemFromWix(p) {
  const desc = htmlToText(p.description);
  const media = (p.media && p.media.items) || [];
  const photos = media.filter(m => m.mediaType === "image" && m.image && m.image.url).map(m => ({ src: m.image.url, mediaId: m.id }));
  const inStock = !p.stock || p.stock.inStock !== false;
  const status = p.ribbon === "Sold" || !inStock ? "sold" : p.ribbon === "On Hold" ? "hold" : "available";
  const it = {
    id: "w-" + p.id.slice(0, 8) + p.id.slice(-4),
    title: p.name || "Item",
    cat: guessCat(p.name || "", desc),
    price: p.priceData ? p.priceData.price : (p.price ? p.price.price : 0),
    cond: "", size: "", brand: "",
    desc,
    photos,
    status,
    added: (p.createdDate || "").slice(0, 10),
    wixId: p.id,
    wixUrl: p.productPageUrl ? p.productPageUrl.base.replace(/\/$/, "") + p.productPageUrl.path : "",
    wixRibbon: ["Sold", "On Hold"].includes(p.ribbon) ? "" : (p.ribbon || ""),
    rawDesc: true,
    wixHidden: p.visible === false,
  };
  it.wixSig = coreSigOf(it, {});
  it.wixPhotoSig = photos.map(p => p.mediaId).join("|");
  it.collections = collectionsOf(p);
  it.wixCollections = it.collections.slice();
  if (status === "sold") it.soldAt = (p.lastUpdated || "").slice(0, 10);
  return it;
}
