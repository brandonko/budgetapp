"use strict";

// Dynamic host permissions cover every port. Verify the exact saved origin
// with the service worker before announcing readiness or forwarding messages.
(() => {
if (globalThis.ledgerBridgeInstalled) {
  globalThis.ledgerBridgeAnnounce?.();
  return;
}
globalThis.ledgerBridgeInstalled = true;
async function trusted() {
  try { return await chrome.runtime.sendMessage({ action: "ledgerCheckOrigin" }) === true; }
  catch { return false; }
}

const APP_SOURCE = "ledger-web-app";
const EXTENSION_SOURCE = "ledger-data-importer";

function sendToPage(action, payload = {}) {
  window.postMessage({ source: EXTENSION_SOURCE, action, payload }, window.location.origin);
}

window.addEventListener("message", async (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== APP_SOURCE
  ) {
    return;
  }
  if (!await trusted()) return;

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
  } else if (event.data.action === "startWalmartImport") {
    message = { action: "ledgerStartWalmartImport", data: event.data.payload };
  } else if (event.data.action === "cancelWalmartImport") {
    message = { action: "ledgerCancelWalmartImport", data: event.data.payload };
  } else if (event.data.action === "startCapitalOneImport") {
    message = { action: "ledgerStartCapitalOneImport", data: event.data.payload };
  } else if (event.data.action === "cancelCapitalOneImport") {
    message = { action: "ledgerCancelCapitalOneImport", data: event.data.payload };
  } else if (event.data.action === "startAmexImport") {
    message = { action: "ledgerStartAmexImport", data: event.data.payload };
  } else if (event.data.action === "cancelAmexImport") {
    message = { action: "ledgerCancelAmexImport", data: event.data.payload };
  } else if (event.data.action === "startSchwabImport") {
    message = { action: "ledgerStartSchwabImport", data: event.data.payload };
  } else if (event.data.action === "cancelSchwabImport") {
    message = { action: "ledgerCancelSchwabImport", data: event.data.payload };
  } else if (event.data.action === "startAppleCardImport") {
    message = { action: "ledgerStartAppleCardImport", data: event.data.payload };
  } else if (event.data.action === "cancelAppleCardImport") {
    message = { action: "ledgerCancelAppleCardImport", data: event.data.payload };
  } else {
    return;
  }

  chrome.runtime.sendMessage(message, (response) => {
    if (event.data.action.includes("Amex")) {
      if (chrome.runtime.lastError || !response?.success) {
        sendToPage("amexError", { token: event.data.payload?.token,
          message: chrome.runtime.lastError?.message || response?.error || "The extension could not start American Express import." });
      } else sendToPage("amexStarted", { token: event.data.payload?.token });
      return;
    }
    const isCreditKarma = event.data.action.includes("CreditKarma");
    const isAliExpress = event.data.action.includes("AliExpress");
    const isVenmo = event.data.action.includes("Venmo");
    const isEbay = event.data.action.includes("Ebay");
    const isAppleCard = event.data.action.includes("AppleCard");
    const isWalmart = event.data.action.includes("Walmart");
    const isSchwab = event.data.action.includes("Schwab");
    const isCapitalOne = event.data.action.includes("CapitalOne");
    const errorAction = isSchwab ? "schwabError" : isCapitalOne ? "capitalOneError" : isWalmart ? "walmartError" : isCreditKarma ? "creditKarmaError" : isAliExpress ? "aliExpressError" : isVenmo ? "venmoError" : isEbay ? "ebayError" : isAppleCard ? "appleCardError" : "error";
    if (chrome.runtime.lastError) {
      sendToPage(errorAction, { message: chrome.runtime.lastError.message });
    } else if (!response?.success) {
      sendToPage(errorAction, {
        message: response?.error || "The extension could not start the import.",
      });
    } else {
      sendToPage(isSchwab ? "schwabStarted" : isCapitalOne ? "capitalOneStarted" : isWalmart ? "walmartStarted" : isCreditKarma ? "creditKarmaStarted" : isAliExpress ? "aliExpressStarted" : isVenmo ? "venmoStarted" : isEbay ? "ebayStarted" : isAppleCard ? "appleCardStarted" : "started");
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === "ledgerAmexImportProgress") return sendToPage("amexProgress", message.data);
  if (message?.action === "ledgerAmexImportError") return sendToPage("amexError", message.data);
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
  } else if (message?.action === "ledgerWalmartImportProgress") {
    sendToPage("walmartProgress", message.data);
  } else if (message?.action === "ledgerWalmartImportError") {
    sendToPage("walmartError", message.data);
  } else if (message?.action === "ledgerCapitalOneImportProgress") {
    sendToPage("capitalOneProgress", message.data);
  } else if (message?.action === "ledgerCapitalOneImportError") {
    sendToPage("capitalOneError", message.data);
  } else if (message?.action === "ledgerSchwabImportProgress") {
    sendToPage("schwabProgress", message.data);
  } else if (message?.action === "ledgerSchwabImportError") {
    sendToPage("schwabError", message.data);
  } else if (message?.action === "ledgerAppleCardImportProgress") {
    sendToPage("appleCardProgress", { ...message.data, status: "scraping" });
  } else if (message?.action === "ledgerAppleCardImportError") {
    sendToPage("appleCardError", message.data);
  }
});

globalThis.ledgerBridgeAnnounce = async () => {
  if (await trusted()) sendToPage("ready", { version: chrome.runtime.getManifest().version });
};
globalThis.ledgerBridgeAnnounce();
})();
