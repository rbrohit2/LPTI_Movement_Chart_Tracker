// CSR (Company Airport Service Representative) master list and the market-to-language table.
// Data logic is pure so it can be tested in Node; the init functions wire it to the page.

export const STORAGE_KEY = "lptiCsrMaster";
export const MARKET_STORAGE_KEY = "lptiMarketLanguage";

// Language master from the handover (not free text).
export const LANGUAGES = { EN: "English", HI: "Hindi", FR: "French", DE: "German", ES: "Spanish", IT: "Italian", JA: "Japanese" };
export const PASS_OPTIONS = ["YES", "NO", "N/A"];
export const AVAILABILITY = ["Available", "On leave", "Not available"];

// Initial list transcribed from the printed "CSR DETAILS" sheet. Availability is not on the sheet, so all start as Available.
export const SEED = [
  { name: "HAFEEZ KHAN", languageCode: "IT", airportPass: "YES", mobile: "9893279786", csrCode: "HK", availability: "Available" },
  { name: "ABHAY SINGH RATHORE", languageCode: "IT", airportPass: "YES", mobile: "9079718176", csrCode: "ASR", availability: "Available" },
  { name: "JAI VIKASH", languageCode: "FR", airportPass: "YES", mobile: "9711073074", csrCode: "JV", availability: "Available" },
  { name: "VIKAL SINGH", languageCode: "ES", airportPass: "YES", mobile: "8319161041", csrCode: "VS", availability: "Available" },
  { name: "ARUN KUMAR SONI", languageCode: "ES", airportPass: "N/A", mobile: "9893420851", csrCode: "AS", availability: "Available" },
  { name: "MUKUL JANGID", languageCode: "DE", airportPass: "N/A", mobile: "9784347078", csrCode: "MJ", availability: "Available" },
  { name: "HARSH DWIVEDI", languageCode: "DE", airportPass: "N/A", mobile: "8224976635", csrCode: "HD", availability: "Available" },
];

// Market (file-code prefix) to language. Taken from the handover's prefix suggestions; review before relying on them.
export const MARKET_SEED = [
  { market: "FRA", languageCode: "FR" },
  { market: "FRN", languageCode: "FR" },
  { market: "GER", languageCode: "DE" },
  { market: "SPN", languageCode: "ES" },
  { market: "JPN", languageCode: "JA" },
];

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- CSR records ----------

export function seedCsrs() {
  return SEED.map((r) => ({ id: newId("csr"), ...r }));
}

// Trim, tidy and canonicalise user input before validation.
export function normalizeCsr(input = {}) {
  return {
    name: String(input.name ?? "").trim().replace(/\s+/g, " "),
    languageCode: String(input.languageCode ?? "").trim().toUpperCase(),
    airportPass: String(input.airportPass ?? "").trim().toUpperCase(),
    mobile: String(input.mobile ?? "").replace(/[\s-]/g, ""),
    csrCode: String(input.csrCode ?? "").trim().toUpperCase(),
    availability: String(input.availability ?? "").trim(),
  };
}

// Returns a list of error messages (empty when the record is valid).
export function validateCsr(rec, list = [], editId = null) {
  const errors = [];
  if (!rec.name) errors.push("Name is required.");
  if (!LANGUAGES[rec.languageCode]) errors.push("Choose a language from the list.");
  if (!PASS_OPTIONS.includes(rec.airportPass)) errors.push("Airport pass must be YES, NO or N/A.");
  if (!/^\d{10}$/.test(rec.mobile)) errors.push("Mobile must be 10 digits.");
  if (!/^[A-Z]{2,4}$/.test(rec.csrCode)) errors.push("CSR code must be 2 to 4 letters.");
  if (rec.csrCode && list.some((r) => r.id !== editId && r.csrCode === rec.csrCode)) {
    errors.push(`CSR code ${rec.csrCode} is already used.`);
  }
  if (!AVAILABILITY.includes(rec.availability)) errors.push("Choose an availability option.");
  return errors;
}

export function addCsr(list, input) {
  const rec = normalizeCsr(input);
  const errors = validateCsr(rec, list);
  if (errors.length) return { list, errors };
  return { list: [...list, { id: newId("csr"), ...rec }], errors: [] };
}

export function updateCsr(list, id, input) {
  const rec = normalizeCsr(input);
  const errors = validateCsr(rec, list, id);
  if (errors.length) return { list, errors };
  return { list: list.map((r) => (r.id === id ? { id, ...rec } : r)), errors: [] };
}

export function removeCsr(list, id) {
  return list.filter((r) => r.id !== id);
}

// Records saved before availability existed are treated as Available.
function withDefaults(r) {
  return AVAILABILITY.includes(r.availability) ? r : { ...r, availability: "Available" };
}

export function loadCsrs(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(parsed)) return parsed.map(withDefaults);
  } catch {
    // fall through to the seed list
  }
  const seeded = seedCsrs();
  saveCsrs(storage, seeded);
  return seeded;
}

export function saveCsrs(storage, list) {
  storage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ---------- Market to language ----------

export function seedMarkets() {
  return MARKET_SEED.map((r) => ({ id: newId("mkt"), ...r }));
}

export function normalizeMarket(input = {}) {
  return {
    market: String(input.market ?? "").trim().toUpperCase(),
    languageCode: String(input.languageCode ?? "").trim().toUpperCase(),
  };
}

export function validateMarket(rec, list = [], editId = null) {
  const errors = [];
  if (!/^[A-Z]{2,4}$/.test(rec.market)) errors.push("Market must be 2 to 4 letters.");
  if (!LANGUAGES[rec.languageCode]) errors.push("Choose a language from the list.");
  if (rec.market && list.some((r) => r.id !== editId && r.market === rec.market)) {
    errors.push(`Market ${rec.market} is already listed.`);
  }
  return errors;
}

export function addMarket(list, input) {
  const rec = normalizeMarket(input);
  const errors = validateMarket(rec, list);
  if (errors.length) return { list, errors };
  return { list: [...list, { id: newId("mkt"), ...rec }], errors: [] };
}

export function updateMarket(list, id, input) {
  const rec = normalizeMarket(input);
  const errors = validateMarket(rec, list, id);
  if (errors.length) return { list, errors };
  return { list: list.map((r) => (r.id === id ? { id, ...rec } : r)), errors: [] };
}

export function removeMarket(list, id) {
  return list.filter((r) => r.id !== id);
}

export function loadMarkets(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(MARKET_STORAGE_KEY) || "null");
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to the seed list
  }
  const seeded = seedMarkets();
  saveMarkets(storage, seeded);
  return seeded;
}

export function saveMarkets(storage, list) {
  storage.setItem(MARKET_STORAGE_KEY, JSON.stringify(list));
}

// ---------- Page wiring (browser only) ----------

function fillSelect(doc, sel, options) {
  for (const [value, label] of options) sel.appendChild(new doc.defaultView.Option(label, value));
}

const languageOptions = () => Object.entries(LANGUAGES).map(([code, label]) => [code, `${label} (${code})`]);

export function initCsrSection(doc, storage) {
  const $ = (s) => doc.querySelector(s);
  let list = loadCsrs(storage);
  let editingId = null;

  fillSelect(doc, $("#csrLanguage"), languageOptions());
  fillSelect(doc, $("#csrPass"), PASS_OPTIONS.map((v) => [v, v]));
  fillSelect(doc, $("#csrAvailability"), AVAILABILITY.map((v) => [v, v]));

  const show = (text, isError = false) => {
    const m = $("#csrMessage");
    m.textContent = text;
    m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
  };

  const readForm = () => ({
    name: $("#csrName").value,
    languageCode: $("#csrLanguage").value,
    airportPass: $("#csrPass").value,
    mobile: $("#csrMobile").value,
    csrCode: $("#csrCode").value,
    availability: $("#csrAvailability").value,
  });

  const resetForm = () => {
    editingId = null;
    $("#csrForm").reset();
    $("#csrSubmit").textContent = "Add CSR";
    $("#csrCancel").classList.add("hidden");
  };

  const paint = () => {
    const tbody = $("#csrTable tbody");
    tbody.innerHTML = "";
    list.forEach((r, i) => {
      const tr = doc.createElement("tr");
      const cells = [i + 1, r.name, LANGUAGES[r.languageCode] || r.languageCode, r.airportPass, r.mobile, r.csrCode, r.availability];
      for (const c of cells) {
        const td = doc.createElement("td");
        td.textContent = String(c);
        tr.appendChild(td);
      }
      const actions = doc.createElement("td");
      actions.innerHTML = `<button class="btn" data-action="edit" data-id="${r.id}">Edit</button> <button class="btn danger" data-action="remove" data-id="${r.id}">Remove</button>`;
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    $("#csrCount").textContent = String(list.length);
  };

  $("#csrForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const res = editingId ? updateCsr(list, editingId, readForm()) : addCsr(list, readForm());
    if (res.errors.length) {
      show(res.errors.join(" "), true);
      return;
    }
    const wasEditing = !!editingId;
    list = res.list;
    saveCsrs(storage, list);
    resetForm();
    paint();
    show(wasEditing ? "CSR updated." : "CSR added.");
  });

  $("#csrCancel").addEventListener("click", () => {
    resetForm();
    show("");
  });

  $("#csrTable tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const rec = list.find((r) => r.id === btn.dataset.id);
    if (!rec) return;
    if (btn.dataset.action === "edit") {
      editingId = rec.id;
      $("#csrName").value = rec.name;
      $("#csrLanguage").value = rec.languageCode;
      $("#csrPass").value = rec.airportPass;
      $("#csrMobile").value = rec.mobile;
      $("#csrCode").value = rec.csrCode;
      $("#csrAvailability").value = rec.availability;
      $("#csrSubmit").textContent = "Update CSR";
      $("#csrCancel").classList.remove("hidden");
      show(`Editing ${rec.name}.`);
      $("#csrName").focus();
    } else if (btn.dataset.action === "remove") {
      if (!doc.defaultView.confirm(`Remove ${rec.name} (${rec.csrCode}) from the CSR list?`)) return;
      list = removeCsr(list, rec.id);
      saveCsrs(storage, list);
      if (editingId === rec.id) resetForm();
      paint();
      show(`${rec.name} removed.`);
    }
  });

  resetForm();
  paint();
}

export function initMarketSection(doc, storage) {
  const $ = (s) => doc.querySelector(s);
  let list = loadMarkets(storage);
  let editingId = null;

  fillSelect(doc, $("#marketLanguage"), languageOptions());

  const show = (text, isError = false) => {
    const m = $("#marketMessage");
    m.textContent = text;
    m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
  };

  const resetForm = () => {
    editingId = null;
    $("#marketForm").reset();
    $("#marketSubmit").textContent = "Add market";
    $("#marketCancel").classList.add("hidden");
  };

  const paint = () => {
    const tbody = $("#marketTable tbody");
    tbody.innerHTML = "";
    for (const r of list) {
      const tr = doc.createElement("tr");
      const cells = [r.market, LANGUAGES[r.languageCode] || r.languageCode];
      for (const c of cells) {
        const td = doc.createElement("td");
        td.textContent = String(c);
        tr.appendChild(td);
      }
      const actions = doc.createElement("td");
      actions.innerHTML = `<button class="btn" data-action="edit" data-id="${r.id}">Edit</button> <button class="btn danger" data-action="remove" data-id="${r.id}">Remove</button>`;
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    $("#marketCount").textContent = String(list.length);
  };

  $("#marketForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = { market: $("#marketCode").value, languageCode: $("#marketLanguage").value };
    const res = editingId ? updateMarket(list, editingId, input) : addMarket(list, input);
    if (res.errors.length) {
      show(res.errors.join(" "), true);
      return;
    }
    const wasEditing = !!editingId;
    list = res.list;
    saveMarkets(storage, list);
    resetForm();
    paint();
    show(wasEditing ? "Market updated." : "Market added.");
  });

  $("#marketCancel").addEventListener("click", () => {
    resetForm();
    show("");
  });

  $("#marketTable tbody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const rec = list.find((r) => r.id === btn.dataset.id);
    if (!rec) return;
    if (btn.dataset.action === "edit") {
      editingId = rec.id;
      $("#marketCode").value = rec.market;
      $("#marketLanguage").value = rec.languageCode;
      $("#marketSubmit").textContent = "Update market";
      $("#marketCancel").classList.remove("hidden");
      show(`Editing ${rec.market}.`);
      $("#marketCode").focus();
    } else if (btn.dataset.action === "remove") {
      if (!doc.defaultView.confirm(`Remove market ${rec.market} from the list?`)) return;
      list = removeMarket(list, rec.id);
      saveMarkets(storage, list);
      if (editingId === rec.id) resetForm();
      paint();
      show(`${rec.market} removed.`);
    }
  });

  resetForm();
  paint();
}
