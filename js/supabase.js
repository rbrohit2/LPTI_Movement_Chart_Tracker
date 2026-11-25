// Minimal Supabase RPC client (no SDK, no CDN dependency).
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export async function rpc(name, body = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === "object" ? data.message || data.hint || JSON.stringify(data) : String(data);
    throw new Error(msg);
  }
  return data;
}
