"use strict";

const siteMenus = document.querySelectorAll(".site-menu");

for (const menu of siteMenus) {
  const periodLink = document.createElement("a");
  periodLink.href = "/compare-periods";
  periodLink.textContent = "Compare periods";
  if (window.location.pathname === "/compare-periods") periodLink.setAttribute("aria-current", "page");
  menu.querySelector(".menu-panel").append(periodLink);
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
