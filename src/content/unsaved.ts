// Typing on this page that hasn't been sent or saved (a half-written comment, a form, a draft Navi wrote),
// so Navi can ask before closing the tab: Chrome's own "leave site?" prompt doesn't run when an extension
// closes a tab. Search boxes don't count.

const typedIn = new Set<Element>();

const TEXT_INPUT = /^(?:text|email|url|tel|number)$/;

function isTypingField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT.test(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

function isSearchField(el: Element): boolean {
  if (el.closest("[role=search], form[action*=search]")) return true;
  const role = el.getAttribute("role") ?? "";
  const names = [el.getAttribute("name"), el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder")].join(" ");
  return /searchbox|combobox/.test(role) || /\bsearch\b|\bquery\b|^q\b/i.test(names);
}

document.addEventListener(
  "input",
  (e) => {
    const el = e.composedPath()[0];
    if (el instanceof Element && isTypingField(el) && !isSearchField(el)) typedIn.add(el);
  },
  true,
);
// Sent: whatever was typed in the form is no longer at risk.
document.addEventListener(
  "submit",
  (e) => {
    for (const el of typedIn) if (e.target instanceof Element && e.target.contains(el)) typedIn.delete(el);
  },
  true,
);

/** Whether closing this page would lose something typed into it. */
export function hasUnsavedTyping(): boolean {
  for (const el of typedIn) {
    if (!el.isConnected) {
      typedIn.delete(el);
      continue;
    }
    const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "");
    if (text.trim()) return true;
  }
  return false;
}
