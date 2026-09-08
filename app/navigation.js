"use strict";

const siteMenus = document.querySelectorAll(".site-menu");

for (const menu of siteMenus) {
  const panel = menu.querySelector(".menu-panel");
  if (panel && !panel.querySelector('a[href="/merchants"]')) {
    const link = document.createElement("a");
    link.href = "/merchants"; link.textContent = "Merchant insights";
    if (window.location.pathname === "/merchants") link.setAttribute("aria-current", "page");
    panel.append(link);
  }
}

for (const menu of siteMenus) {
  const button = menu.querySelector(".menu-button");

  menu.addEventListener("toggle", () => {
    button.setAttribute("aria-expanded", String(menu.open));
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menu.open = false;
    });
  });
}

document.addEventListener("click", (event) => {
  for (const menu of siteMenus) {
    if (menu.open && !menu.contains(event.target)) {
      menu.open = false;
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const menu of siteMenus) {
    if (menu.open) {
      menu.open = false;
      menu.querySelector(".menu-button").focus();
    }
  }
});
