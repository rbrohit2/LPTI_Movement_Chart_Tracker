// CSR bookings page. Loads one CSR's bookings for a date and lets them accept or reject.
import { rpc } from "./supabase.js";
import { toast } from "./toast.js";

const $ = (s) => document.querySelector(s);
const pageMsg = (text, isError = false) => {
  const m = $("#pageMessage");
  m.textContent = text;
  m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
  toast(text, isError);
};

const LABEL = { ARRIVAL: "Arrival", DEPARTURE: "Departure", TRANSFER: "Transfer", OTHER: "Other" };

function field(label, value) {
  const d = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = label;
  d.appendChild(b);
  d.appendChild(document.createTextNode(value || "—"));
  return d;
}

function card(b, onAction) {
  const el = document.createElement("section");
  el.className = "card booking-card";

  const top = document.createElement("div");
  top.className = "booking-top";
  const time = document.createElement("div");
  time.className = "booking-time";
  time.textContent = b.scheduled_time || "Time not set";
  const badge = document.createElement("span");
  badge.className = "badge" + (b.status === "Accepted" ? " accepted" : "");
  badge.textContent = b.status;
  top.append(time, badge);
  el.appendChild(top);

  const title = document.createElement("div");
  title.textContent = `${LABEL[b.movement_type] || b.movement_type || "Movement"} · ${b.mode || ""} ${b.flight || ""}`.replace(/\s+/g, " ").trim();
  title.style.fontWeight = "650";
  el.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "booking-grid";
  grid.append(
    field("Guest group", b.guest_group),
    field("FH", b.fh),
    field("File code", b.file_code),
    field("Pax", b.pax),
    field("Pickup", b.pickup),
    field("Drop", b.dropoff),
    field("Report / pickup time", b.reporting_time),
    field("Vehicle", b.vehicle),
    field("Report at", b.report_at)
  );
  el.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "booking-actions";
  // "Reallocated" means another CSR rejected it and it was passed to this CSR; they can still accept or reject.
  if (b.status === "Allocated" || b.status === "Reallocated") {
    const acc = document.createElement("button");
    acc.className = "btn primary";
    acc.textContent = "Accept";
    acc.onclick = () => onAction(b, "accept");
    const rej = document.createElement("button");
    rej.className = "btn danger";
    rej.textContent = "Reject";
    rej.onclick = () => {
      if (confirm("Reject this booking? It will be passed to another CSR.")) onAction(b, "reject");
    };
    actions.append(acc, rej);
  }
  el.appendChild(actions);
  return el;
}

let current = null; // { csr, pin, date }

async function loadBookings() {
  const out = $("#bookings");
  out.innerHTML = "";
  const rows = await rpc("my_roster", { p_csr: current.csr, p_pin: current.pin, p_date: current.date });
  if (!rows.length) {
    pageMsg(`No bookings for ${current.date}.`);
    return;
  }
  pageMsg(`${rows.length} booking(s) for ${current.date}, earliest first.`);
  for (const b of rows) out.appendChild(card(b, respond));
}

async function respond(b, action) {
  try {
    const result = await rpc("respond_booking", { p_csr: current.csr, p_pin: current.pin, p_id: b.id, p_action: action });
    if (result === "Reassigned") pageMsg(`Booking for ${b.guest_group} passed to another CSR.`);
    else if (result === "Unassigned") pageMsg(`Booking for ${b.guest_group} has no CSR free now. The operator needs to assign it.`, true);
    else pageMsg(`Booking for ${b.guest_group} accepted.`);
    await loadBookings();
  } catch (e) {
    pageMsg(e.message, true);
  }
}

// Availability for today and the next 2 days (India time). Locked dates cannot be changed.
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function availMsg(text, isError = false) {
  const m = $("#availMessage");
  m.textContent = text;
  m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
  if (text) toast(text, isError);
}

function availRow(d) {
  const iso = String(d.day_date).slice(0, 10);
  const row = document.createElement("div");
  row.className = "avail-row";

  const label = document.createElement("div");
  label.className = "avail-date";
  label.textContent = DAY_FORMAT.format(new Date(iso + "T00:00:00Z"));

  const sel = document.createElement("select");
  sel.setAttribute("aria-label", `Status for ${iso}`);
  for (const s of ["Available", "On leave"]) sel.appendChild(new Option(s, s, false, s === d.day_status));
  sel.disabled = d.is_locked === true;
  sel.onchange = () => setAvailability(iso, sel.value);

  const note = document.createElement("span");
  note.className = "avail-note";
  note.textContent = d.is_locked ? "Locked: you have accepted a booking on this date" : "";

  row.append(label, sel, note);
  return row;
}

async function loadAvailability() {
  const rows = await rpc("my_availability", { p_csr: current.csr, p_pin: current.pin });
  const box = $("#availRows");
  box.innerHTML = "";
  for (const d of rows) box.appendChild(availRow(d));
  $("#availSection").classList.remove("hidden");
}

async function setAvailability(date, status) {
  if (status === "On leave" && !confirm(`Mark yourself On leave on ${date}? Your bookings that day will be passed to other CSRs.`)) {
    await loadAvailability();
    return;
  }
  try {
    const moved = await rpc("set_my_availability", { p_csr: current.csr, p_pin: current.pin, p_date: date, p_status: status });
    let text = `${date} set to ${status}.`;
    if (status === "On leave" && moved) text += ` ${moved} booking(s) passed on or marked Unassigned.`;
    availMsg(text);
    await loadAvailability();
    if (current.date === date) await loadBookings();
  } catch (e) {
    availMsg(e.message, true);
    await loadAvailability().catch(() => {});
  }
}

async function init() {
  const sel = $("#pickName");
  try {
    const names = await rpc("list_csrs", {});
    sel.innerHTML = "";
    for (const n of names) sel.appendChild(new Option(n.name, n.csr_code));
    if (!names.length) pageMsg("No CSRs have been published yet.", true);
  } catch (e) {
    pageMsg(`Could not load names: ${e.message}`, true);
  }
  $("#pickDate").value = istDate();
}

// Today's date in India, whatever the device's time zone.
function istDate() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

$("#showBtn").addEventListener("click", async () => {
  const csr = $("#pickName").value;
  const pin = $("#pickPin").value.trim();
  const date = $("#pickDate").value;
  if (!csr || !pin || !date) {
    pageMsg("Choose your name, enter your PIN and the date.", true);
    return;
  }
  current = { csr, pin, date };
  try {
    await loadBookings();
    await loadAvailability();
  } catch (e) {
    $("#bookings").innerHTML = "";
    $("#availSection").classList.add("hidden");
    pageMsg(e.message, true);
  }
});

init();

