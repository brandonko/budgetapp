"use strict";

let activeImport = null;

const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function visible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function normalizedText(element) {
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

async function waitFor(getValue, timeoutMilliseconds, message) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (activeImport?.cancelled) throw new DOMException("Apple Card import cancelled.", "AbortError");
    const value = getValue();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(message);
}

function clickControl(control) {
  control.scrollIntoView({ block: "center", behavior: "auto" });
  control.click();
}

function setInputValue(input, value) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function dateValueForInput(input, isoDate) {
  if (input.type === "date") return isoDate;
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

function localIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromAccessibleLabel(control) {
  const label = control.getAttribute("aria-label") || "";
  const dateText = label.includes(":") ? label.slice(label.indexOf(":") + 1) : label;
  const parsed = new Date(dateText.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function chooseAppleDate(trigger, isoDate) {
  const target = new Date(`${isoDate}T12:00:00`);
  const current = dateFromAccessibleLabel(trigger);
  if (!current) throw new Error(`Apple Card's ${trigger.getAttribute("aria-label") || "date"} could not be read.`);
  clickControl(trigger);
  const popover = await waitFor(
    () => [...document.querySelectorAll(".export-datepicker-popover")].find(visible),
    10000,
    "Apple Card's calendar did not open.",
  );

  const monthDifference =
    (target.getFullYear() - current.getFullYear()) * 12 + target.getMonth() - current.getMonth();
  const navigationLabel = monthDifference < 0 ? "Previous month" : "Next month";
  for (let index = 0; index < Math.abs(monthDifference); index += 1) {
    const navigation = await waitFor(
      () => [...popover.querySelectorAll(`ui-button[aria-label="${navigationLabel}"]`)]
        .find((element) => visible(element) && element.getAttribute("aria-disabled") !== "true"),
      5000,
      `Apple Card cannot navigate to ${isoDate}.`,
    );
    clickControl(navigation);
    await sleep(120);
  }

  const day = await waitFor(
    () => [...popover.querySelectorAll("ui-button[aria-label]")].find((element) => {
      if (!visible(element) || element.getAttribute("aria-disabled") === "true") return false;
      const parsed = dateFromAccessibleLabel(element);
      return parsed && localIsoDate(parsed) === isoDate;
    }),
    5000,
    `Apple Card does not offer ${isoDate} in its date picker.`,
  );
  clickControl(day);
  await waitFor(
    () => !document.body.contains(popover) || !visible(popover),
    5000,
    "Apple Card did not close its date picker after selecting a date.",
  );
}

function fieldLabel(input) {
  const explicit = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return [
    input.getAttribute("aria-label"), input.name, input.placeholder,
    explicit?.textContent, input.closest("label")?.textContent,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function findExportDateButton(label) {
  const normalizedLabel = label.toLocaleLowerCase();
  const ariaMatch = [...document.querySelectorAll("ui-button[aria-label], [role='button'][aria-label]")]
    .find((element) =>
      visible(element) &&
      (element.getAttribute("aria-label") || "").trim().toLocaleLowerCase().startsWith(normalizedLabel)
    );
  if (ariaMatch) return ariaMatch;

  const labelElement = [...document.querySelectorAll(".flexible-row > div:first-child, li.item div")]
    .find((element) => visible(element) && normalizedText(element) === normalizedLabel.replace(/:$/, ""));
  const row = labelElement?.closest(".flexible-row") || labelElement?.closest("li.item");
  return row?.querySelector("ui-button[role='button'], [role='button'], button") || null;
}

function exportControlDiagnostics() {
  return [...document.querySelectorAll("ui-button, button, [role='button']")]
    .filter(visible)
    .map((element) => ({
      tag: element.tagName.toLocaleLowerCase(),
      label: (element.getAttribute("aria-label") || "").slice(0, 80),
      text: normalizedText(element).slice(0, 80),
    }))
    .filter((entry) => /date|export|csv|comma/.test(`${entry.label} ${entry.text}`.toLocaleLowerCase()))
    .slice(0, 12);
}

async function reportProgress(progress, message) {
  await chrome.runtime.sendMessage({
    action: "ledgerAppleCardProgress",
    data: { progress, message },
  });
}

async function automateExport(startDate, endDate, nonce) {
  await reportProgress(5, "Opening Apple Card statements. Sign in if Apple asks you to.");
  const exportControl = await waitFor(
    () => [...document.querySelectorAll("button, a, [role='button']")].find((element) =>
      visible(element) && normalizedText(element).includes("export transactions")
    ),
    10 * 60 * 1000,
    "Could not find Export Transactions. Open Statements at card.apple.com and try again.",
  );
  await reportProgress(20, "Opening Apple Card transaction export...");
  clickControl(exportControl);

  let dateControls;
  try {
    dateControls = await waitFor(
      () => {
        const inputs = [...document.querySelectorAll("input")].filter(visible);
        const start = inputs.find((input) => /start|from/.test(fieldLabel(input))) || inputs.filter((input) => input.type === "date")[0];
        const end = inputs.find((input) => /end|to/.test(fieldLabel(input))) || inputs.filter((input) => input.type === "date")[1];
        if (start && end) return { kind: "inputs", start, end };
        const startButton = findExportDateButton("start date:");
        const endButton = findExportDateButton("end date:");
        return startButton && endButton
          ? { kind: "apple-date-pickers", start: startButton, end: endButton }
          : null;
      },
      20000,
      "Apple Card opened an unfamiliar export form; start and end date controls were not found.",
    );
  } catch (error) {
    const diagnostics = JSON.stringify(exportControlDiagnostics());
    throw new Error(`${error.message} Visible export controls: ${diagnostics}`);
  }
  if (dateControls.kind === "inputs") {
    setInputValue(dateControls.start, dateValueForInput(dateControls.start, startDate));
    setInputValue(dateControls.end, dateValueForInput(dateControls.end, endDate));
  } else {
    await chooseAppleDate(dateControls.start, startDate);
    await chooseAppleDate(dateControls.end, endDate);
  }

  const csvControl = [...document.querySelectorAll("button, label, [role='radio'], [role='option']")]
    .find((element) => visible(element) && /^(csv|comma separated values)/.test(normalizedText(element)));
  if (csvControl) clickControl(csvControl);

  await reportProgress(40, "Requesting Apple Card CSV...");
  const submitControl = await waitFor(
    () => [...document.querySelectorAll("button, [role='button']")].find((element) => {
      if (!visible(element) || element.disabled || element === exportControl) return false;
      const text = normalizedText(element);
      return text === "export" || text === "download" || text === "export transactions";
    }),
    15000,
    "Apple Card's export confirmation button was not found.",
  );
  clickControl(submitControl);

  const content = await waitFor(
    () => activeImport?.nonce === nonce && activeImport.content,
    60000,
    "Apple Card did not return a readable CSV. Use the manual CSV fallback in Ledger.",
  );
  await reportProgress(90, "Apple Card export received. Adding transactions to Ledger...");
  await chrome.runtime.sendMessage({
    action: "ledgerAppleCardComplete",
    data: { content },
  });
}

window.addEventListener("message", (event) => {
  if (
    event.source === window &&
    event.data?.source === "ledger-apple-card-main" &&
    activeImport?.nonce === event.data.nonce &&
    typeof event.data.content === "string" &&
    /transaction date/i.test(event.data.content) &&
    /amount/i.test(event.data.content)
  ) {
    activeImport.content = event.data.content;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "ledgerCaptureAppleCard") {
    if (activeImport) {
      sendResponse({ success: false, error: "An Apple Card import is already running in this tab." });
      return false;
    }
    activeImport = { nonce: message.nonce, content: "", cancelled: false };
    automateExport(message.startDate, message.endDate, message.nonce)
      .catch(async (error) => {
        if (error.name !== "AbortError") {
          await chrome.runtime.sendMessage({
            action: "ledgerAppleCardError",
            data: { message: error instanceof Error ? error.message : String(error) },
          });
        }
      })
      .finally(() => { activeImport = null; });
    sendResponse({ success: true });
  } else if (message?.action === "ledgerCancelAppleCard") {
    if (activeImport) activeImport.cancelled = true;
    sendResponse({ success: true });
  } else {
    return false;
  }
  return true;
});
