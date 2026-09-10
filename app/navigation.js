"use strict";

const siteMenus = document.querySelectorAll(".site-menu");

function syncMenuState(menu) {
  const button = menu.querySelector(".menu-button");
  button.setAttribute("aria-expanded", String(menu.open));
  button.setAttribute("aria-label", menu.open ? "Close navigation menu" : "Open navigation menu");
}
function closeMenu(menu, returnFocus = false) {
  menu.open = false;
  // Native toggle events are asynchronous; update the label before focus returns.
  syncMenuState(menu);
  if (returnFocus) menu.querySelector(".menu-button").focus();
}
for (const menu of siteMenus) {
  syncMenuState(menu);
  menu.addEventListener("toggle", () => syncMenuState(menu));
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeMenu(menu));
  });
}

document.addEventListener("click", (event) => {
  for (const menu of siteMenus) {
    if (menu.open && !menu.contains(event.target)) {
      closeMenu(menu);
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const menu of siteMenus) {
    if (menu.open) {
      closeMenu(menu, true);
    }
  }
});
