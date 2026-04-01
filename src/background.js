importScripts("storage-defaults.js");

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

let runningTabId = null;
let runningFlowState = null; // { current, total, aborted }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "STEP_LOG") {
    chrome.runtime.sendMessage({ type: "STEP_LOG", text: msg.text, level: msg.level || "debug" }).catch(() => {});
    return;
  }

  if (msg.type === "RUN_AUTOMATION") {
    runOnActiveTab(msg.payload, msg.fieldConfigs)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "RUN_FLOW") {
    runFlow(msg.configuration, msg.data, msg.startUrl, {
      alwaysNavigate: msg.alwaysNavigate !== false,
      onError: msg.onError || "stop",
      retryFallback: msg.retryFallback || "skip",
    })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "STOP_AUTOMATION") {
    if (runningFlowState) runningFlowState.aborted = true;
    if (runningTabId !== null) {
      const tabId = runningTabId;
      chrome.tabs.sendMessage(tabId, { type: "STOP_AUTOMATION" }, () => {
        if (chrome.runtime.lastError) {
          // Content script unreachable — force cleanup and notify side panel
          runningTabId = null;
          runningFlowState = null;
          chrome.runtime.sendMessage({
            type: "AUTOMATION_RESULT",
            ok: false,
            stopped: true,
            error: "Automation stopped (tab unresponsive).",
          }).catch(() => {});
        }
      });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "No automation running." });
    }
    return true;
  }

  if (msg.type === "IS_RUNNING") {
    const running = runningTabId !== null;
    const progress = runningFlowState
      ? { current: runningFlowState.current, total: runningFlowState.total }
      : null;
    sendResponse({ running, progress });
    return true;
  }
});

// ── Single template run (existing behavior) ──────────────────────

async function runOnActiveTab(payload, templateFieldConfigs) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  const data = await loadOrMigrateStorage();
  const domain = data[STORAGE_KEYS.DOMAIN];
  if (domain && !tab.url.includes(domain)) {
    throw new Error(`Active tab (${tab.url}) does not match configured domain (${domain})`);
  }

  const fieldConfigs = (templateFieldConfigs || data[STORAGE_KEYS.FIELD_CONFIGS] || DEFAULT_FIELD_CONFIGS)
    .filter((f) => f.enabled !== false);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/selectors.js", "src/content-script.js"],
  });

  runningTabId = tab.id;

  return new Promise((resolve) => {
    const listener = (message) => {
      if (message.type === "AUTOMATION_RESULT") {
        chrome.runtime.onMessage.removeListener(listener);
        runningTabId = null;
        resolve({ ...message, tabId: tab.id });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.tabs.sendMessage(tab.id, {
      type: "FILL_FORM",
      payload,
      fieldConfigs,
    });
  });
}

// ── Flow / batch runner ──────────────────────────────────────────

async function runFlow(configuration, dataItems, startUrl, opts = {}) {
  if (!Array.isArray(dataItems) || dataItems.length === 0) {
    throw new Error("No data items to process.");
  }

  const { alwaysNavigate = true, onError = "stop", retryFallback = "skip" } = opts;
  const fieldConfigs = configuration.filter((f) => f.enabled !== false);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  const data = await loadOrMigrateStorage();
  const domain = data[STORAGE_KEYS.DOMAIN];

  runningTabId = tab.id;
  runningFlowState = { current: 0, total: dataItems.length, aborted: false };
  let completed = 0;
  let skipped = 0;

  async function navigateAndInject() {
    if (startUrl) {
      await navigateAndWait(tab.id, startUrl);
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/selectors.js", "src/content-script.js"],
    });
  }

  async function runItem(index) {
    return await runSingleItem(tab.id, fieldConfigs, dataItems[index]);
  }

  try {
    for (let i = 0; i < dataItems.length; i++) {
      if (runningFlowState.aborted) {
        throw new Error("STOPPED");
      }

      runningFlowState.current = i;
      broadcastProgress(i, dataItems.length, "running", skipped);

      // Navigation logic
      const shouldNavigate = (i === 0 && alwaysNavigate) || i > 0;
      if (shouldNavigate && startUrl) {
        await navigateAndWait(tab.id, startUrl);
      } else if (i > 0 && !startUrl) {
        const result = {
          ok: false,
          error: `No start URL configured. Batch stopped after item ${i}/${dataItems.length}.`,
          completed, skipped, total: dataItems.length,
        };
        broadcastFlowResult(result);
        return result;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/selectors.js", "src/content-script.js"],
      });

      let itemResult = await runItem(i);

      if (itemResult.stopped) {
        const result = { ok: false, stopped: true, error: "Automation stopped by user.", completed, skipped, total: dataItems.length };
        broadcastFlowResult(result);
        return result;
      }

      if (!itemResult.ok) {
        // ── Error handling strategies ──
        if (onError === "stop") {
          const result = { ok: false, error: `Item ${i + 1} failed: ${itemResult.error}`, completed, skipped, total: dataItems.length };
          broadcastFlowResult(result);
          return result;
        }

        if (onError === "skip") {
          skipped++;
          broadcastProgress(i, dataItems.length, "skipped", skipped, `Item ${i + 1} failed — skipped: ${itemResult.error}`);
          continue;
        }

        if (onError === "retry") {
          broadcastProgress(i, dataItems.length, "retrying", skipped, `Item ${i + 1} failed — retrying...`);

          if (startUrl) await navigateAndWait(tab.id, startUrl);
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["src/selectors.js", "src/content-script.js"],
          });

          const retryResult = await runItem(i);

          if (retryResult.stopped) {
            const result = { ok: false, stopped: true, error: "Automation stopped by user.", completed, skipped, total: dataItems.length };
            broadcastFlowResult(result);
            return result;
          }

          if (!retryResult.ok) {
            if (retryFallback === "skip") {
              skipped++;
              broadcastProgress(i, dataItems.length, "skipped", skipped, `Item ${i + 1} retry failed — skipped: ${retryResult.error}`);
              continue;
            } else {
              const result = { ok: false, error: `Item ${i + 1} retry failed: ${retryResult.error}`, completed, skipped, total: dataItems.length };
              broadcastFlowResult(result);
              return result;
            }
          }
        }
      }

      completed++;
      broadcastProgress(completed, dataItems.length, "done", skipped);
    }

    const allOk = skipped === 0;
    const msg = skipped > 0
      ? `Batch finished. ${completed} succeeded, ${skipped} skipped out of ${dataItems.length}.`
      : `All ${dataItems.length} request(s) completed.`;
    const result = { ok: allOk, message: msg, completed, skipped, total: dataItems.length };
    broadcastFlowResult(result);
    return result;
  } finally {
    runningTabId = null;
    runningFlowState = null;
  }
}

function runSingleItem(tabId, fieldConfigs, payload) {
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message.type === "AUTOMATION_RESULT") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.tabs.sendMessage(tabId, {
      type: "FILL_FORM",
      payload,
      fieldConfigs,
    });
  });
}

// ── Batch navigation ─────────────────────────────────────────────

function navigateAndWait(tabId, url) {
  return new Promise((resolve, reject) => {
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeout);
        setTimeout(resolve, 1500); // extra settle time after load
      }
    };

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(); // proceed even on timeout
    }, 30000);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
}

// ── Progress broadcast ───────────────────────────────────────────

function broadcastProgress(current, total, phase, skipped, detail) {
  chrome.runtime.sendMessage({ type: "FLOW_PROGRESS", current, total, phase, skipped: skipped || 0, detail }).catch(() => {});
}

function broadcastFlowResult(result) {
  chrome.runtime.sendMessage({ type: "FLOW_RESULT", ...result }).catch(() => {});
}
