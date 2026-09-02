"use strict";

const APP_SOURCE = "ledger-web-app";
const EXTENSION_SOURCE = "ledger-data-importer";

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
  } else if (event.data.action === "startCreditKarmaImport") {
    message = { action: "ledgerStartCreditKarmaImport", data: event.data.payload };
  } else if (event.data.action === "cancelCreditKarmaImport") {
    message = { action: "ledgerCancelCreditKarmaImport", data: event.data.payload };
  } else if (event.data.action === "startAliExpressImport") {
    message = { action: "ledgerStartAliExpressImport", data: event.data.payload };
  } else if (event.data.action === "cancelAliExpressImport") {
    message = { action: "ledgerCancelAliExpressImport", data: event.data.payload };
  } else if (event.data.action === "startVenmoImport") {
    message = { action: "ledgerStartVenmoImport", data: event.data.payload };
  } else if (event.data.action === "cancelVenmoImport") {
    message = { action: "ledgerCancelVenmoImport", data: event.data.payload };
  } else if (event.data.action === "startEbayImport") {
    message = { action: "ledgerStartEbayImport", data: event.data.payload };
  } else if (event.data.action === "cancelEbayImport") {
    message = { action: "ledgerCancelEbayImport", data: event.data.payload };
  } else if (event.data.action === "startAppleCardImport") {
    message = { action: "ledgerStartAppleCardImport", data: event.data.payload };
  } else if (event.data.action === "cancelAppleCardImport") {
    message = { action: "ledgerCancelAppleCardImport", data: event.data.payload };
  } else {
    return;
  }

  chrome.runtime.sendMessage(message, (response) => {
    const isCreditKarma = event.data.action.includes("CreditKarma");
    const isAliExpress = event.data.action.includes("AliExpress");
    const isVenmo = event.data.action.includes("Venmo");
    const isEbay = event.data.action.includes("Ebay");
    const isAppleCard = event.data.action.includes("AppleCard");
    const errorAction = isCreditKarma ? "creditKarmaError" : isAliExpress ? "aliExpressError" : isVenmo ? "venmoError" : isEbay ? "ebayError" : isAppleCard ? "appleCardError" : "error";
    if (chrome.runtime.lastError) {
      sendToPage(errorAction, { message: chrome.runtime.lastError.message });
    } else if (!response?.success) {
      sendToPage(errorAction, {
        message: response?.error || "The extension could not start the import.",
      });
    } else {
      sendToPage(isCreditKarma ? "creditKarmaStarted" : isAliExpress ? "aliExpressStarted" : isVenmo ? "venmoStarted" : isEbay ? "ebayStarted" : isAppleCard ? "appleCardStarted" : "started");
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
  } else if (message?.action === "ledgerCreditKarmaImportProgress") {
    sendToPage("creditKarmaProgress", {
      progress: message.data?.progress,
      message: message.data?.message,
      status: "scraping",
    });
  } else if (message?.action === "ledgerCreditKarmaImportError") {
    sendToPage("creditKarmaError", message.data);
  } else if (message?.action === "ledgerAliExpressImportProgress") {
    sendToPage("aliExpressProgress", { ...message.data, status: "scraping" });
  } else if (message?.action === "ledgerAliExpressImportError") {
    sendToPage("aliExpressError", message.data);
  } else if (message?.action === "ledgerVenmoImportProgress") {
    sendToPage("venmoProgress", { ...message.data, status: "scraping" });
  } else if (message?.action === "ledgerVenmoImportError") {
    sendToPage("venmoError", message.data);
  } else if (message?.action === "ledgerEbayImportProgress") {
    sendToPage("ebayProgress", { ...message.data, status: "scraping" });
  } else if (message?.action === "ledgerEbayImportError") {
    sendToPage("ebayError", message.data);
  } else if (message?.action === "ledgerAppleCardImportProgress") {
    sendToPage("appleCardProgress", { ...message.data, status: "scraping" });
  } else if (message?.action === "ledgerAppleCardImportError") {
    sendToPage("appleCardError", message.data);
  }
});

sendToPage("ready", { version: chrome.runtime.getManifest().version });
