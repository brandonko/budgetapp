"use strict";

let activeController = null;

function monthRanges(startDate, endDate) {
  const ranges = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const finalDate = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= finalDate) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const rangeEnd = monthEnd < finalDate ? monthEnd : finalDate;
    ranges.push({
      startDate: cursor.toISOString().slice(0, 10),
      endDate: rangeEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(rangeEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return ranges;
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Venmo import cancelled.", "AbortError"));
    }, { once: true });
  });
}

async function fetchStatement(range, signal) {
  const pageUrl = new URL(window.location.href);
  const params = new URLSearchParams({
    startDate: range.startDate,
    endDate: range.endDate,
    csv: "true",
    accountType: pageUrl.searchParams.get("accountType") || "personal",
    referer: `${pageUrl.pathname}${pageUrl.search}`,
  });
  const profileId = pageUrl.searchParams.get("profileId");
  if (profileId) params.set("profileId", profileId);
  const endpoint = `/api/statement/download?${params.toString()}`;

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(1500 * attempt, signal);
    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        headers: { Accept: "text/csv,application/csv;q=0.9,*/*;q=0.1" },
        signal,
      });
      const body = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Venmo did not authorize the statement download. Sign in and try again.");
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Venmo statement service returned HTTP ${response.status}.`);
          continue;
        }
        throw new Error(`Venmo statement download returned HTTP ${response.status}.`);
      }
      if (!/amount\s*\(total\)/i.test(body) || !/datetime/i.test(body)) {
        if (/sign[ -]?in|log[ -]?in/i.test(body)) {
          throw new Error("Venmo requires you to sign in before downloading statements.");
        }
        lastError = new Error("Venmo is still preparing the statement or returned an unfamiliar file.");
        continue;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError" || /authorize|sign in/i.test(error.message)) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("Venmo could not prepare the requested statement.");
}

async function captureVenmo(startDate, endDate) {
  if (activeController) throw new Error("A Venmo import is already running in this tab.");
  activeController = new AbortController();
  try {
    const ranges = monthRanges(startDate, endDate);
    const statements = [];
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      await chrome.runtime.sendMessage({
        action: "ledgerVenmoProgress",
        data: {
          progress: 5 + Math.floor((index / ranges.length) * 85),
          message: `Downloading Venmo statement ${index + 1}/${ranges.length}…`,
        },
      });
      statements.push({ ...range, content: await fetchStatement(range, activeController.signal) });
    }
    await chrome.runtime.sendMessage({
      action: "ledgerVenmoComplete",
      data: { content: JSON.stringify({ statements }) },
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      await chrome.runtime.sendMessage({
        action: "ledgerVenmoError",
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  } finally {
    activeController = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "ledgerCaptureVenmo") {
    captureVenmo(message.startDate, message.endDate);
    sendResponse({ success: true });
  } else if (message?.action === "ledgerCancelVenmo") {
    activeController?.abort();
    sendResponse({ success: true });
  } else {
    return false;
  }
  return true;
});
