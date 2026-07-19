/* =========================================================
   POP Invoice App — offline-first vanilla JS + IndexedDB
   ========================================================= */

const CATEGORIES = ["Tiles", "Plaster Bags", "Design", "Others"];
const QUICK_NAMES = ["walk-in customer", "cash sale"];
let DB;
let currentPayMethod = "Cash";
let itemRowCount = 0;
let currentPreviousDue = 0;
let dueLookupTimer = null;

function custKey(name) {
  return name.trim().toLowerCase();
}

function isTrackedName(name) {
  if (!name || !name.trim()) return false;
  return !QUICK_NAMES.includes(custKey(name));
}

/* ---------- IndexedDB setup ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("popInvoiceDB", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("invoices")) {
        const store = db.createObjectStore("invoices", { keyPath: "id", autoIncrement: true });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("invNumber", "invNumber", { unique: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("customers")) {
        db.createObjectStore("customers", { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}

function tx(storeName, mode) {
  return DB.transaction(storeName, mode).objectStore(storeName);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readonly").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readonly").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

/* ---------- Settings (stored in meta store) ---------- */
const DEFAULT_SETTINGS = {
  key: "settings",
  companyName: "Plaster of Paris Workshop",
  companyPhone: "",
  companyAddress: "",
  prefix: "INV-",
  currency: "Rs.",
  lastInvoiceSeq: 0
};

let SETTINGS = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  const s = await idbGet("meta", "settings");
  if (s) SETTINGS = s;
  else await idbPut("meta", SETTINGS);
  applySettingsToUI();
}

function applySettingsToUI() {
  document.getElementById("homeCompanyName").textContent = SETTINGS.companyName || "My Workshop";
  document.getElementById("homeCompanySub").textContent = "Invoice & Daily Sales";
  document.getElementById("homeLogo").textContent = (SETTINGS.companyName || "PP").trim().slice(0,2).toUpperCase();
  document.getElementById("setCompanyName").value = SETTINGS.companyName || "";
  document.getElementById("setCompanyPhone").value = SETTINGS.companyPhone || "";
  document.getElementById("setCompanyAddress").value = SETTINGS.companyAddress || "";
  document.getElementById("setPrefix").value = SETTINGS.prefix || "INV-";
  document.getElementById("setCurrency").value = SETTINGS.currency || "Rs.";
}

async function saveSettings() {
  SETTINGS.companyName = document.getElementById("setCompanyName").value.trim() || "My Workshop";
  SETTINGS.companyPhone = document.getElementById("setCompanyPhone").value.trim();
  SETTINGS.companyAddress = document.getElementById("setCompanyAddress").value.trim();
  SETTINGS.prefix = document.getElementById("setPrefix").value.trim() || "INV-";
  SETTINGS.currency = document.getElementById("setCurrency").value.trim() || "Rs.";
  await idbPut("meta", SETTINGS);
  applySettingsToUI();
  showToast("Settings saved");
}

/* ---------- Navigation ---------- */
function goTo(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
  document.querySelectorAll("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.s === screen));
  if (screen === "invoice") prepareNewInvoice();
  if (screen === "history") renderHistory();
  if (screen === "sales") renderDailySales();
  if (screen === "ledger") renderLedger();
  window.scrollTo(0,0);
}

/* ---------- Toast ---------- */
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------- Invoice number generation ---------- */
function nextInvoiceNumber() {
  const seq = SETTINGS.lastInvoiceSeq + 1;
  return SETTINGS.prefix + String(seq).padStart(6, "0");
}

function prepareNewInvoice() {
  document.getElementById("invNumber").value = nextInvoiceNumber();
  document.getElementById("invDate").value = new Date().toISOString().slice(0,10);
  document.getElementById("custName").value = "";
  document.getElementById("custPhone").value = "";
  document.getElementById("sumDiscount").value = 0;
  document.getElementById("sumPaid").value = 0;
  setPayMethod("Cash");
  document.getElementById("itemRows").innerHTML = "";
  itemRowCount = 0;
  addItemRow();
  currentPreviousDue = 0;
  document.getElementById("dueBanner").classList.add("hidden");
  document.getElementById("prevDueLine").classList.add("hidden");
  document.getElementById("payableLine").classList.add("hidden");
  populateCustomerDatalist();
  recalc();
}

function quickCustomer(name) {
  document.getElementById("custName").value = name;
  onCustNameChange();
}

async function populateCustomerDatalist() {
  const all = await idbGetAll("customers");
  const dl = document.getElementById("customerNamesList");
  dl.innerHTML = all.map(c => `<option value="${c.displayName}">`).join("");
}

function onCustNameChange() {
  clearTimeout(dueLookupTimer);
  dueLookupTimer = setTimeout(refreshDueBanner, 250);
}

async function refreshDueBanner() {
  const name = document.getElementById("custName").value.trim();
  const banner = document.getElementById("dueBanner");
  if (!isTrackedName(name)) {
    currentPreviousDue = 0;
    banner.classList.add("hidden");
    recalc();
    return;
  }
  const cust = await idbGet("customers", custKey(name));
  currentPreviousDue = cust ? (cust.balance || 0) : 0;

  if (currentPreviousDue > 0) {
    banner.textContent = `⚠️ ${name} ka pehle se ${fmtMoney(currentPreviousDue)} baqaya hai`;
    banner.classList.remove("hidden", "credit");
  } else if (currentPreviousDue < 0) {
    banner.textContent = `✅ ${name} ka ${fmtMoney(Math.abs(currentPreviousDue))} advance jama hai`;
    banner.classList.remove("hidden");
    banner.classList.add("credit");
  } else {
    banner.classList.add("hidden");
  }
  recalc();
}

/* ---------- Item rows ---------- */
function addItemRow() {
  itemRowCount++;
  const id = "row" + itemRowCount;
  const wrap = document.createElement("div");
  wrap.className = "item-row";
  wrap.id = id;
  wrap.innerHTML = `
    <button type="button" class="remove-x" onclick="removeItemRow('${id}')">×</button>
    <div class="field" style="margin-bottom:8px;">
      <label>Category</label>
      <select class="row-category" oninput="recalc()">
        ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}
      </select>
    </div>
    <div class="field" style="margin-bottom:8px;">
      <label>Description</label>
      <input type="text" class="row-desc" placeholder="e.g. Ceiling design panel">
    </div>
    <div class="two-col">
      <div class="field" style="margin-bottom:0;">
        <label>Qty</label>
        <input type="number" class="row-qty" value="1" min="0" step="0.01" oninput="recalc()">
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Rate</label>
        <input type="number" class="row-rate" value="0" min="0" step="0.01" oninput="recalc()">
      </div>
    </div>
    <div class="item-total">Total: <span class="row-total">Rs. 0</span></div>
  `;
  document.getElementById("itemRows").appendChild(wrap);
  recalc();
}

function removeItemRow(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  if (document.getElementById("itemRows").children.length === 0) addItemRow();
  recalc();
}

function fmtMoney(n) {
  return (SETTINGS.currency || "Rs.") + " " + Math.round(n).toLocaleString("en-PK");
}

function collectItems() {
  const rows = document.querySelectorAll("#itemRows .item-row");
  const items = [];
  rows.forEach(r => {
    const category = r.querySelector(".row-category").value;
    const desc = r.querySelector(".row-desc").value.trim();
    const qty = parseFloat(r.querySelector(".row-qty").value) || 0;
    const rate = parseFloat(r.querySelector(".row-rate").value) || 0;
    const total = qty * rate;
    r.querySelector(".row-total").textContent = fmtMoney(total);
    items.push({ category, desc, qty, rate, total });
  });
  return items;
}

function recalc() {
  const items = collectItems();
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = parseFloat(document.getElementById("sumDiscount").value) || 0;
  const grand = Math.max(subtotal - discount, 0);
  const paid = parseFloat(document.getElementById("sumPaid").value) || 0;
  const totalPayable = grand + currentPreviousDue;
  const remaining = totalPayable - paid;

  document.getElementById("sumSubtotal").textContent = fmtMoney(subtotal);
  document.getElementById("sumGrand").textContent = fmtMoney(grand);

  const prevDueLine = document.getElementById("prevDueLine");
  const payableLine = document.getElementById("payableLine");
  if (currentPreviousDue !== 0) {
    prevDueLine.classList.remove("hidden");
    payableLine.classList.remove("hidden");
    document.getElementById("sumPrevDue").textContent = fmtMoney(currentPreviousDue);
    document.getElementById("sumTotalPayable").textContent = fmtMoney(totalPayable);
  } else {
    prevDueLine.classList.add("hidden");
    payableLine.classList.add("hidden");
  }
  document.getElementById("sumRemaining").textContent = fmtMoney(remaining);
}

function setPayMethod(method) {
  currentPayMethod = method;
  document.getElementById("payCash").classList.toggle("active", method === "Cash");
  document.getElementById("payCredit").classList.toggle("active", method === "Credit");
}

/* ---------- Save invoice ---------- */
async function saveInvoice() {
  const items = collectItems().filter(i => i.desc || i.qty > 0);
  if (items.length === 0) { showToast("Add at least one item"); return; }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = parseFloat(document.getElementById("sumDiscount").value) || 0;
  const grand = Math.max(subtotal - discount, 0);
  const paid = parseFloat(document.getElementById("sumPaid").value) || 0;
  const previousDue = currentPreviousDue;
  const totalPayable = grand + previousDue;
  const remaining = totalPayable - paid;

  const customerName = document.getElementById("custName").value.trim() || "Walk-in Customer";
  const customerPhone = document.getElementById("custPhone").value.trim();

  const invoice = {
    invNumber: document.getElementById("invNumber").value,
    date: document.getElementById("invDate").value,
    customerName, customerPhone,
    items, subtotal, discount, grand,
    previousDue, totalPayable, paid, remaining,
    paymentMethod: currentPayMethod,
    createdAt: new Date().toISOString()
  };

  await idbPut("invoices", invoice);
  SETTINGS.lastInvoiceSeq += 1;
  await idbPut("meta", SETTINGS);

  if (isTrackedName(customerName)) {
    const key = custKey(customerName);
    let cust = (await idbGet("customers", key)) || { key, displayName: customerName, phone: "", balance: 0, history: [] };
    cust.displayName = customerName;
    if (customerPhone) cust.phone = customerPhone;
    cust.balance = remaining;
    cust.lastDate = invoice.date;
    cust.history = cust.history || [];
    cust.history.push({ date: invoice.date, type: "invoice", invNumber: invoice.invNumber, amount: grand, paid, balanceAfter: remaining });
    await idbPut("customers", cust);
  }

  showToast("Invoice " + invoice.invNumber + " saved");
  openInvoiceView(invoice);
  goTo("home");
  refreshHomeStats();
}

/* ---------- History ---------- */
async function renderHistory() {
  const all = (await idbGetAll("invoices")).sort((a,b) => (b.id - a.id));
  const q = document.getElementById("histSearch").value.trim().toLowerCase();
  const dateFilter = document.getElementById("histDate").value;
  const list = document.getElementById("historyList");

  const filtered = all.filter(inv => {
    const matchQ = !q || inv.invNumber.toLowerCase().includes(q) || (inv.customerName||"").toLowerCase().includes(q);
    const matchDate = !dateFilter || inv.date === dateFilter;
    return matchQ && matchDate;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📭</div>No invoices found.</div>`;
    return;
  }

  list.innerHTML = filtered.map(inv => {
    let statusClass = "status-unpaid", statusText = "Unpaid";
    if (inv.remaining <= 0) { statusClass = "status-paid"; statusText = "Paid"; }
    else if (inv.paid > 0) { statusClass = "status-partial"; statusText = "Partial"; }
    return `
      <div class="inv-card" onclick='openInvoiceView(${JSON.stringify(inv).replace(/'/g, "&apos;")})'>
        <div class="row1">
          <span class="inv-no">${inv.invNumber}</span>
          <span class="inv-date">${inv.date}</span>
        </div>
        <div class="row2">
          <span class="cust">${inv.customerName}</span>
          <span class="amt">${fmtMoney(inv.grand)}</span>
        </div>
        <div style="margin-top:8px;"><span class="status-pill ${statusClass}">${statusText}</span></div>
      </div>
    `;
  }).join("");
}

/* ---------- Customer Ledger ---------- */
async function renderLedger() {
  const all = await idbGetAll("customers");
  const q = (document.getElementById("ledgerSearch").value || "").trim().toLowerCase();
  const filtered = all
    .filter(c => !q || c.displayName.toLowerCase().includes(q))
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const list = document.getElementById("ledgerList");
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">👥</div>Koi customer record nahi mila.<br><span style="font-size:12px;">Naam daal ke invoice banane pe yahan customer aana shuru ho jayenge.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(c => {
    const bal = c.balance || 0;
    let balText, cls;
    if (bal > 0) { balText = fmtMoney(bal) + " due"; cls = "balance-due"; }
    else if (bal < 0) { balText = fmtMoney(Math.abs(bal)) + " advance"; cls = "balance-credit"; }
    else { balText = "Clear"; cls = "balance-clear"; }
    return `
      <div class="inv-card" onclick="openCustomerModal('${c.key.replace(/'/g, "\\'")}')">
        <div class="row1">
          <span class="inv-no">${c.displayName}</span>
          <span class="inv-date">${c.lastDate || ""}</span>
        </div>
        <div class="row2">
          <span class="cust">${c.phone || "No phone"}</span>
          <span class="amt ${cls}">${balText}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function openCustomerModal(key) {
  const cust = await idbGet("customers", key);
  if (!cust) return;
  document.getElementById("customerModalContent").innerHTML = buildCustomerModalHTML(cust);
  document.getElementById("customerModal").classList.remove("hidden");
}

function closeCustomerModal() {
  document.getElementById("customerModal").classList.add("hidden");
}

function buildCustomerModalHTML(cust) {
  const bal = cust.balance || 0;
  let balText, cls;
  if (bal > 0) { balText = fmtMoney(bal) + " baqaya"; cls = "balance-due"; }
  else if (bal < 0) { balText = fmtMoney(Math.abs(bal)) + " advance jama"; cls = "balance-credit"; }
  else { balText = "Clear — kuch bhi due nahi"; cls = "balance-clear"; }

  const historyRows = (cust.history || []).slice().reverse().map(h => {
    if (h.type === "invoice") {
      return `<div class="summary-line"><span>${h.date} • ${h.invNumber}</span><span>${fmtMoney(h.amount)} (paid ${fmtMoney(h.paid)})</span></div>`;
    }
    return `<div class="summary-line"><span>${h.date} • Payment Received</span><span>${fmtMoney(h.amount)}</span></div>`;
  }).join("");

  return `
    <h3>${cust.displayName}</h3>
    <p style="color:var(--ink-soft); font-size:13px; margin-top:-8px;">${cust.phone || "No phone on file"}</p>
    <div class="card">
      <div class="summary-line total"><span>Current Balance</span><span class="${cls}">${balText}</span></div>
    </div>
    <div class="card">
      <h3>Transaction History</h3>
      ${historyRows || `<p style="color:var(--ink-soft); font-size:13px; margin:0;">Koi transaction nahi.</p>`}
    </div>
    <div class="card">
      <h3>Receive Payment</h3>
      <div class="field"><label>Amount Received</label><input type="number" id="paymentAmount" min="0" value="0"></div>
      <button class="primary-btn" onclick="receivePayment('${cust.key.replace(/'/g, "\\'")}')">💰 Receive Payment</button>
    </div>
  `;
}

async function receivePayment(key) {
  const amt = parseFloat(document.getElementById("paymentAmount").value) || 0;
  if (amt <= 0) { showToast("Amount daalo"); return; }

  const cust = await idbGet("customers", key);
  if (!cust) return;
  cust.balance = (cust.balance || 0) - amt;
  cust.lastDate = new Date().toISOString().slice(0, 10);
  cust.history = cust.history || [];
  cust.history.push({ date: cust.lastDate, type: "payment", amount: amt, balanceAfter: cust.balance });
  await idbPut("customers", cust);

  showToast("Payment record ho gaya");
  closeCustomerModal();
  renderLedger();
}

/* ---------- Daily Sales ---------- */
async function renderDailySales() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById("salesDateLabel").textContent = "Today — " + today;
  const all = await idbGetAll("invoices");
  const todays = all.filter(inv => inv.date === today);

  const catTotals = {};
  CATEGORIES.forEach(c => catTotals[c] = { qty: 0, amt: 0 });

  let totalQty = 0, totalAmt = 0;
  todays.forEach(inv => {
    inv.items.forEach(it => {
      if (!catTotals[it.category]) catTotals[it.category] = { qty: 0, amt: 0 };
      catTotals[it.category].qty += it.qty;
      catTotals[it.category].amt += it.total;
      totalQty += it.qty;
      totalAmt += it.total;
    });
  });

  const grid = document.getElementById("salesGrid");
  grid.innerHTML = CATEGORIES.map(c => `
    <div class="sales-card">
      <div class="cat-name">${c}</div>
      <div class="cat-amt">${fmtMoney(catTotals[c].amt)}</div>
      <div class="cat-qty">Qty: ${catTotals[c].qty}</div>
    </div>
  `).join("");

  document.getElementById("salesTotalQty").textContent = totalQty;
  document.getElementById("salesTotalAmt").textContent = fmtMoney(totalAmt);
}

async function refreshHomeStats() {
  const today = new Date().toISOString().slice(0,10);
  const all = await idbGetAll("invoices");
  const todays = all.filter(inv => inv.date === today);
  const totalAmt = todays.reduce((s, inv) => s + inv.grand, 0);
  document.getElementById("homeTodayAmt").textContent = fmtMoney(totalAmt);
  document.getElementById("homeTodayCount").textContent = todays.length;
}

/* ---------- Invoice preview / PDF / print ---------- */
let CURRENT_VIEW_INVOICE = null;

function openInvoiceView(inv) {
  CURRENT_VIEW_INVOICE = inv;
  const html = buildInvoiceHTML(inv);
  document.getElementById("invoicePreviewContent").innerHTML = html;
  document.getElementById("invoiceModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("invoiceModal").classList.add("hidden");
}

function buildInvoiceHTML(inv) {
  const rows = inv.items.map(i => `
    <tr>
      <td>${i.category}</td>
      <td>${i.desc || "-"}</td>
      <td class="num">${i.qty}</td>
      <td class="num">${fmtMoney(i.rate)}</td>
      <td class="num">${fmtMoney(i.total)}</td>
    </tr>
  `).join("");

  return `
    <div class="invoice-preview">
      <div class="ip-header">
        <div>
          <h2>${SETTINGS.companyName}</h2>
          <p>${SETTINGS.companyPhone || ""}</p>
          <p>${SETTINGS.companyAddress || ""}</p>
        </div>
        <div class="ip-meta">
          <div><b>${inv.invNumber}</b></div>
          <div>${inv.date}</div>
          <div>${inv.customerName}</div>
          <div>${inv.customerPhone || ""}</div>
        </div>
      </div>
      <table class="ip-table">
        <thead><tr><th>Category</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary-line"><span>Subtotal</span><span>${fmtMoney(inv.subtotal)}</span></div>
      <div class="summary-line"><span>Discount</span><span>${fmtMoney(inv.discount)}</span></div>
      <div class="summary-line total"><span>Invoice Amount</span><span>${fmtMoney(inv.grand)}</span></div>
      ${inv.previousDue ? `
      <div class="summary-line"><span>Previous Due</span><span>${fmtMoney(inv.previousDue)}</span></div>
      <div class="summary-line"><span>Total Payable</span><span>${fmtMoney(inv.totalPayable)}</span></div>` : ""}
      <div class="summary-line"><span>Paid (${inv.paymentMethod})</span><span>${fmtMoney(inv.paid)}</span></div>
      <div class="summary-line total"><span>Balance After</span><span>${fmtMoney(inv.remaining)}</span></div>
      <p style="text-align:center; margin-top:16px; color:var(--ink-soft); font-size:13px;">Thank you for your business!</p>
      <div style="margin-top:30px; display:flex; justify-content:flex-end;">
        <div style="border-top:1px solid var(--line); width:160px; text-align:center; padding-top:6px; font-size:12px; color:var(--ink-soft);">Signature</div>
      </div>
    </div>
  `;
}

/* Builds a narrow 80mm receipt layout for thermal printers.
   Works with Bluetooth thermal-printer apps (e.g. RawBT) that
   capture the browser print job, or with USB/network thermal
   printers via the normal Android print dialog. */
function buildThermalReceiptHTML(inv) {
  const line = "-".repeat(32);
  const pad = (l, r, w = 32) => {
    l = String(l); r = String(r);
    const gap = Math.max(w - l.length - r.length, 1);
    return l + " ".repeat(gap) + r;
  };
  const money = (n) => (SETTINGS.currency || "Rs.") + Math.round(n).toLocaleString("en-PK");

  const itemLines = inv.items.map(i => {
    const desc = `${i.desc || i.category}`.slice(0, 32);
    const qtyRate = `${i.qty} x ${money(i.rate)}`;
    return `${desc}\n${pad(qtyRate, money(i.total))}`;
  }).join("\n");

  return `
    <div class="receipt">
      <div class="center bold big">${SETTINGS.companyName}</div>
      ${SETTINGS.companyPhone ? `<div class="center">${SETTINGS.companyPhone}</div>` : ""}
      ${SETTINGS.companyAddress ? `<div class="center">${SETTINGS.companyAddress}</div>` : ""}
      <div class="dash">${line}</div>
      <div>${pad("Invoice#:", inv.invNumber)}</div>
      <div>${pad("Date:", inv.date)}</div>
      <div>${pad("Customer:", inv.customerName)}</div>
      ${inv.customerPhone ? `<div>${pad("Phone:", inv.customerPhone)}</div>` : ""}
      <div class="dash">${line}</div>
      <pre>${itemLines}</pre>
      <div class="dash">${line}</div>
      <div>${pad("Subtotal", money(inv.subtotal))}</div>
      <div>${pad("Discount", money(inv.discount))}</div>
      <div class="bold">${pad("Invoice Amount", money(inv.grand))}</div>
      ${inv.previousDue ? `
      <div>${pad("Previous Due", money(inv.previousDue))}</div>
      <div class="bold">${pad("Total Payable", money(inv.totalPayable))}</div>` : ""}
      <div>${pad("Paid (" + inv.paymentMethod + ")", money(inv.paid))}</div>
      <div class="bold">${pad("Balance After", money(inv.remaining))}</div>
      <div class="dash">${line}</div>
      <div class="center">Thank you for your business!</div>
      <div class="center small">Signature: ____________</div>
    </div>
  `;
}

function printInvoice() {
  const w = window.open("", "_blank");
  w.document.write(`<html><head><title>${CURRENT_VIEW_INVOICE.invNumber}</title>
    <style>
      @page { size: 80mm auto; margin: 2mm; }
      html,body{ width:76mm; margin:0; padding:0; }
      body{
        font-family:'Courier New', Consolas, monospace;
        font-size:12px; line-height:1.45; color:#000; padding:2mm 3mm;
      }
      .receipt div, .receipt pre{ margin:0; white-space:pre-wrap; word-break:break-word; }
      .center{ text-align:center; }
      .bold{ font-weight:700; }
      .big{ font-size:15px; }
      .small{ font-size:10px; }
      .dash{ letter-spacing:-0.5px; }
      pre{ font-family:inherit; }
    </style></head><body>${buildThermalReceiptHTML(CURRENT_VIEW_INVOICE)}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function shareInvoicePdf() {
  const inv = CURRENT_VIEW_INVOICE;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16); doc.setTextColor(11,61,140);
  doc.text(SETTINGS.companyName, 14, 18);
  doc.setFontSize(10); doc.setTextColor(90,110,140);
  doc.text(SETTINGS.companyPhone || "", 14, 24);
  doc.text(SETTINGS.companyAddress || "", 14, 29);

  doc.setFontSize(11); doc.setTextColor(20,30,50);
  doc.text(`Invoice: ${inv.invNumber}`, 150, 18);
  doc.text(`Date: ${inv.date}`, 150, 24);
  doc.text(`Customer: ${inv.customerName}`, 150, 30);

  let y = 42;
  doc.setFontSize(10); doc.setTextColor(255,255,255);
  doc.setFillColor(20,80,163);
  doc.rect(14, y-5, 182, 8, "F");
  doc.text("Category", 16, y);
  doc.text("Description", 55, y);
  doc.text("Qty", 120, y);
  doc.text("Rate", 140, y);
  doc.text("Total", 170, y);
  y += 8;
  doc.setTextColor(20,30,50);
  inv.items.forEach(it => {
    doc.text(String(it.category), 16, y);
    doc.text(String(it.desc || "-").slice(0,28), 55, y);
    doc.text(String(it.qty), 120, y);
    doc.text(String(it.rate), 140, y);
    doc.text(fmtMoney(it.total), 170, y);
    y += 7;
  });

  y += 4;
  doc.line(14, y, 196, y); y += 8;
  const lines = [
    ["Subtotal", fmtMoney(inv.subtotal)],
    ["Discount", fmtMoney(inv.discount)],
    ["Invoice Amount", fmtMoney(inv.grand)],
  ];
  if (inv.previousDue) {
    lines.push(["Previous Due", fmtMoney(inv.previousDue)]);
    lines.push(["Total Payable", fmtMoney(inv.totalPayable)]);
  }
  lines.push([`Paid (${inv.paymentMethod})`, fmtMoney(inv.paid)]);
  lines.push(["Balance After", fmtMoney(inv.remaining)]);
  lines.forEach(([l, v]) => {
    doc.text(l, 140, y);
    doc.text(v, 170, y);
    y += 7;
  });

  doc.setFontSize(9); doc.setTextColor(120,130,150);
  doc.text("Thank you for your business!", 14, y + 12);

  const fileName = `${inv.invNumber}.pdf`;
  doc.save(fileName);
  showToast("PDF saved: " + fileName);
}

/* ---------- Init ---------- */
window.addEventListener("load", async () => {
  DB = await openDB();
  await loadSettings();
  await refreshHomeStats();
  prepareNewInvoice();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
