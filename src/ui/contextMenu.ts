import { escapeHtml } from "./format.ts";

/**
 * A small right-click menu, opened at a point on the screen.
 *
 * Closes on a choice, on Escape, on a press anywhere outside it, and when the window loses
 * focus — the four ways people put a menu away without thinking about it.
 */

export interface MenuItem {
  label: string;
  onPick: () => void;
}

let closeOpen: (() => void) | null = null;

/** Open a menu at `clientX, clientY`, closing any menu already open. Returns its closer. */
export function showContextMenu(
  clientX: number,
  clientY: number,
  title: string,
  items: readonly MenuItem[],
): () => void {
  closeOpen?.();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML =
    `<div class="context-menu-title">${escapeHtml(title)}</div>` +
    items
      .map(
        (item, i) =>
          `<button type="button" role="menuitem" data-i="${i}">${escapeHtml(item.label)}</button>`,
      )
      .join("");

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    if (closeOpen === close) closeOpen = null;
  };
  const onOutside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };

  menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.addEventListener("click", () => {
      close();
      items[Number(button.dataset.i)]!.onPick();
    });
  });
  // Swallowed so a right-click on the menu itself does not open the browser's.
  menu.addEventListener("contextmenu", (e) => e.preventDefault());

  document.body.appendChild(menu);
  // Kept on screen: a menu opened near the right or bottom edge flips back over the pointer.
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - width - 4);
  const top = clientY + height > window.innerHeight - 4 ? clientY - height : clientY;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  menu.querySelector<HTMLButtonElement>("button")?.focus();

  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  closeOpen = close;
  return close;
}
