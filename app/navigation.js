"use strict";

const siteMenus = document.querySelectorAll(".site-menu");

for (const menu of siteMenus) {
  const coverageLink = document.createElement("a");
  coverageLink.href = "/coverage";
  coverageLink.textContent = "Data coverage";
  if (window.location.pathname === "/coverage") coverageLink.setAttribute("aria-current", "page");
  menu.querySelector(".menu-panel").append(coverageLink);
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
