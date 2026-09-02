"use strict";

const APP_SOURCE = "ledger-web-app";
const EXTENSION_SOURCE = "ledger-amazon-extension";

function sendToPage(action, payload = {}) {
  window.postMessage({ source: EXTENSION_SOURCE, action, payload }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== APP_SOURCE
  ) {
    return;
  }

  if (event.data.action === "extensionPing") {
    sendToPage("ready", { version: chrome.runtime.getManifest().version });
    return;
  }

  let message;
  if (event.data.action === "startAmazonImport") {
    message = { action: "ledgerStartImport", data: event.data.payload };
  } else if (event.data.action === "cancelAmazonImport") {
    message = { action: "ledgerCancelImport", data: event.data.payload };
  } else {
    return;
  }

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      sendToPage("error", { message: chrome.runtime.lastError.message });
    } else if (!response?.success) {
      sendToPage("error", { message: response?.error || "The extension could not start the import." });
    } else {
      sendToPage("started");
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === "ledgerImportProgress") {
    sendToPage("progress", {
      progress: message.data?.percent,
      message: message.data?.message,
      status: "scraping",
    });
  } else if (message?.action === "ledgerImportError") {
    sendToPage("error", message.data);
  }
});

sendToPage("ready", { version: chrome.runtime.getManifest().version });
