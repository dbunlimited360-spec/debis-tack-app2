// Debi's Tack Consignment — stand-alone phone app.
(function () {
"use strict";

var CATS = [["saddles","Saddles"],["headstalls","Headstalls & Bridles"],["bits","Bits"],["pads","Pads & Blankets"],["apparel","Clothing & Boots"],["other","Other Tack"]];
var CATN = {}; CATS.forEach(function (c) { CATN[c[0]] = c[1]; });
var SIZE_HINT = { saddles: 'Seat size & tree, e.g. 15½", FQHB', headstalls: "Horse / Cob / Arab", bits: 'Mouth width, e.g. 5"', pads: 'e.g. 32" x 32"', apparel: "e.g. Women's 8B", other: "Size (optional)" };
var CONDS = ["New / unused","Excellent","Good","Fair","Project piece"];
var STATUS = { available: "Available", hold: "On hold", sold: "Sold" };
var TAGS = { saddles: "#saddleforsale #usedsaddle #horsetack", headstalls: "#headstall #horsetack #westerntack", bits: "#horsebit #horsetack", pads: "#saddlepad #horseblanket #horsetack", apparel: "#westernwear #showclothes #rodeostyle", other: "#horsetack #spurs #westerntack" };
var MAXPH = 8;

var S = null;
var ui = { tab: "inventory", invFilter: "all", q: "", confirmPay: null };
var form = { photos: [], editing: null, uploading: 0 };
var token = null;
try { token = localStorage.getItem("tc-token"); } catch (e) {}
try { var t0 = sessionStorage.getItem("tc-tab"); if (t0) ui.tab = t0; } catch (e) {}

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { n = Number(n) || 0; return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
function tagNo(n) { return String(n).padStart(4, "0"); }
function today() { return new Date().toLocaleDateString("en-CA"); }
function fmtDate(d) { if (!d) return ""; var p = d.split("-"); return p[1] + "/" + p[2] + "/" + p[0].slice(2); }
function item(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
function cname(id) { var c = S.consignors[id]; return c ? c.name : (id === "__shop" ? "Shop-owned" : ""); }
function root() { return document.getElementById("root"); }
function toast(msg) { var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
function busyOn(msg) { busyOff(); var o = document.createElement("div"); o.className = "overlay"; o.id = "busy"; o.textContent = msg; document.body.appendChild(o); }
function busyOff() { var o = document.getElementById("busy"); if (o) o.remove(); }

function photoSrc(p, size) {
  if (p.key) return "/api/photo/" + p.key + ".jpg";
  var src = p.src || "";
  if (size && /static\.wixstatic\.com\/media\//.test(src)) {
    var m = src.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/]+)/);
    if (m) return m[1] + "/v1/fill/w_" + size + ",h_" + size + ",q_80/file.jpg";
  }
  return src;
}
function pic(it, size) {
  var p = it.photos && it.photos[0];
  if (p) return '<img src="' + esc(photoSrc(p, size || 300)) + '" alt="' + esc(it.title) + '" loading="lazy">';
  return '<div class="ph">' + esc(CATN[it.cat] || "Tack") + '</div>';
}

/* ---------- server ---------- */
async function api(path, body, opts) {
  opts = opts || {};
  var init = { method: body === undefined ? "GET" : "POST", headers: {} };
  if (token) init.headers.Authorization = "Bearer " + token;
  if (body !== undefined) {
    if (body instanceof Blob) { init.body = body; init.headers["Content-Type"] = body.type || "image/jpeg"; }
    else { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  }
  var res;
  try { res = await fetch("/api" + path, init); }
  catch (e) { throw new Error("No connection. Check your signal and try again."); }
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && path !== "/login") { signOut(); throw new Error("Please sign in again."); }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}
async function refresh() { S = await api("/state"); render(); }
function signOut() { token = null; try { localStorage.removeItem("tc-token"); } catch (e) {} S = null; renderLogin(); }

/* ---------- login ---------- */
function renderLogin(err) {
  root().innerHTML = '<form class="login" id="loginForm"><div class="logo">Debi\'s Tack Consignment</div>' +
    '<p>Sign in to manage the shop.</p>' +
    '<label class="fl"><span>Password</span><input class="field" id="pw" name="pw" type="password" autocomplete="current-password" required></label>' +
    (err ? '<p class="err">' + esc(err) + '</p>' : '') +
    '<button class="btn" type="submit">Sign in</button></form>';
  var f = document.getElementById("loginForm");
  f.addEventListener("submit", async function (e) {
    e.preventDefault();
    var pw = document.getElementById("pw").value;
    try {
      var r = await api("/login", { password: pw });
      token = r.token; try { localStorage.setItem("tc-token", token); } catch (x) {}
      await refresh();
    } catch (x) { renderLogin(x.message); }
  });
}

/* ---------- frame ---------- */
function render() {
  if (!S) return;
  try { sessionStorage.setItem("tc-tab", ui.tab); } catch (e) {}
  var h = '<header class="top"><div class="wrap"><div class="logo">' + esc(S.settings.shopName) + '</div><button class="btn ghost sm" data-act="refresh">Refresh</button></div></header>';
  h += '<main class="wrap mgr">';
  if (!S.wixReady) h += '<div class="banner"><p>The website connection isn\'t set up yet, so items stay in the app only. See the setup steps.</p></div>';
  if (ui.tab === "inventory") h += renderInventory();
  else if (ui.tab === "consignors") h += renderConsignors();
  else if (ui.tab === "payouts") h += renderPayouts();
  else h += renderSettings();
  h += '</main>' + renderTabbar();
  var y = window.scrollY; root().innerHTML = h; window.scrollTo(0, y);
}
function renderTabbar() {
  var t = [["inventory","Inventory"],["consignors","Consignors"],["payouts","Payouts"],["settings","Shop"]];
  return '<nav class="tabbar" aria-label="Sections"><div class="wrap">' + t.map(function (x) { return '<button data-act="tab" data-tab="' + x[0] + '"' + (ui.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</button>'; }).join("") + '</div></nav>';
}

/* ---------- inventory ---------- */
function clearDays() { var d = S.settings.wixClearDays; return d == null ? 3 : Number(d) || 0; }
function daysSince(d) { return d ? (Date.now() - Date.parse(d + "T12:00:00")) / 864e5 : 999; }
function soldOnSite(min) { return S.items.filter(function (i) { return i.status === "sold" && i.wixId && !i.wixHidden && daysSince(i.soldAt) >= min; }); }

function renderInventory() {
  var n = { all: S.items.length, available: 0, hold: 0, sold: 0 }; S.items.forEach(function (i) { n[i.status]++; });
  var h = '<div class="row-between"><h2 class="h2">Inventory</h2><button class="btn" data-act="new">Add item</button></div>';
  if (!S.items.length && S.wixReady) h += '<div class="banner"><p>Bring in the products already on your website so you can track them here.</p><button class="btn sm" data-act="import">Bring them in</button></div>';
  var due = soldOnSite(clearDays());
  if (S.wixReady && due.length) h += '<div class="banner"><p>' + due.length + (due.length === 1 ? " sold item has" : " sold items have") + ' shown Sold on your website for ' + clearDays() + '+ days.</p><button class="btn sm" data-act="clearSite" data-days="' + clearDays() + '">Take ' + (due.length === 1 ? "it" : "them") + ' off the website</button></div>';
  h += '<div class="search"><input class="field" id="q" type="search" placeholder="Search name, size or tag #" value="' + esc(ui.q) + '" aria-label="Search inventory"></div>';
  h += '<div class="seg">' + [["all","All"],["available","Available"],["hold","On hold"],["sold","Sold"]].map(function (x) { return '<button class="chip" data-act="inv" data-f="' + x[0] + '" aria-pressed="' + (ui.invFilter === x[0]) + '">' + x[1] + '<small>' + n[x[0]] + '</small></button>'; }).join("") + '</div>';
  h += '<div class="list" id="invList">' + invRows() + '</div>';
  var soldN = n.sold;
  h += '<div class="panel">' +
    (S.wixReady && soldOnSite(0).length ? '<p class="note">Sold items stay on your website with a Sold ribbon until you take them off.</p><button class="btn quiet sm" data-act="clearSite" data-days="0">Take all ' + soldOnSite(0).length + ' sold off the website now</button> ' : '') +
    (soldN ? '<p class="note" style="margin-top:10px">Clearing moves paid-out sold items out of this list. Unpaid ones stay until you pay the consignor.</p><button class="btn quiet sm" data-act="clearSold">Clear paid sold items</button>' : '<p class="note">Sold items will show here until you clear them.</p>') + '</div>';
  return h;
}
function invRows() {
  var q = ui.q.trim().toLowerCase();
  var list = S.items.filter(function (i) {
    if (ui.invFilter !== "all" && i.status !== ui.invFilter) return false;
    if (q) { var hay = (i.title + " " + (i.size || "") + " " + (i.brand || "") + " " + (i.desc || "") + " " + tagNo(i.tag) + " " + cname(i.consignorId)).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
    return true;
  }).sort(function (a, b) { return b.tag - a.tag; });
  if (!list.length) return '<div class="empty">' + (S.items.length ? "Nothing matches. Try another word or tap All." : "No items yet. Tap Add item to tag your first piece.") + '</div>';
  return list.map(function (it) {
    var who = it.consignorId ? cname(it.consignorId) : "";
    return '<div class="irow"><div class="th">' + pic(it, 120) + '</div><div class="mid"><div class="t">' + esc(it.title) + '</div>' +
      '<div class="m">Tag ' + tagNo(it.tag) + ' · ' + money(it.price) + (who ? ' · ' + esc(who) : ' · no consignor') + (it.status === "sold" && it.soldPrice != null ? ' · sold ' + money(it.soldPrice) : '') + '</div>' +
      webLine(it) +
      (it.status !== "sold" ? '<div class="wixline"><button class="btn quiet sm" data-act="share" data-id="' + it.id + '">Share</button></div>' : '') +
      '</div><div class="r"><span class="pill ' + it.status + '">' + STATUS[it.status] + '</span><span style="display:flex;gap:6px">' +
      (it.status === "sold" ? '<button class="btn quiet sm" data-act="unsell" data-id="' + it.id + '">Undo sale</button>' : '<button class="btn sm" data-act="sell" data-id="' + it.id + '">Sold</button>') +
      '<button class="btn quiet sm" data-act="edit" data-id="' + it.id + '">Edit</button></span></div></div>';
  }).join("");
}
function webLine(it) {
  if (!S.wixReady) return "";
  if (it.wixErr) return '<div class="wixline"><span class="pill err">Website not updated</span><button class="btn quiet sm" data-act="sync" data-id="' + it.id + '">Try again</button></div><div class="note err">' + esc(it.wixErr) + '</div>';
  if (it.wixId) return '<div class="wixline"><span class="pill web">' + (it.status === "available" ? "On website" : it.status === "sold" ? (it.wixHidden ? "Off website" : "Shows Sold on website") : "Shows On Hold on website") + '</span>' + (it.wixUrl ? '<a href="' + esc(it.wixUrl) + '" target="_blank" rel="noopener">View</a>' : '') + '</div>';
  if (S.settings.wixSync && it.status === "available") return '<div class="wixline"><span class="note">Not on website</span><button class="btn quiet sm" data-act="sync" data-id="' + it.id + '">Post to website</button></div>';
  return "";
}

/* ---------- consignors + payouts ---------- */
function consignorStats(cid) {
  var r = { inShop: 0, sold: 0, owed: 0 };
  S.items.forEach(function (it) { if (it.consignorId !== cid) return; if (it.status === "sold") { r.sold++; if (!it.paidDate) r.owed += (it.soldPrice || 0) * (it.split || 0) / 100; } else r.inShop++; });
  (S.archive || []).forEach(function (it) { if (it.consignorId === cid) r.sold++; });
  return r;
}
function renderConsignors() {
  var h = '<div class="row-between"><h2 class="h2">Consignors</h2><button class="btn" data-act="newC">Add consignor</button></div>';
  var list = Object.keys(S.consignors).map(function (k) { return S.consignors[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!list.length) return h + '<div class="empty">No consignors yet. Add the people who bring you tack, then pick them when you tag an item.</div>';
  return h + '<div class="list">' + list.map(function (c) { var s = consignorStats(c.id);
    return '<button class="ccard" data-act="editC" data-id="' + c.id + '"><span class="nm">' + esc(c.name) + '</span><span class="ln">' + (c.phone ? '<span>' + esc(c.phone) + '</span>' : '') + '<span><b>' + s.inShop + '</b> in shop</span><span><b>' + s.sold + '</b> sold</span>' + (s.owed ? '<span class="owe"><b class="owe">' + money(s.owed) + '</b> owed</span>' : '') + '</span></button>'; }).join("") + '</div>';
}
function renderPayouts() {
  var month = today().slice(0, 7), owedTot = 0, cut = 0, soldM = 0, soldN = 0, groups = {}, paid = [];
  S.items.concat(S.archive || []).forEach(function (it) {
    if (it.status !== "sold" || it.soldPrice == null) return;
    var consigned = it.consignorId && it.consignorId !== "__shop";
    var share = consigned ? it.soldPrice * (it.split || 0) / 100 : 0;
    if ((it.soldAt || "").slice(0, 7) === month) { soldM += it.soldPrice; soldN++; cut += it.soldPrice - share; }
    if (!consigned) return;
    if (!it.paidDate) { owedTot += share; (groups[it.consignorId] = groups[it.consignorId] || []).push({ it: it, share: share }); }
    else paid.push({ it: it, share: share });
  });
  var h = '<h2 class="h2">Payouts</h2><div class="stats"><div class="stat"><b>' + money(owedTot) + '</b><span>Owed to consignors</span></div><div class="stat"><b>' + money(cut) + '</b><span>Shop\'s share this month</span></div><div class="stat"><b>' + money(soldM) + '</b><span>' + soldN + ' sold this month</span></div></div>';
  var keys = Object.keys(groups);
  if (!keys.length) h += '<div class="empty">Nobody is owed right now. When you mark a consigned item Sold, the consignor\'s share shows up here.</div>';
  h += '<div class="list">';
  keys.forEach(function (k) { var rows = groups[k], tot = rows.reduce(function (a, r) { return a + r.share; }, 0);
    h += '<div class="pay"><div class="row-between"><b style="font-size:17px">' + esc(cname(k) || "Removed consignor") + '</b><span class="owe" style="font-family:var(--f-head);font-size:20px;font-weight:700">' + money(tot) + '</span></div><table>';
    rows.forEach(function (r) { h += '<tr><td>Tag ' + tagNo(r.it.tag) + ' · ' + esc(r.it.title) + '<br><span class="note">Sold ' + fmtDate(r.it.soldAt) + ' for ' + money(r.it.soldPrice) + ' · ' + r.it.split + '% to consignor</span></td><td>' + money(r.share) + '</td></tr>'; });
    h += '</table>' + (ui.confirmPay === k ? '<div class="actions"><button class="btn" data-act="payConfirm" data-id="' + k + '">Confirm paid ' + money(tot) + '</button><button class="btn quiet" data-act="payCancel">Cancel</button></div>' : '<button class="btn quiet sm" data-act="pay" data-id="' + k + '">Mark as paid</button>') + '</div>'; });
  h += '</div>';
  if (paid.length) { paid.sort(function (a, b) { return (b.it.paidDate || "").localeCompare(a.it.paidDate || ""); });
    h += '<div class="panel"><h2>Recently paid</h2><div class="pay" style="border:0;padding:0"><table>' + paid.slice(0, 20).map(function (r) { return '<tr><td>' + esc(cname(r.it.consignorId) || "Consignor") + ' · Tag ' + tagNo(r.it.tag) + '<br><span class="note">Paid ' + fmtDate(r.it.paidDate) + '</span></td><td>' + money(r.share) + '</td></tr>'; }).join("") + '</table></div></div>'; }
  return h;
}

/* ---------- settings ---------- */
function fl(label, ctrl, help) { return '<label class="fl"><span>' + esc(label) + '</span>' + ctrl + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>'; }
function renderSettings() {
  var s = S.settings;
  return '<h2 class="h2">Shop details</h2><form class="f panel" id="settingsForm">' +
    fl("Shop name", '<input class="field" id="set-shopName" name="shopName" required value="' + esc(s.shopName) + '">') +
    fl("Phone for calls & texts", '<input class="field" id="set-phone" name="phone" type="tel" value="' + esc(s.phone) + '">', "Goes in social posts.") +
    fl("Website", '<input class="field" id="set-website" name="website" type="url" value="' + esc(s.website) + '">') +
    fl("Usual consignor share (%)", '<input class="field" id="set-split" name="defaultSplit" type="number" min="0" max="100" step="1" value="' + esc(s.defaultSplit) + '">', "Used for new items. You can change it per item.") +
    '<label class="check" style="color:var(--ink)"><input type="checkbox" id="set-wixSync" name="wixSync" value="1"' + (s.wixSync ? " checked" : "") + '> Post new items to the website store</label>' +
    fl("Website ribbon for new items", '<input class="field" id="set-wixRibbon" name="wixRibbon" value="' + esc(s.wixRibbon || "") + '" placeholder="New Arrival">', "Leave blank for no ribbon.") +
    fl("Days to show Sold on the website", '<input class="field" id="set-wixClearDays" name="wixClearDays" type="number" min="0" max="60" step="1" value="' + clearDays() + '">') +
    fl("Line added to every website listing", '<input class="field" id="set-wixFooter" name="wixFooter" value="' + esc(s.wixFooter || "") + '">') +
    '<div class="actions"><button class="btn" type="submit">Save shop details</button></div></form>' +
    (S.wixReady ? '<div class="panel"><h2>Website products</h2><p>Bring in any products that were added on the website directly, so they show here too.</p><button class="btn quiet sm" data-act="import">Check the website for new products</button></div>' : '') +
    '<div class="panel"><h2>On your phone</h2><p>In Safari, tap Share, then Add to Home Screen. On Android, open the ⋮ menu, then Add to Home screen.</p><button class="btn quiet sm" data-act="signout">Sign out</button></div>';
}

/* ---------- sheets ---------- */
function openSheet(title, body, extraHead) {
  closeSheet();
  var d = document.createElement("div"); d.className = "sheet"; d.id = "sheet";
  d.innerHTML = '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheet-head"><h3>' + esc(title) + '</h3>' + (extraHead || "") + '<button class="btn quiet sm" data-act="close">Close</button></div>' + body + '</div>';
  document.body.appendChild(d); document.documentElement.style.overflow = "hidden";
  d.addEventListener("click", function (e) { if (e.target === d) closeSheet(); });
  d.addEventListener("click", onClick); d.addEventListener("change", onChange); d.addEventListener("submit", onSubmit);
}
function closeSheet() { var d = document.getElementById("sheet"); if (d) d.remove(); document.documentElement.style.overflow = ""; }

function openItemForm(id) {
  var it = id ? item(id) : null;
  form.editing = id || null; form.photos = it && it.photos ? it.photos.slice() : [];
  var cat = it ? it.cat : "saddles";
  var cs = Object.keys(S.consignors).map(function (k) { return S.consignors[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  var b = '<form class="f" id="itemForm">';
  b += '<div class="fl"><span>Photos (up to ' + MAXPH + ')</span><div class="photostrip" id="photostrip"></div><small>The first photo is the main one on the website.</small><small id="photoErr" class="err" hidden></small></div>';
  b += fl("What is it?", '<input class="field" id="f-title" name="title" required maxlength="80" value="' + esc(it ? it.title : "") + '" placeholder="15½&quot; Barrel Saddle, FQHB">');
  b += '<div class="two">' + fl("Type", '<select class="field" id="f-cat" name="cat">' + CATS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === cat ? " selected" : "") + '>' + esc(c[1]) + '</option>'; }).join("") + '</select>') +
    fl("Price ($)", '<input class="field" id="f-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" required value="' + esc(it ? it.price : "") + '">') + '</div>';
  b += '<div class="two">' + fl("Condition", '<select class="field" id="f-cond" name="cond"><option value=""' + (it && !it.cond ? " selected" : "") + '>Not set</option>' + CONDS.map(function (c) { return '<option' + ((it ? it.cond : "Good") === c ? " selected" : "") + '>' + c + '</option>'; }).join("") + '</select>') +
    fl("Size", '<input class="field" id="f-size" name="size" value="' + esc(it ? it.size : "") + '" placeholder="' + esc(SIZE_HINT[cat]) + '">') + '</div>';
  b += fl("Maker / brand", '<input class="field" id="f-brand" name="brand" value="' + esc(it ? it.brand : "") + '" placeholder="Optional">');
  b += fl("Description", '<textarea class="field" id="f-desc" name="desc" placeholder="Leather, tree, wear, what\'s included">' + esc(it ? it.desc : "") + '</textarea>');
  b += fl("Status", '<select class="field" id="f-status" name="status">' + Object.keys(STATUS).filter(function (k) { return k !== "sold" || (it && it.status === "sold"); }).map(function (k) { return '<option value="' + k + '"' + ((it ? it.status : "available") === k ? " selected" : "") + '>' + STATUS[k] + '</option>'; }).join("") + '</select>');
  if (S.wixReady && S.settings.wixSync) b += '<label class="check" style="color:var(--ink)"><input type="checkbox" id="f-towix" name="toWix" value="1"' + ((it ? !it.wixSkip : true) ? " checked" : "") + '> ' + (it && it.wixId ? "Update it on the website too" : "Post it to the website too") + '</label>';
  b += '<div class="sub-block"><span class="note"><b>Private</b> · never shown on the website</span>';
  b += fl("Consignor", '<select class="field" id="f-consignor" name="consignorId"><option value="">Choose…</option>' + cs.map(function (c) { return '<option value="' + c.id + '"' + (it && it.consignorId === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("") + '<option value="__new">+ New consignor…</option><option value="__shop"' + (it && it.consignorId === "__shop" ? " selected" : "") + '>Shop-owned (not consigned)</option></select>');
  b += '<div id="newC" class="two" hidden>' + fl("New consignor's name", '<input class="field" id="f-newname" name="newName">') + fl("Phone", '<input class="field" id="f-newphone" name="newPhone" type="tel">') + '</div>';
  b += '<div class="two">' + fl("Consignor gets (%)", '<input class="field" id="f-split" name="split" type="number" min="0" max="100" step="1" value="' + esc(it && it.split != null ? it.split : S.settings.defaultSplit) + '">') +
    fl("Date brought in", '<input class="field" id="f-datein" name="dateIn" type="date" value="' + esc((it && it.dateIn) || today()) + '">') + '</div>';
  b += fl("Notes", '<input class="field" id="f-notes" name="notes" value="' + esc(it ? it.notes || "" : "") + '" placeholder="Lowest price OK, pick-up date, etc.">');
  b += '</div><p id="formErr" class="err" hidden></p>';
  b += '<div class="actions"><button class="btn" type="submit">' + (it ? "Save changes" : "Add to shop") + '</button>' + (it ? '<button class="btn quiet" type="button" data-act="askDel">Delete</button>' : '') + '</div>';
  if (it) b += '<div id="delRow" class="banner" hidden><p>Delete Tag ' + tagNo(it.tag) + '? It\'s removed from the website too.</p><button class="btn danger sm" type="button" data-act="del" data-id="' + it.id + '">Delete</button></div>';
  b += '</form>';
  var head = it && it.status !== "sold" ? '<button class="btn share sm" type="button" data-act="share" data-id="' + it.id + '">Share</button>' : '';
  openSheet(it ? "Tag " + tagNo(it.tag) : "New item · Tag " + tagNo(S.nextTag), b, head);
  drawPhotos();
}
function drawPhotos() {
  var el = document.getElementById("photostrip"); if (!el) return;
  var h = form.photos.map(function (p, i) { return '<div class="pthumb' + (p.mediaId ? " wixp" : "") + '"><img src="' + esc(p.preview || photoSrc(p, 200)) + '" alt="Photo ' + (i + 1) + '"><button type="button" data-act="rmPhoto" data-i="' + i + '" aria-label="Remove photo">×</button></div>'; }).join("");
  if (form.uploading) h += '<div class="addphoto">Uploading ' + form.uploading + '…</div>';
  else if (form.photos.length < MAXPH) h += '<label class="addphoto">Add photos<input id="f-photo" type="file" accept="image/*" multiple></label>';
  el.innerHTML = h;
}
function resize(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { b ? res(b) : rej(new Error("Couldn't read that photo.")); }, "image/jpeg", 0.82);
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("That file isn't a photo this phone can read. Try a JPG or PNG.")); };
    img.src = url;
  });
}

function openSell(id) {
  var it = item(id);
  openSheet("Sell Tag " + tagNo(it.tag), '<form class="f" id="sellForm" data-id="' + id + '"><p>' + esc(it.title) + ' · listed at ' + money(it.price) + '</p><div class="two">' +
    fl("Sold for ($)", '<input class="field" id="s-price" name="soldPrice" type="number" inputmode="decimal" min="0" step="0.01" required value="' + esc(it.price) + '">') +
    fl("Date sold", '<input class="field" id="s-date" name="soldDate" type="date" required value="' + today() + '">') + '</div>' +
    '<p class="note">It gets a Sold ribbon on the website and can\'t be bought online. The consignor\'s share goes to Payouts.</p><div class="actions"><button class="btn" type="submit">Mark sold</button></div></form>');
}
function openConsignor(id) {
  var c = (id && S.consignors[id]) || {};
  var b = '<form class="f" id="cForm" data-id="' + (id || "") + '">' + fl("Name", '<input class="field" id="c-name" name="name" required value="' + esc(c.name) + '">') +
    '<div class="two">' + fl("Phone", '<input class="field" id="c-phone" name="phone" type="tel" value="' + esc(c.phone) + '">') + fl("Email", '<input class="field" id="c-email" name="email" type="email" value="' + esc(c.email) + '">') + '</div>' +
    fl("Notes", '<textarea class="field" id="c-notes" name="notes" placeholder="How they like to be paid, pick-up arrangements">' + esc(c.notes) + '</textarea>');
  if (id) { var s = consignorStats(id); b += '<p class="note">' + s.inShop + ' in shop · ' + s.sold + ' sold · ' + money(s.owed) + ' owed</p>'; }
  b += '<div class="actions"><button class="btn" type="submit">' + (id ? "Save" : "Add consignor") + '</button>' + (id ? '<button class="btn quiet" type="button" data-act="askDel">Delete</button>' : '') + '</div>';
  if (id) b += '<div id="delRow" class="banner" hidden><p>Delete ' + esc(c.name) + '? Their items stay but lose the consignor link.</p><button class="btn danger sm" type="button" data-act="delC" data-id="' + id + '">Delete</button></div>';
  openSheet(id ? "Consignor" : "New consignor", b + '</form>');
}

/* ---------- share to social ---------- */
function itemLink(it) { return it.wixUrl || S.settings.website || ""; }
function caption(it) {
  var L = [];
  L.push(it.title + " | " + money(it.price));
  var facts = [it.size ? "Size " + it.size : "", it.cond ? it.cond + " condition" : ""].filter(Boolean).join(" · "); if (facts) L.push(facts);
  var d = (it.desc || "").replace(/\*/g, "").replace(/\n{2,}/g, "\n").trim();
  if (d && d.toLowerCase() !== it.title.toLowerCase()) { if (d.length > 420) d = d.slice(0, 400).replace(/\s+\S*$/, "") + "…"; L.push(""); L.push(d); }
  L.push("");
  var link = itemLink(it); if (link) L.push("Shop it here: " + link);
  if (S.settings.phone) L.push("Questions? Call or text " + S.settings.phone);
  L.push("Ask about Tag " + tagNo(it.tag) + ".");
  L.push(""); L.push((TAGS[it.cat] || "#horsetack") + " #consignment #debistackboutique");
  return L.join("\n");
}
var shareFiles = [];
async function openShare(id) {
  var it = item(id); if (!it) return;
  shareFiles = [];
  var canFiles = !!(navigator.canShare && navigator.share);
  var b = '<div class="sharepics" id="sharepics">' + (it.photos || []).slice(0, 5).map(function (p) { return '<img src="' + esc(photoSrc(p, 200)) + '" alt="">'; }).join("") + '</div>' +
    '<textarea class="sharebox" id="shareText" aria-label="Post text">' + esc(caption(it)) + '</textarea>' +
    '<p class="note" style="margin:6px 0 12px">Change the wording here if you like. The post is copied when you tap Share, so you can paste it in Facebook or Instagram.</p>' +
    '<div class="actions">' + (canFiles ? '<button class="btn share" type="button" id="shareGo" data-act="shareGo" disabled>Getting photos…</button>' : '') +
    '<button class="btn ' + (canFiles ? 'quiet' : 'share') + '" type="button" data-act="copyPost">Copy post</button>' +
    (itemLink(it) ? '<button class="btn quiet" type="button" data-act="copyLink" data-text="' + esc(itemLink(it)) + '">Copy link only</button>' : '') + '</div>';
  openSheet("Share Tag " + tagNo(it.tag), b);
  if (!canFiles) return;
  var files = [];
  for (var i = 0; i < Math.min(5, (it.photos || []).length); i++) {
    var p = it.photos[i];
    try {
      var r = p.key ? await fetch("/api/photo/" + p.key + ".jpg")
        : await fetch("/api/img?u=" + encodeURIComponent(photoSrc(p, 1600)), { headers: { Authorization: "Bearer " + token } });
      if (r.ok) { var bl = await r.blob(); files.push(new File([bl], "tag-" + tagNo(it.tag) + "-" + (i + 1) + ".jpg", { type: "image/jpeg" })); }
    } catch (e) {}
  }
  shareFiles = files;
  var btn = document.getElementById("shareGo"); if (!btn) return;
  btn.disabled = false;
  btn.textContent = files.length ? "Share with " + files.length + (files.length === 1 ? " photo" : " photos") : "Share";
}
async function doShare() {
  var ta = document.getElementById("shareText"); var text = ta ? ta.value : "";
  try { navigator.clipboard.writeText(text).catch(function () {}); } catch (e) {}
  var data = { text: text, title: "" };
  if (shareFiles.length && navigator.canShare({ files: shareFiles })) data.files = shareFiles;
  try { await navigator.share(data); toast("Shared. If the words didn't come through, paste them in."); }
  catch (e) { if (e && e.name !== "AbortError") toast("Sharing didn't open. Use Copy post instead."); }
}
async function copyText(text, btn, ta, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
  catch (x) { if (ta) { ta.focus(); ta.select(); } btn.textContent = ta ? "Selected, now tap Copy" : "Couldn't copy"; }
  setTimeout(function () { btn.textContent = label; }, 2200);
}

/* ---------- actions ---------- */
async function run(msg, fn, okMsg) {
  busyOn(msg);
  try { var r = await fn(); busyOff(); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); return r; }
  catch (e) { busyOff(); toast(e.message); return null; }
}
function webNote(r, base) { return base + (r && r.item && r.item.wixId && S.settings.wixSync && !r.item.wixSkip ? (r.ok ? " and updated on the website" : ". The website didn't update; see the item") : ""); }

async function saveItem(f) {
  var fd = new FormData(f), err = document.getElementById("formErr"); err.hidden = true;
  if (form.uploading) { err.textContent = "Wait for the photos to finish uploading."; err.hidden = false; return; }
  var cid = fd.get("consignorId") || "";
  var body = { id: form.editing || undefined, title: fd.get("title"), cat: fd.get("cat"), price: fd.get("price"), cond: fd.get("cond"), size: fd.get("size"), brand: fd.get("brand"), desc: fd.get("desc"), status: fd.get("status"),
    photos: form.photos.map(function (p) { return p.mediaId ? { src: p.src, mediaId: p.mediaId } : { key: p.key }; }),
    split: fd.get("split"), dateIn: fd.get("dateIn"), notes: fd.get("notes"), toWix: S.wixReady && S.settings.wixSync ? !!fd.get("toWix") : undefined };
  if (cid === "__new") { var nm = (fd.get("newName") || "").trim(); if (!nm) { err.textContent = "Type the new consignor's name, or pick one from the list."; err.hidden = false; return; } body.newConsignor = { name: nm, phone: fd.get("newPhone") }; }
  else body.consignorId = cid;
  closeSheet();
  var r = await run(form.editing ? "Saving…" : "Adding it to the shop…", function () { return api("/items", body); });
  if (!r) return;
  await refresh();
  var tag = tagNo(r.item.tag);
  var base = form.editing ? "Saved Tag " + tag : "Tag " + tag + " is in the shop";
  toast(r.item.wixSkip || !S.wixReady || !S.settings.wixSync ? base : base + (r.ok ? " and on the website" : ". The website didn't update; see the item"));
}

async function onClick(e) {
  var b = e.target.closest("[data-act]"); if (!b || b.tagName === "LABEL") return;
  var a = b.dataset.act, id = b.dataset.id;
  if (a === "close") closeSheet();
  else if (a === "refresh") { await run("Refreshing…", refresh); }
  else if (a === "tab") { ui.tab = b.dataset.tab; ui.confirmPay = null; window.scrollTo(0, 0); render(); }
  else if (a === "inv") { ui.invFilter = b.dataset.f; render(); }
  else if (a === "new") openItemForm(null);
  else if (a === "edit") openItemForm(id);
  else if (a === "sell") openSell(id);
  else if (a === "share") openShare(id);
  else if (a === "shareGo") doShare();
  else if (a === "copyPost") { var ta = document.getElementById("shareText"); copyText(ta ? ta.value : "", b, ta, "Copy post"); }
  else if (a === "copyLink") copyText(b.dataset.text, b, null, "Copy link only");
  else if (a === "unsell") { var r1 = await run("Putting it back on the rack…", function () { return api("/items/" + id + "/unsell", {}); }); if (r1) { await refresh(); toast(webNote(r1, "Tag " + tagNo(r1.item.tag) + " is available again")); } }
  else if (a === "sync") { var r2 = await run("Updating the website…", function () { return api("/items/" + id + "/sync", {}); }); if (r2) { await refresh(); toast(r2.ok ? "The website is up to date" : "The website still didn't accept it; see the item"); } }
  else if (a === "rmPhoto") { form.photos.splice(Number(b.dataset.i), 1); drawPhotos(); }
  else if (a === "askDel") { var d = document.getElementById("delRow"); if (d) d.hidden = !d.hidden; }
  else if (a === "del") { closeSheet(); var r3 = await run("Deleting…", function () { return api("/items/" + id + "/delete", {}); }); if (r3) { await refresh(); toast(r3.note ? "Deleted here. " + r3.note : "Deleted"); } }
  else if (a === "newC") openConsignor(null);
  else if (a === "editC") openConsignor(id);
  else if (a === "delC") { closeSheet(); if (await run("Deleting…", function () { return api("/consignors/" + id + "/delete", {}); }, "Consignor deleted")) await refresh(); }
  else if (a === "pay") { ui.confirmPay = id; render(); }
  else if (a === "payCancel") { ui.confirmPay = null; render(); }
  else if (a === "payConfirm") { ui.confirmPay = null; if (await run("Recording the payout…", function () { return api("/pay", { consignorId: id }); }, "Payout recorded for " + cname(id))) await refresh(); }
  else if (a === "clearSite") { var r4 = await run("Taking sold items off the website…", function () { return api("/clear-site", { minDays: Number(b.dataset.days) || 0 }); }); if (r4) { await refresh(); toast(r4.done + (r4.done === 1 ? " item" : " items") + " taken off the website" + (r4.failed ? ". " + r4.failed + " didn't go through; see the items" : "")); } }
  else if (a === "clearSold") { var r5 = await run("Clearing…", function () { return api("/clear-sold", {}); }); if (r5) { await refresh(); toast(r5.removed ? r5.removed + " paid sold items cleared" : "Nothing to clear yet. Sold items stay until their consignor is paid."); } }
  else if (a === "import") { var r6 = await run("Checking the website… this can take a minute", function () { return api("/import", {}); }); if (r6) { await refresh(); toast(r6.added ? r6.added + " website products brought in" : "Everything on the website is already here"); } }
  else if (a === "signout") signOut();
}
async function onChange(e) {
  var t = e.target;
  if (t.id === "f-cat") { var sz = document.getElementById("f-size"); if (sz) sz.placeholder = SIZE_HINT[t.value] || ""; }
  else if (t.id === "f-consignor") { var nc = document.getElementById("newC"); if (nc) nc.hidden = t.value !== "__new"; if (t.value === "__shop") { var sp = document.getElementById("f-split"); if (sp) sp.value = 0; } }
  else if (t.id === "f-photo" && t.files && t.files.length) {
    var er = document.getElementById("photoErr"); er.hidden = true;
    var fs = Array.prototype.slice.call(t.files), room = MAXPH - form.photos.length, skipped = Math.max(0, fs.length - room);
    fs = fs.slice(0, room); form.uploading = fs.length; drawPhotos();
    for (var i = 0; i < fs.length; i++) {
      try { var blob = await resize(fs[i]); var r = await api("/photo", blob); form.photos.push({ key: r.key, preview: URL.createObjectURL(blob) }); }
      catch (x) { er.textContent = x.message; er.hidden = false; }
      form.uploading--; drawPhotos();
    }
    if (skipped) { er.textContent = "Only " + MAXPH + " photos fit per item, so " + skipped + " weren't added."; er.hidden = false; }
  }
}
async function onSubmit(e) {
  e.preventDefault(); var f = e.target, fd = new FormData(f);
  if (f.id === "itemForm") saveItem(f);
  else if (f.id === "sellForm") { closeSheet(); var r = await run("Marking it sold…", function () { return api("/items/" + f.dataset.id + "/sell", { soldPrice: fd.get("soldPrice"), soldDate: fd.get("soldDate") }); }); if (r) { await refresh(); toast(webNote(r, "Tag " + tagNo(r.item.tag) + " marked sold")); } }
  else if (f.id === "cForm") { closeSheet(); var body = { id: f.dataset.id || undefined, name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email"), notes: fd.get("notes") }; if (await run("Saving…", function () { return api("/consignors", body); }, f.dataset.id ? "Saved" : "Consignor added")) await refresh(); }
  else if (f.id === "settingsForm") { var sb = {}; ["shopName","phone","website","wixRibbon","wixFooter"].forEach(function (k) { sb[k] = fd.get(k) || ""; }); sb.defaultSplit = fd.get("defaultSplit"); sb.wixClearDays = fd.get("wixClearDays"); sb.wixSync = !!fd.get("wixSync");
    if (await run("Saving…", function () { return api("/settings", sb); }, "Shop details saved")) await refresh(); }
}

var r0 = root();
r0.addEventListener("click", onClick); r0.addEventListener("change", onChange); r0.addEventListener("submit", onSubmit);
r0.addEventListener("input", function (e) { if (e.target.id === "q") { ui.q = e.target.value; var l = document.getElementById("invList"); if (l) l.innerHTML = invRows(); } });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
document.addEventListener("visibilitychange", function () { if (!document.hidden && S && !document.getElementById("sheet")) refresh().catch(function () {}); });

if (!token) renderLogin();
else refresh().catch(function (e) { if (token) root().innerHTML = '<div class="login"><p class="err">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>'; });
})();
