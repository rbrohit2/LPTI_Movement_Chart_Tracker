// Operator view of bookings nobody has taken. Lists them for the published date and lets the operator give each to a CSR.
import { rpc } from "./supabase.js";
import { toast } from "./toast.js";

export function initUnassigned(doc, getDate) {
  const $ = (s) => doc.querySelector(s);
  let passcode = null; // kept in memory for this page only, never stored

  const show = (text, isError = false) => {
    const m = $("#unassignedMessage");
    m.textContent = text;
    m.className = text ? "message" + (isError ? " error" : "") : "message hidden";
    toast(text, isError, doc);
  };

  const cell = (tr, text) => {
    const td = doc.createElement("td");
    td.textContent = text == null || text === "" ? "—" : String(text);
    tr.appendChild(td);
    return td;
  };

  async function assign(row, csr) {
    if (!csr) { show("Choose a CSR first.", true); return; }
    try {
      await rpc("assign_booking", { p_pass: passcode, p_id: row.id, p_csr: csr });
      show(`S.No. ${row.movement_no} assigned.`);
      await load();
    } catch (e) {
      show(e.message, true);
    }
  }

  async function load() {
    const date = getDate();
    if (!passcode) {
      passcode = prompt("Operator passcode:");
      if (!passcode) return;
    }
    let rows, csrs;
    try {
      [rows, csrs] = await Promise.all([
        rpc("list_unassigned", { p_pass: passcode, p_date: date }),
        rpc("list_csrs", {}),
      ]);
    } catch (e) {
      passcode = null;
      $("#unassignedTable tbody").innerHTML = "";
      $("#unassignedCount").textContent = "0";
      show(e.message, true);
      return;
    }

    $("#unassignedCount").textContent = String(rows.length);
    const tbody = $("#unassignedTable tbody");
    tbody.innerHTML = "";
    if (!rows.length) {
      show(`No unassigned bookings for ${date}.`);
      return;
    }
    show(`${rows.length} unassigned booking(s) for ${date}.`);

    for (const r of rows) {
      const tr = doc.createElement("tr");
      cell(tr, r.scheduled_time);
      cell(tr, r.movement_no);
      cell(tr, r.guest_group);
      cell(tr, r.file_code);
      cell(tr, r.pickup);
      cell(tr, r.dropoff);
      cell(tr, (r.rejected_by || []).join(", "));

      const pickTd = doc.createElement("td");
      const sel = doc.createElement("select");
      sel.appendChild(new Option("Choose CSR", ""));
      for (const c of csrs) sel.appendChild(new Option(`${c.name} (${c.csr_code})`, c.csr_code));
      pickTd.appendChild(sel);
      tr.appendChild(pickTd);

      const actTd = doc.createElement("td");
      const btn = doc.createElement("button");
      btn.className = "btn primary";
      btn.textContent = "Assign";
      btn.onclick = () => assign(r, sel.value);
      actTd.appendChild(btn);
      tr.appendChild(actTd);

      tbody.appendChild(tr);
    }
  }

  $("#loadUnassignedBtn").addEventListener("click", () => {
    passcode = null; // ask again each time the list is loaded
    load();
  });
}
