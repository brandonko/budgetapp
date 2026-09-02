"use strict";

const LEDGER_CK_API = "https://api.creditkarma.com/graphql";
const LEDGER_CK_CLIENT_VERSION = "2.0.8";
const LEDGER_CK_HUB_HASH = "f669c7e42eb464861cb77d9f27826d0847ddfb5f5079a6ab7e5e2470c9617db8";
const LEDGER_CK_LIST_HASH = "c3c0a630b5cd938595c5901807f63b807e63c71f54a8fcb55e8c9084cb70832a";
let ledgerCreditKarmaController = null;

function ledgerCookie(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))?.[1] || "";
}

function ledgerTraceId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function ledgerAccessToken() {
  let cookieValue = ledgerCookie("CKAT");
  try {
    cookieValue = decodeURIComponent(cookieValue);
  } catch {
    // The cookie may already be decoded.
  }
  const cookieToken = cookieValue.split(";")[0]?.trim();
  if (cookieToken?.startsWith("eyJ")) return cookieToken;

  const response = await chrome.runtime.sendMessage({ action: "ledgerCreditKarmaAccessToken" });
  if (typeof response?.token === "string" && response.token.startsWith("eyJ")) {
    return response.token;
  }
  throw new Error("Credit Karma login token was not available. Sign in and try again.");
}

async function ledgerHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${await ledgerAccessToken()}`,
    "ck-client-name": "prime_web",
    "ck-client-version": LEDGER_CK_CLIENT_VERSION,
    "ck-cookie-id": ledgerCookie("CKTRKID"),
    "ck-device-type": "Desktop",
    "ck-trace-id": ledgerCookie("CKTRACEID") || ledgerTraceId(),
  };
}

async function ledgerGraphql(operationName, hash, variables, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(LEDGER_CK_API, {
        method: "POST",
        headers: await ledgerHeaders(),
        credentials: "include",
        body: JSON.stringify({
          operationName,
          variables,
          extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
        }),
        signal,
      });
      if (!response.ok) {
        const error = new Error(`Credit Karma API returned HTTP ${response.status}.`);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        const payload = await response.json();
        if (payload.errors?.length) {
          const message = payload.errors[0]?.message || "Unknown GraphQL error";
          throw new Error(`Credit Karma API error: ${message}`);
        }
        return payload;
      }
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
      if (attempt === 3 || /Credit Karma API error:/.test(error.message)) throw error;
    }
    if (attempt < 3) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError || new Error("Credit Karma API request failed.");
}

function ledgerDateOnly(value) {
  const text = String(value || "");
  const candidate = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

function ledgerTransaction(raw) {
  const date = ledgerDateOnly(raw.date || raw.transactionDate);
  if (!date) return null;
  const numericAmount = Number(raw.amount?.value ?? raw.amount ?? 0);
  if (!Number.isFinite(numericAmount)) return null;
  const isCredit = numericAmount > 0 || String(raw.category?.type || "").toUpperCase() === "INCOME";
  return {
    sourceId: String(raw.id || raw.urn || ""),
    date,
    description: String(raw.description || raw.merchant?.name || "Credit Karma transaction").trim(),
    amount: Math.abs(numericAmount),
    category: String(raw.category?.name || "Uncategorized").trim(),
    transactionType: isCredit ? "credit" : "debit",
    accountName: String(raw.account?.name || "Credit Karma").trim(),
    accountType: String(raw.account?.type || raw.account?.accountType || "Unknown").trim(),
    provider: String(raw.account?.providerName || raw.account?.provider?.name || "Credit Karma").trim(),
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    notes: raw.notes == null ? null : String(raw.notes),
  };
}

function ledgerUniqueTransactions(transactions) {
  const seen = new Set();
  return transactions.filter((transaction) => {
    // Only collapse records when Credit Karma supplied a stable identity. Two
    // legitimate purchases can otherwise share the same date and amount.
    if (!transaction.sourceId) return true;
    const key = transaction.sourceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ledgerProgress(progress, message) {
  try {
    await chrome.runtime.sendMessage({
      action: "ledgerCreditKarmaProgress",
      data: { progress, message },
    });
  } catch {
    // The Ledger tab may have closed; extraction can still finish safely.
  }
}

async function ledgerHubTransactions(startDate, endDate, signal) {
  const transactions = [];
  let cursor = null;
  let page = 0;
  let complete = false;

  while (!complete) {
    page += 1;
    await ledgerProgress(Math.min(75, 8 + page * 4), `Scanning Credit Karma history page ${page}…`);
    const paginationInput = cursor ? { afterCursor: cursor } : {};
    const payload = await ledgerGraphql(
      "GetTransactions",
      LEDGER_CK_HUB_HASH,
      {
        input: {
          accountInput: {},
          categoryInput: { categoryId: null, primeCategoryType: null },
          datePeriodInput: { datePeriod: null },
          paginationInput,
        },
      },
      signal,
    );
    const transactionPage = payload.data?.prime?.transactionsHub?.transactionPage;
    if (!transactionPage || !Array.isArray(transactionPage.transactions)) {
      throw new Error("Credit Karma returned an unfamiliar transaction response.");
    }

    let reachedBeforeRange = false;
    for (const raw of transactionPage.transactions) {
      const transaction = ledgerTransaction(raw);
      if (!transaction) continue;
      if (transaction.date < startDate) reachedBeforeRange = true;
      if (transaction.date >= startDate && transaction.date <= endDate) transactions.push(transaction);
    }

    const pageInfo = transactionPage.pageInfo;
    if (reachedBeforeRange || !pageInfo?.hasNextPage) {
      complete = true;
    } else if (!pageInfo.endCursor) {
      throw new Error("Credit Karma pagination stopped without a cursor.");
    } else {
      cursor = pageInfo.endCursor;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }
  return transactions;
}

async function ledgerListTransactions(startDate, endDate, signal) {
  await ledgerProgress(20, "Using Credit Karma's all-transactions fallback…");
  const payload = await ledgerGraphql(
    "GetTransactionsList",
    LEDGER_CK_LIST_HASH,
    {
      input: {
        accountInput: {},
        categoryInput: { categoryId: null, primeCategoryType: null },
      },
    },
    signal,
  );
  const root = payload.data?.prime?.transactionList;
  const rows = Array.isArray(root) ? root : root?.transactions;
  if (!Array.isArray(rows)) {
    throw new Error("Credit Karma's all-transactions response was not recognized.");
  }
  return rows
    .map(ledgerTransaction)
    .filter((transaction) => transaction && transaction.date >= startDate && transaction.date <= endDate);
}

async function ledgerExtractCreditKarma(startDate, endDate) {
  ledgerCreditKarmaController?.abort();
  ledgerCreditKarmaController = new AbortController();
  await ledgerProgress(4, "Connecting to Credit Karma…");
  let transactions;
  try {
    transactions = await ledgerHubTransactions(
      startDate,
      endDate,
      ledgerCreditKarmaController.signal,
    );
  } catch (error) {
    if (error.name === "AbortError") throw error;
    console.warn("[Ledger] Credit Karma history pagination failed; trying fallback.", error);
    transactions = await ledgerListTransactions(
      startDate,
      endDate,
      ledgerCreditKarmaController.signal,
    );
  }

  const sorted = ledgerUniqueTransactions(transactions).sort((left, right) =>
    right.date.localeCompare(left.date),
  );
  await ledgerProgress(88, `Preparing ${sorted.length} Credit Karma transactions…`);
  return {
    format: "budgetlens",
    version: 1,
    exportedAt: new Date().toISOString(),
    dateRange: { start: startDate, end: endDate },
    transactions: sorted.map(({ sourceId: _sourceId, ...transaction }) => transaction),
    netWorthHistory: [],
    investmentHistory: [],
    netWorthBreakdown: [],
    wealthAccounts: [],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "ledgerCancelCreditKarma") {
    ledgerCreditKarmaController?.abort();
    sendResponse({ success: true });
    return false;
  }
  if (message?.action !== "ledgerCaptureCreditKarma") return false;

  sendResponse({ success: true, status: "started" });
  ledgerExtractCreditKarma(message.startDate, message.endDate)
    .then((bundle) =>
      chrome.runtime.sendMessage({
        action: "ledgerCreditKarmaComplete",
        data: { content: JSON.stringify(bundle) },
      }),
    )
    .catch((error) =>
      chrome.runtime.sendMessage({
        action: "ledgerCreditKarmaError",
        data: {
          message:
            error.name === "AbortError" ? "Credit Karma import cancelled." : error.message,
        },
      }),
    );
  return false;
});
