// Builds the roster payload published to Supabase. Pure, so it can be tested in Node.
import { languageFor } from "./allocation.js";

const PIN_STORAGE_KEY = "lptiCsrPins";

// One four-digit PIN per CSR, created on first publish and kept so the operator can share it.
export function ensurePins(storage, csrs, randomDigits = () => String(Math.floor(1000 + Math.random() * 9000))) {
  let pins = {};
  try { pins = JSON.parse(storage.getItem(PIN_STORAGE_KEY) || "{}") || {}; } catch { pins = {}; }
  let changed = false;
  for (const c of csrs) {
    if (!pins[c.csrCode]) { pins[c.csrCode] = randomDigits(); changed = true; }
  }
  if (changed) storage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
  return pins;
}

export function buildRoster(rows, assignments, csrs, markets, pins, serviceDate) {
  const byNo = new Map(assignments.map((a) => [a.movementNo, a]));
  const csrById = new Map(csrs.map((c) => [c.id, c]));

  const csrPayload = csrs.map((c) => ({
    csr_code: c.csrCode,
    name: c.name,
    language_code: c.languageCode,
    airport_pass: c.airportPass,
    availability: c.availability,
    pin: pins[c.csrCode],
  }));

  const rowPayload = [];
  for (const r of rows) {
    const a = byNo.get(r.movementNo);
    if (!a) continue;
    const holder = a.csrId ? csrById.get(a.csrId) : null;
    const airport = (r.movementType === "ARRIVAL" || r.movementType === "DEPARTURE") && (r.mode === "FLIGHT" || r.mode === "TRAIN");
    rowPayload.push({
      movement_no: r.movementNo,
      service_date: serviceDate,
      guest_group: r.guestGroupName || "",
      file_code: r.fileCode || "",
      pax: r.pax || "",
      movement_type: r.movementType || "",
      mode: r.mode || "",
      flight: r.serviceNumber || "",
      scheduled_time: r.scheduledTime || "",
      pickup: r.pickup || "",
      dropoff: r.dropoff || "",
      reporting_time: r.reportingTime || "",
      vehicle: r.vehicle || "",
      report_at: r.reportAt || "",
      language_code: languageFor(r.fileCode, markets),
      airport,
      csr_code: holder ? holder.csrCode : null,
      status: holder ? "Allocated" : "Unassigned",
    });
  }
  return { csrs: csrPayload, rows: rowPayload };
}
