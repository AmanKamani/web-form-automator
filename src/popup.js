const fileInput = document.getElementById("jsonFile");
const fileNameDisplay = document.getElementById("fileNameDisplay");
const preview = document.getElementById("preview");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const logList = document.getElementById("logList");
const templateSelect = document.getElementById("templateSelect");
const flowSelect = document.getElementById("flowSelect");
const flowDataFile = document.getElementById("flowDataFile");
const flowFileNameDisplay = document.getElementById("flowFileNameDisplay");
const progressDisplay = document.getElementById("progressDisplay");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

let currentMode = "upload";
let parsedPayload = null;
let selectedFieldConfigs = null;
let storageData = {};
let isRunning = false;

// Flow mode state
let flowConfiguration = null;
let flowDataItems = null;
let flowStartUrl = null;
let flowAlwaysNavigate = true;
let flowOnError = "stop";
let flowRetryFallback = "skip";

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  storageData = await loadOrMigrateStorage();

  currentMode = storageData[STORAGE_KEYS.LAST_INPUT_MODE] || "upload";
  activateMode(currentMode);
  populateTemplates();
  populateFlows();

  if (currentMode === "template") loadSelectedTemplate();
  if (currentMode === "flow") loadSelectedFlow();

  chrome.runtime.sendMessage({ type: "IS_RUNNING" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.running) {
      setRunning(true);
      log("info", "Automation is running...");
      if (response.progress) {
        updateProgress(response.progress.current, response.progress.total);
      }
    }
  });
});

// Listen for automation messages from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "AUTOMATION_RESULT") {
    setRunning(false);
    hideProgress();
    clearLog();
    if (msg.stopped) {
      log("warn", msg.error || "Automation stopped.");
    } else if (msg.ok) {
      log("ok", msg.message || "Automation completed.");
    } else {
      log("err", msg.error || "Unknown error.");
    }
  }

  if (msg.type === "FLOW_PROGRESS") {
    updateProgress(msg.current, msg.total, msg.phase, msg.skipped);
    if (msg.phase === "skipped" && msg.detail) {
      log("warn", msg.detail);
    } else if (msg.phase === "retrying" && msg.detail) {
      log("info", msg.detail);
    }
  }

  if (msg.type === "FLOW_RESULT") {
    setRunning(false);
    hideProgress();
    clearLog();
    if (msg.stopped) {
      const parts = [`Stopped. ${msg.completed || 0} completed`];
      if (msg.skipped) parts.push(`${msg.skipped} skipped`);
      parts.push(`out of ${msg.total || "?"}`);
      log("warn", parts.join(", ") + ".");
    } else if (msg.ok) {
      log("ok", msg.message || `All ${msg.completed} requests completed.`);
    } else {
      const parts = [msg.error || "Flow failed."];
      if (msg.skipped) parts.push(`(${msg.skipped} skipped)`);
      log("err", parts.join(" "));
    }
  }
});

// ── Mode tabs ────────────────────────────────────────────────────

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    currentMode = tab.dataset.mode;
    activateMode(currentMode);
    chrome.storage.sync.set({ [STORAGE_KEYS.LAST_INPUT_MODE]: currentMode });
    resetState();

    if (currentMode === "template") loadSelectedTemplate();
    if (currentMode === "flow") loadSelectedFlow();
  });
});

function activateMode(mode) {
  document.querySelectorAll(".mode-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  document.getElementById("modeUpload").classList.toggle("hidden", mode !== "upload");
  document.getElementById("modeTemplate").classList.toggle("hidden", mode !== "template");
  document.getElementById("modeFlow").classList.toggle("hidden", mode !== "flow");
}

function resetState() {
  parsedPayload = null;
  selectedFieldConfigs = null;
  flowConfiguration = null;
  flowDataItems = null;
  flowStartUrl = null;
  flowAlwaysNavigate = true;
  flowOnError = "stop";
  flowRetryFallback = "skip";
  runBtn.disabled = true;
  preview.classList.add("hidden");
  hideProgress();
}

// ── Upload mode ──────────────────────────────────────────────────

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(reader.result);
      handleUploadedJson(raw, file.name);
    } catch (err) {
      showPreviewError([`Invalid JSON: ${err.message}`]);
      resetState();
    }
  };
  reader.readAsText(file);
});

function handleUploadedJson(raw, fileName) {
  // Detect format: { configuration: [...], data: [...] }
  if (Array.isArray(raw.configuration) && Array.isArray(raw.data)) {
    const configs = raw.configuration;
    const dataArr = raw.data;

    if (dataArr.length === 0) {
      showPreviewError(["Data array is empty. Add at least one request object."]);
      resetState();
      return;
    }

    // Detect if data is old format: [{ key: "x", value: "y" }, ...]
    const isOldFormat = dataArr.length > 0 && dataArr[0].key !== undefined && dataArr[0].value !== undefined
      && typeof dataArr[0].key === "string";

    if (isOldFormat) {
      // Convert old key/value pairs to flat object
      const flat = {};
      for (const entry of dataArr) flat[entry.key] = entry.value;
      parsedPayload = flat;
      selectedFieldConfigs = configs;
      flowConfiguration = null;
      flowDataItems = null;
      flowStartUrl = null;
    } else if (dataArr.length === 1) {
      // Single flat object — run as single template
      const result = validateInput(dataArr[0]);
      if (!result.valid) {
        showPreviewError(result.errors);
        resetState();
        return;
      }
      parsedPayload = result.data;
      selectedFieldConfigs = configs;
      flowConfiguration = null;
      flowDataItems = null;
      flowStartUrl = null;
    } else {
      // Multiple flat objects — run as flow/batch
      flowConfiguration = configs;
      flowDataItems = dataArr;
      flowStartUrl = raw.startUrl || null;
      flowAlwaysNavigate = raw.alwaysNavigate !== false;
      flowOnError = raw.onError || "stop";
      flowRetryFallback = raw.retryFallback || "skip";
      parsedPayload = null;
      selectedFieldConfigs = null;
    }
  } else {
    // Plain object payload (legacy format)
    const result = validateInput(raw);
    if (!result.valid) {
      showPreviewError(result.errors);
      resetState();
      return;
    }
    parsedPayload = result.data;
    selectedFieldConfigs = null;
    flowConfiguration = null;
    flowDataItems = null;
    flowStartUrl = null;
  }

  fileNameDisplay.textContent = fileName || "Loaded";
  fileInput.closest(".file-label").classList.add("loaded");

  if (flowDataItems) {
    showPreviewSuccess({ mode: "batch", requests: flowDataItems.length, startUrl: flowStartUrl || "(none)", fields: flowConfiguration.length });
  } else {
    showPreviewSuccess(parsedPayload);
  }

  runBtn.disabled = false;
  clearLog();
}

// ── Template mode ────────────────────────────────────────────────

function populateTemplates() {
  const tpls = storageData[STORAGE_KEYS.TEMPLATES] || [];
  templateSelect.innerHTML = '<option value="">Select a template...</option>';
  tpls.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    opt.textContent = tpl.name;
    templateSelect.appendChild(opt);
  });

  const lastId = storageData[STORAGE_KEYS.LAST_TEMPLATE_ID];
  if (lastId) templateSelect.value = lastId;
}

templateSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEYS.LAST_TEMPLATE_ID]: templateSelect.value });
  loadSelectedTemplate();
});

function loadSelectedTemplate() {
  const tplId = templateSelect.value;
  if (!tplId) {
    resetState();
    return;
  }
  chrome.storage.sync.get(STORAGE_KEYS.TEMPLATES, (data) => {
    const tpls = data[STORAGE_KEYS.TEMPLATES] || [];
    const tpl = tpls.find((t) => t.id === tplId);
    if (!tpl) {
      showPreviewError(["Template not found."]);
      resetState();
      return;
    }
    const result = validateInput(tpl.payload);
    if (!result.valid) {
      showPreviewError(result.errors);
      resetState();
      return;
    }
    parsedPayload = result.data;
    selectedFieldConfigs = tpl.fieldConfigs || null;
    showPreviewSuccess(parsedPayload);
    runBtn.disabled = false;
  });
}

// ── Flow mode ────────────────────────────────────────────────────

function populateFlows() {
  const allFlows = storageData[STORAGE_KEYS.FLOWS] || [];
  flowSelect.innerHTML = '<option value="">Select a flow...</option>';
  allFlows.forEach((flow) => {
    const opt = document.createElement("option");
    opt.value = flow.id;
    opt.textContent = flow.name;
    flowSelect.appendChild(opt);
  });

  const lastId = storageData[STORAGE_KEYS.LAST_FLOW_ID];
  if (lastId) flowSelect.value = lastId;
}

flowSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEYS.LAST_FLOW_ID]: flowSelect.value });
  loadSelectedFlow();
});

function loadSelectedFlow() {
  const flowId = flowSelect.value;
  if (!flowId) {
    resetState();
    return;
  }

  chrome.storage.sync.get([STORAGE_KEYS.FLOWS, STORAGE_KEYS.TEMPLATES], (data) => {
    const allFlows = data[STORAGE_KEYS.FLOWS] || [];
    const allTemplates = data[STORAGE_KEYS.TEMPLATES] || [];
    const flow = allFlows.find((f) => f.id === flowId);
    if (!flow) {
      showPreviewError(["Flow not found."]);
      resetState();
      return;
    }

    // Merge field configs from all referenced templates
    const mergedConfigs = [];
    for (const tplId of (flow.templateIds || [])) {
      const tpl = allTemplates.find((t) => t.id === tplId);
      if (tpl && tpl.fieldConfigs) {
        mergedConfigs.push(...tpl.fieldConfigs.filter((f) => f.enabled !== false));
      }
    }

    if (mergedConfigs.length === 0) {
      showPreviewError(["Flow has no configured fields. Add templates with fields."]);
      resetState();
      return;
    }

    flowConfiguration = mergedConfigs;
    flowStartUrl = flow.startUrl || null;
    flowAlwaysNavigate = flow.alwaysNavigate !== false;
    flowOnError = flow.onError || "stop";
    flowRetryFallback = flow.retryFallback || "skip";
    flowDataItems = null;
    parsedPayload = null;
    selectedFieldConfigs = null;

    showPreviewSuccess({
      flow: flow.name,
      templates: flow.templateIds.length,
      fields: mergedConfigs.length,
      startUrl: flowStartUrl || "(none)",
      status: "Upload data JSON to run batch",
    });

    runBtn.disabled = true;
  });
}

flowDataFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(reader.result);
      let items;

      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw.data && Array.isArray(raw.data)) {
        items = raw.data;
        if (raw.startUrl && !flowStartUrl) flowStartUrl = raw.startUrl;
        if (raw.alwaysNavigate !== undefined) flowAlwaysNavigate = raw.alwaysNavigate !== false;
        if (raw.onError) flowOnError = raw.onError;
        if (raw.retryFallback) flowRetryFallback = raw.retryFallback;
        if (raw.configuration && Array.isArray(raw.configuration)) {
          flowConfiguration = raw.configuration.filter((f) => f.enabled !== false);
        }
      } else if (typeof raw === "object" && !Array.isArray(raw)) {
        items = [raw];
      } else {
        throw new Error("Expected an array of request objects or { data: [...] }");
      }

      if (items.length === 0) {
        showPreviewError(["Data array is empty."]);
        flowDataItems = null;
        runBtn.disabled = true;
        return;
      }

      // Convert old format if needed
      if (items[0].key !== undefined && items[0].value !== undefined && typeof items[0].key === "string") {
        const flat = {};
        for (const entry of items) flat[entry.key] = entry.value;
        items = [flat];
      }

      flowDataItems = items;
      flowFileNameDisplay.textContent = file.name;
      flowDataFile.closest(".file-label").classList.add("loaded");

      showPreviewSuccess({
        mode: "batch",
        requests: items.length,
        fields: flowConfiguration ? flowConfiguration.length : "?",
        startUrl: flowStartUrl || "(none)",
      });
      runBtn.disabled = !flowConfiguration;
      clearLog();
    } catch (err) {
      showPreviewError([`Invalid JSON: ${err.message}`]);
      flowDataItems = null;
      runBtn.disabled = true;
    }
  };
  reader.readAsText(file);
});

// ── Run automation ───────────────────────────────────────────────

runBtn.addEventListener("click", () => {
  setRunning(true);
  clearLog();

  // Flow / batch mode
  if ((currentMode === "flow" || flowDataItems) && flowConfiguration && flowDataItems) {
    log("info", `Starting batch: ${flowDataItems.length} request(s)...`);
    showProgress(0, flowDataItems.length);

    const msg = {
      type: "RUN_FLOW",
      configuration: flowConfiguration,
      data: flowDataItems,
      startUrl: flowStartUrl || null,
      alwaysNavigate: flowAlwaysNavigate,
      onError: flowOnError,
      retryFallback: flowRetryFallback,
    };

    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        setRunning(false);
        hideProgress();
        log("err", `Extension error: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (!response) return; // result comes via broadcast
    });
    return;
  }

  // Single template / upload mode
  if (!parsedPayload) return;
  log("info", "Running automation...");

  const msg = { type: "RUN_AUTOMATION", payload: parsedPayload };
  if (selectedFieldConfigs) msg.fieldConfigs = selectedFieldConfigs;

  chrome.runtime.sendMessage(msg, (response) => {
    if (chrome.runtime.lastError) {
      setRunning(false);
      log("err", `Extension error: ${chrome.runtime.lastError.message}`);
    }
    // Result is handled by the AUTOMATION_RESULT onMessage listener
  });
});

stopBtn.addEventListener("click", () => {
  log("warn", "Stopping automation...");
  chrome.runtime.sendMessage({ type: "STOP_AUTOMATION" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      log("err", "Could not stop — automation may have already finished.");
    }
  });
});

function setRunning(running) {
  isRunning = running;
  runBtn.classList.toggle("hidden", running);
  stopBtn.classList.toggle("hidden", !running);
  if (!running) {
    const canRun = parsedPayload || (flowConfiguration && flowDataItems);
    runBtn.disabled = !canRun;
  }
}

// ── Progress ─────────────────────────────────────────────────────

function showProgress(current, total) {
  progressDisplay.classList.remove("hidden");
  updateProgress(current, total);
}

function updateProgress(current, total, phase, skipped) {
  progressDisplay.classList.remove("hidden");
  const skipSuffix = skipped ? `, ${skipped} skipped` : "";
  if (phase === "running") {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `Running request ${current + 1} of ${total}  (${current} done${skipSuffix})`;
  } else if (phase === "skipped" || phase === "retrying") {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = phase === "retrying" ? `Retrying request ${current + 1} of ${total}` : `Skipped request ${current + 1}${skipSuffix}`;
  } else {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `Completed ${current}/${total}${skipSuffix}`;
  }
}

function hideProgress() {
  progressDisplay.classList.add("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "";
}

// ── Helpers ──────────────────────────────────────────────────────

function showPreviewSuccess(data) {
  preview.classList.remove("hidden");
  preview.textContent = JSON.stringify(data, null, 2);
  preview.style.color = "#166534";
}

function showPreviewError(errors) {
  preview.classList.remove("hidden");
  preview.textContent = errors.join("\n");
  preview.style.color = "#dc2626";
}

function log(level, message) {
  const li = document.createElement("li");
  const dot = document.createElement("span");
  dot.className = `dot dot-${level}`;
  li.appendChild(dot);
  li.appendChild(document.createTextNode(message));
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

function clearLog() { logList.innerHTML = ""; }
