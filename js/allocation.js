// CSR allocation. Pure functions so they can be tested in Node.
//
// Rules, in priority order for each movement that needs assistance (Assist is not NO):
//   1. Only CSRs with Availability "Available" are eligible.
//   2. A CSR must not already have a movement within CONFLICT_WINDOW_MIN minutes.
//   3. Prefer a CSR whose language matches the market language (file-code prefix -> Market table).
//   4. If no language match exists, take the next best available CSR and say so.
//   5. Among equals, prefer airport pass YES for airport movements, then the lightest workload.

import { LANGUAGES } from "./csr.js";

export const CONFLICT_WINDOW_MIN = 90;

export function marketOf(fileCode) {
  const m = String(fileCode || "").match(/^[A-Z]+/);
  return m ? m[0] : "";
}

export function languageFor(fileCode, markets) {
  const mk = marketOf(fileCode);
  return markets.find((m) => m.market === mk)?.languageCode || "";
}

export function minutesOf(row) {
  const t = row.scheduledTime || row.reportingTime;
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function isAirport(row) {
  return (row.movementType === "ARRIVAL" || row.movementType === "DEPARTURE") && (row.mode === "FLIGHT" || row.mode === "TRAIN");
}

// Workload and booked times per CSR, built from the current assignments.
export function loadFrom(assignments, rows) {
  const byNo = new Map(rows.map((r) => [r.movementNo, r]));
  const load = new Map();
  for (const a of assignments) {
    if (!a.csrId) continue;
    const entry = load.get(a.csrId) || { count: 0, times: [] };
    entry.count += 1;
    const mins = minutesOf(byNo.get(a.movementNo) || {});
    if (mins !== null) entry.times.push(mins);
    load.set(a.csrId, entry);
  }
  return load;
}

function clashes(entry, mins) {
  if (mins === null || !entry) return false;
  return entry.times.some((t) => Math.abs(t - mins) < CONFLICT_WINDOW_MIN);
}

// Choose a CSR for one movement. Returns { csrId, status, reason }.
export function pickCsr(row, csrs, markets, load, exclude = new Set()) {
  const need = languageFor(row.fileCode, markets);
  const mins = minutesOf(row);
  const airport = isAirport(row);
  const eligible = csrs.filter(
    (c) => c.availability === "Available" && !exclude.has(c.id) && !clashes(load.get(c.id), mins)
  );
  if (!eligible.length) {
    return { csrId: "", status: "Unassigned", reason: "No available CSR without a clash at this time" };
  }
  const rank = (c) => {
    const e = load.get(c.id) || { count: 0 };
    const langMiss = need && c.languageCode !== need ? 1 : 0;
    const passMiss = airport && c.airportPass !== "YES" ? 1 : 0;
    return [langMiss, passMiss, e.count];
  };
  eligible.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.name.localeCompare(b.name);
  });
  const best = eligible[0];
  if (!need) return { csrId: best.id, status: "Allocated", reason: "No market language set" };
  if (best.languageCode === need) {
    return { csrId: best.id, status: "Allocated", reason: `Speaks ${LANGUAGES[need]}` };
  }
  return {
    csrId: best.id,
    status: "Next best",
    reason: `No available ${LANGUAGES[need]} speaker; ${LANGUAGES[best.languageCode] || best.languageCode} speaker assigned`,
  };
}

// Allocate every movement that needs assistance. Earlier times are placed first.
export function allocateAll(rows, csrs, markets) {
  const ordered = rows.slice().sort((a, b) => (minutesOf(a) ?? 9999) - (minutesOf(b) ?? 9999) || a.movementNo - b.movementNo);
  const assignments = [];
  const load = new Map();
  for (const row of ordered) {
    // Every movement gets a CSR, including those marked escort NO, so the CSR can still accept it.
    const pick = pickCsr(row, csrs, markets, load);
    assignments.push({ movementNo: row.movementNo, ...pick });
    if (pick.csrId) {
      const e = load.get(pick.csrId) || { count: 0, times: [] };
      e.count += 1;
      const mins = minutesOf(row);
      if (mins !== null) e.times.push(mins);
      load.set(pick.csrId, e);
    }
  }
  return assignments.sort((a, b) => a.movementNo - b.movementNo);
}

// A CSR rejected a movement: re-allocate it to the next best CSR, excluding everyone who rejected it.
export function reassign(assignments, rows, csrs, markets, movementNo, rejectedIds = []) {
  const row = rows.find((r) => r.movementNo === movementNo);
  if (!row) return assignments;
  const others = assignments.filter((a) => a.movementNo !== movementNo);
  const load = loadFrom(others, rows);
  const pick = pickCsr(row, csrs, markets, load, new Set(rejectedIds));
  return assignments.map((a) => (a.movementNo === movementNo ? { movementNo, ...pick, rejectedBy: rejectedIds } : a));
}
