// CSR bookings page. Loads one CSR's bookings for a date and lets them accept or reject.
import { rpc } from "./supabase.js";

const $ = (s) => document.querySelector(s);
const pageMsg = (text, isError = false) => {
  const m = $("#pageMessage");
  m.textContent = text;
  m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
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
  if (b.status === "Allocated") {
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
  $("#pickDate").value = new Date().toISOString().slice(0, 10);
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
  } catch (e) {
    $("#bookings").innerHTML = "";
    pageMsg(e.message, true);
  }
});

init();
