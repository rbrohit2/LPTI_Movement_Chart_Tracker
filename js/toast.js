// Pop-up notifications in the bottom-right corner. Each closes on its own, or with its × button.
// Errors stay a little longer. Pass a document when running outside a browser (for tests).
export function toast(text, isError = false, doc = globalThis.document) {
  if (!doc || !text) return;
  let stack = doc.getElementById("toastStack");
  if (!stack) {
    stack = doc.createElement("div");
    stack.id = "toastStack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    doc.body.appendChild(stack);
  }
  const el = doc.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  const msg = doc.createElement("span");
  msg.textContent = text;
  const close = doc.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close notification");
  close.textContent = "×";
  close.onclick = () => el.remove();
  el.append(msg, close);
  stack.appendChild(el);
  setTimeout(() => el.remove(), isError ? 9000 : 4500);
}
