// Pure movement-chart parser (no DOM, no pdf.js import) so the same code runs
// in the browser and in the Node test harness.
//
// Input: pages = array of pages; each page = array of text items
//   { s: string, x: number, y: number }
// where x/y are already transformed with page.getViewport({scale:1}) (y grows downward).
//
// Template geometry was measured from the LPTI "Daily Tourist Arrival / Departure"
// chart at 970pt page width. Positions scale with the actual page width.

const TEMPLATE_WIDTH = 970;

// Printed column boundaries, in template points (x start, inclusive).
const COLUMNS = [
  ["sno", 0],
  ["name", 52],
  ["arrival", 180], // some arrival train numbers start at x≈184, so this boundary sits left of the header label

  ["departure", 262],
  ["pickup", 330],
  ["dropoff", 405],
  ["assist", 478],
  ["vehicle", 505],
  ["transporter", 598],
  ["pickupTime", 735],
  ["remarks", 778],
];

// Every S.No. label sits about 3pt above the first text line of its row block.
// Bands start 8pt above each S.No. label, which sits between the previous block's
// last line and the next block's first line.
const BAND_OFFSET = 8;

const AIRPORT_STOPWORDS =new Set(["PAX", "AND", "THE", "FOR", "MODE", "TIME", "FROM", "AC", "SL", "FIT", "GRP", "NOT"]);

function columnRanges(width) {
  const k = width / TEMPLATE_WIDTH;
  return COLUMNS.map(([name, start], i) => ({
    name,
    start: start * k,
    end: i + 1 < COLUMNS.length ? COLUMNS[i + 1][1] * k : Infinity,
  }));
}

function joinItems(items) {
  return items
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.s)
    .filter((s) => s && !/^X$/.test(s)) // lone "X" is a printed separator, not data
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTime(t) {
  const m = t.match(/^(\d{1,2})[:.](\d{2})$/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

// Returns { fileCode, pax, guest } from the Name cell text.
function parseNameCell(raw) {
  const fc = raw.match(/\(\s*FC:\s*([A-Z]{2,6}\d{6,}(?:-\d+)?)\s*\)/i);
  if (!fc) return { fileCode: "", pax: "", operator: "", guest: raw.replace(/\bPAX\b/gi, "").trim() };
  const before = raw.slice(0, fc.index);
  const after = raw.slice(fc.index + fc[0].length);
  const paxMatch = after.match(/^\s*X\s*(\d{1,3})\b/i) || after.match(/^\s*(\d{1,3})\s*PAX\b/i);
  const cleaned = before
    .replace(/\bx\s*\d{1,3}\s*pax\b/gi, "") // "Classical India x 05 Pax" -> "Classical India"
    .replace(/\bPAX\b/gi, "");
  // The 2-4 letter operator code printed just before "(FC:" (e.g. "SL", "VNM") is its own field.
  const op = cleaned.match(/\s([A-Z]{2,4})\s*$/);
  const guest = cleaned.replace(/\s+[A-Z]{2,4}\s*$/, "").replace(/\s+/g, " ").trim();
  return { fileCode: fc[1].toUpperCase(), pax: paxMatch ? paxMatch[1] : "", operator: op ? op[1] : "", guest };
}

function findFlight(text) {
  // Printed flight with a time or a "TRAIN #" label is kept exactly as printed,
  // e.g. "Lh 763 @ 0155", "AF215 @ 05:10", "TRAIN # 20175".
  const printed = text.match(/TRAIN\s*#\s*\d{3,5}|[A-Za-z0-9]{2}\s?-?\d{2,4}\s*@\s*\d{2}[:.]?\d{2}/i);
  if (printed) return printed[0].replace(/\s+/g, " ").trim();
  // Airline / rail-style alphanumeric numbers such as LH762, LH-760, 6E 1253, TG 331, VS-303.
  // Separators are dropped and case is normalised so the same flight always reads the same way.
  const alpha = text.match(/\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2}[- ]?\d{2,4}\b/i);
  if (alpha) return alpha[0].replace(/[\s-]/g, "").toUpperCase();
  // Pure numeric train numbers, e.g. 22458 / 22469.
  const num = text.match(/\b\d{4,5}\b/);
  return num ? num[0] : "";
}

function findPlace(text) {
  const codes = text.match(/\b[A-Z]{3}\b/g) || [];
  return codes.find((c) => !AIRPORT_STOPWORDS.has(c) && !/^\d/.test(c)) || "";
}

// One Arrival or Departure cell -> interpreted leg.
function parseLeg(items) {
  const text = joinItems(items);
  if (!text) return null;
  const time = normalizeTime((text.match(/\b\d{1,2}[:.]\d{2}\b/g) || []).at(-1) || "");
  const flight = findFlight(text);
  const place = findPlace(text);
  const isRail = /RAIL|TRAIN|VANDE/i.test(text) || /^\d{4,5}$/.test(flight);
  const isRoad = /SURF|ROAD/i.test(text);
  const mode = isRail ? "TRAIN" : isRoad ? "ROAD" : flight ? "FLIGHT" : "";
  return { text, time, flight, place, mode };
}

// The Transport / Report At cell holds the transporter name on its first line and,
// when a report location is printed, that location on a lower line (about 35pt down).
// Single-line cells are transporter only.
function splitTransporterCell(items) {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(it.y - last.y) <= 3) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  if (lines.length < 2) return { transporter: joinItems(items), reportAt: "" };
  const reportLine = lines.at(-1);
  const transporterItems = lines.slice(0, -1).flatMap((l) => l.items);
  return { transporter: joinItems(transporterItems), reportAt: joinItems(reportLine.items) };
}

function assistance(remarks, assistCell) {
  const t = `${assistCell} ${remarks}`;
  if (/NO\s+(ESCORT|ASSIST)/i.test(t)) return "NO";
  if (/ASSIST|ESCORT|CSR|REP\b/i.test(t)) return "YES";
  return "REVIEW";
}

function interpretBlock(serial, items, cols, serviceDate) {
  const cell = {};
  for (const c of cols) {
    cell[c.name] = items.filter((i) => i.x >= c.start && i.x < c.end);
  }
  const name = parseNameCell(joinItems(cell.name));
  const arr = parseLeg(cell.arrival);
  const dep = parseLeg(cell.departure);

  let movementType = "";
  if (arr && dep) movementType = "TRANSFER";
  else if (arr) movementType = "ARRIVAL";
  else if (dep) movementType = "DEPARTURE";

  // The leg that defines the movement supplies the service number and time.
  const leg = movementType === "DEPARTURE" ? dep : arr || dep;
  const serviceNumber = leg?.flight || "";
  const scheduledTime = leg?.time || "";
  const place = movementType === "DEPARTURE" ? leg?.place || "" : arr?.place || dep?.place || "";
  const mode = leg?.mode || "";

  const { transporter, reportAt } = splitTransporterCell(cell.transporter);
  const remarks = joinItems(cell.remarks);

  const assistanceRequired = assistance(remarks, joinItems(cell.assist));
  const validationErrors = [];
  if (!name.fileCode) validationErrors.push("FILE_CODE");
  if (!movementType) validationErrors.push("MOVEMENT_TYPE");
  if (!scheduledTime) validationErrors.push("SCHEDULED_TIME");

  return {
    movementNo: serial,
    serviceDate,
    guestGroupName: name.guest,
    fh: name.operator,
    fileCode: name.fileCode,
    pax: name.pax,
    movementType,
    mode,
    serviceNumber,
    scheduledTime,
    pickup: joinItems(cell.pickup),
    dropoff: joinItems(cell.dropoff),
    reportingTime: normalizeTime(joinItems(cell.pickupTime)),
    vehicle: joinItems(cell.vehicle),
    transporter,
    reportAt,
    assistanceRequired,
    remarks,
    place,
    rawData: Object.fromEntries(Object.entries(cell).map(([k, v]) => [k, joinItems(v)])),
    needsReview: validationErrors.length > 0 || assistanceRequired === "REVIEW",
    userEdited: false,
    validationErrors,
  };
}

// Page header (Night Duty line) and footer (Page x of y) positions.
function pageBounds(items) {
  const duty = items.filter((i) => /Night Duty:/i.test(i.s)).map((i) => i.y);
  const footer = items.filter((i) => /Page\s*\d+\s*of\s*\d+/i.test(i.s)).map((i) => i.y);
  const bodyTop = duty.length ? Math.max(...duty) + 8 : null;
  const footerTop = footer.length ? Math.min(...footer) - 8 : null;
  return { bodyTop, footerTop };
}

export function parseMovementPages(pages, serviceDate = "", opts = {}) {
  const rows = [];
  const diagnostics = [];
  for (const [pageIndex, items] of pages.entries()) {
    if (!items.length) continue;
    const width = opts.pageWidth || Math.max(...items.map((i) => i.x)) + 1;
    const cols = columnRanges(width);
    const { bodyTop, footerTop } = pageBounds(items);
    const top = bodyTop ?? 0;
    const bottom = footerTop ?? Infinity;
    const sNoX = cols[0].end;

    const serials = items
      .filter((i) => /^\d{1,2}$/.test(i.s) && i.x < sNoX && i.y > top && i.y < bottom)
      .sort((a, b) => a.y - b.y);

    if (!serials.length) diagnostics.push({ page: pageIndex + 1, issue: "NO_SERIAL_NUMBERS" });

    for (let n = 0; n < serials.length; n++) {
      const cur = serials[n];
      const next = serials[n + 1];
      const start = Math.max(cur.y - BAND_OFFSET, top);
      const end = next ? next.y - BAND_OFFSET : bottom;
      const band = items.filter((i) => i.y >= start && i.y < end && i.x >= sNoX);
      rows.push(interpretBlock(+cur.s, band, cols, serviceDate));
    }
  }
  return { rows, diagnostics };
}
