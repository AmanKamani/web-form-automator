let fieldConfigs = [];
let templates = [];
let payloadValues = {};
let flows = [];

// The template currently being edited, or null for a brand-new template
let activeTemplateId = null;
// The flow currently being edited, or null
let activeFlowId = null;
let flowTemplateIds = [];

let _autoSaveTimer = null;
// Track which editor is active: "template", "flow", or null
let activeEditorType = null;

document.addEventListener("DOMContentLoaded", async () => {
  const data = await loadOrMigrateStorage();

  document.getElementById("domain").value = data.domain || "";
  fieldConfigs = data[STORAGE_KEYS.FIELD_CONFIGS] || JSON.parse(JSON.stringify(DEFAULT_FIELD_CONFIGS));
  templates = data[STORAGE_KEYS.TEMPLATES] || [];
  flows = data[STORAGE_KEYS.FLOWS] || [];

  renderTemplateList();
  renderFlowList();

  // Wire sidebar click (once, uses event delegation)
  document.getElementById("templateList").addEventListener("click", handleSidebarClick);
  document.getElementById("flowList").addEventListener("click", handleFlowSidebarClick);

  // Wire field list events (once, uses event delegation)
  const fieldListEl = document.getElementById("fieldList");
  fieldListEl.addEventListener("click", handleFieldAction);
  fieldListEl.addEventListener("change", handleFieldChange);
  fieldListEl.addEventListener("input", handleFieldChange);

  // Wire payload form events (once, uses event delegation)
  document.getElementById("payloadForm").addEventListener("input", handlePayloadInput);

  // Wire flow template list events (delegation)
  document.getElementById("flowTemplateList").addEventListener("click", handleFlowTemplateAction);

  // Wire template buttons
  document.getElementById("newTemplateBtn").addEventListener("click", startNewTemplate);
  document.getElementById("saveNewBtn").addEventListener("click", handleSaveNew);
  document.getElementById("updateBtn").addEventListener("click", handleUpdate);
  document.getElementById("duplicateBtn").addEventListener("click", handleDuplicate);
  document.getElementById("deleteCurrentBtn").addEventListener("click", handleDeleteCurrent);
  document.getElementById("addFieldBtn").addEventListener("click", addField);
  document.getElementById("addFieldBtnBottom").addEventListener("click", addField);
  document.getElementById("resetFieldsBtn").addEventListener("click", resetFields);
  document.getElementById("exportPayloadBtn").addEventListener("click", exportPayload);
  document.getElementById("templateNameInput").addEventListener("input", scheduleAutoSave);

  // Wire flow buttons
  document.getElementById("newFlowBtn").addEventListener("click", startNewFlow);
  document.getElementById("saveFlowBtn").addEventListener("click", handleSaveFlow);
  document.getElementById("updateFlowBtn").addEventListener("click", handleUpdateFlow);
  document.getElementById("exportFlowBtn").addEventListener("click", exportFlow);
  document.getElementById("deleteFlowBtn").addEventListener("click", handleDeleteFlow);
  document.getElementById("addFlowTemplateBtn").addEventListener("click", addFlowTemplate);
  document.getElementById("flowNameInput").addEventListener("input", scheduleFlowAutoSave);
  document.getElementById("flowStartUrl").addEventListener("input", scheduleFlowAutoSave);
  document.getElementById("flowAlwaysNavigate").addEventListener("change", scheduleFlowAutoSave);
  document.getElementById("flowOnError").addEventListener("change", (e) => {
    document.getElementById("retryFallbackGroup").classList.toggle("hidden", e.target.value !== "retry");
    scheduleFlowAutoSave();
  });
  document.getElementById("flowRetryFallback").addEventListener("change", scheduleFlowAutoSave);

  // Wire share/import buttons
  document.getElementById("shareTemplateBtn").addEventListener("click", handleShareTemplate);
  document.getElementById("importTemplateFile").addEventListener("change", handleImportTemplate);
  document.getElementById("dataTemplateBtn").addEventListener("click", handleDataTemplate);
  document.getElementById("shareFlowBtn").addEventListener("click", handleShareFlow);
  document.getElementById("importFlowFile").addEventListener("change", handleImportFlow);
  document.getElementById("flowDataTemplateBtn").addEventListener("click", handleFlowDataTemplate);

  // Version display
  document.getElementById("versionDisplay").textContent =
    `Extension v${getExtensionVersion()} \u00b7 Config v${CONFIG_VERSION}`;

  document.getElementById("domain").addEventListener("change", persistDomain);
  document.getElementById("reloadExtLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions" });
  });

  // Deep-link: open a specific template or flow via URL hash
  const hash = window.location.hash;
  if (hash) {
    const m = hash.match(/^#(template|flow)=(.+)$/);
    if (m) {
      const [, type, id] = m;
      if (type === "template") {
        const tpl = templates.find((t) => t.id === id);
        if (tpl) loadTemplate(tpl);
      } else {
        const flow = flows.find((f) => f.id === id);
        if (flow) loadFlow(flow);
      }
      window.location.hash = "";
    }
  }
});

// ── Template sidebar ─────────────────────────────────────────────

function renderTemplateList() {
  const container = document.getElementById("templateList");
  container.innerHTML = "";

  if (templates.length === 0) {
    container.innerHTML = '<div class="template-list-empty">No templates yet.<br>Click <strong>+ New</strong> to create one.</div>';
    return;
  }

  templates.forEach((tpl, idx) => {
    const fieldCount = (tpl.fieldConfigs || []).length;
    const isActive = activeTemplateId === tpl.id;

    const item = document.createElement("div");
    item.className = "tpl-item" + (isActive ? " active" : "");
    item.dataset.tplIdx = idx;
    const keyHtml = tpl.key ? `<span class="tpl-item-key" title="${esc(tpl.key)}">${esc(tpl.key)}</span>` : "";
    item.innerHTML = `
      <div class="tpl-item-info">
        <span class="tpl-item-name">${esc(tpl.name)}</span>
        <span class="tpl-item-meta">${fieldCount} field(s)</span>
        ${keyHtml}
      </div>
    `;
    container.appendChild(item);
  });
}

function handleSidebarClick(e) {
  const item = e.target.closest(".tpl-item");
  if (item) {
    const idx = parseInt(item.dataset.tplIdx, 10);
    loadTemplate(templates[idx]);
  }
}

// ── Editor state ─────────────────────────────────────────────────

function showEmptyState() {
  activeEditorType = null;
  document.getElementById("emptyState").classList.remove("hidden");
  document.getElementById("editorContent").classList.add("hidden");
  document.getElementById("flowEditorContent").classList.add("hidden");
  updateActionButtons();
}

function showEditor() {
  activeEditorType = "template";
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("editorContent").classList.remove("hidden");
  document.getElementById("flowEditorContent").classList.add("hidden");
  updateActionButtons();
}

function showFlowEditor() {
  activeEditorType = "flow";
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("editorContent").classList.add("hidden");
  document.getElementById("flowEditorContent").classList.remove("hidden");
  updateActionButtons();
}

function updateActionButtons() {
  const isTpl = activeEditorType === "template";
  const isFlow = activeEditorType === "flow";
  const tplIsNew = activeTemplateId === null;
  const flowIsNew = activeFlowId === null;

  // Template buttons
  document.getElementById("saveNewBtn").classList.toggle("hidden", !isTpl || !tplIsNew);
  document.getElementById("updateBtn").classList.toggle("hidden", !isTpl || tplIsNew);
  document.getElementById("duplicateBtn").classList.toggle("hidden", !isTpl || tplIsNew);
  document.getElementById("deleteCurrentBtn").classList.toggle("hidden", !isTpl || tplIsNew);

  // Template badges
  document.getElementById("editingBadge").classList.toggle("hidden", !isTpl || tplIsNew);
  document.getElementById("newBadge").classList.toggle("hidden", !isTpl || !tplIsNew);

  // Flow buttons
  document.getElementById("saveFlowBtn").classList.toggle("hidden", !isFlow || !flowIsNew);
  document.getElementById("updateFlowBtn").classList.toggle("hidden", !isFlow || flowIsNew);
  document.getElementById("exportFlowBtn").classList.toggle("hidden", !isFlow || flowIsNew);
  document.getElementById("deleteFlowBtn").classList.toggle("hidden", !isFlow || flowIsNew);

  // Flow badges
  document.getElementById("flowEditingBadge").classList.toggle("hidden", !isFlow || flowIsNew);
  document.getElementById("flowNewBadge").classList.toggle("hidden", !isFlow || !flowIsNew);

  // Share group title
  document.getElementById("shareGroupTitle").classList.toggle("hidden", !isTpl && !isFlow);

  // Template share buttons: share/data require a saved template
  document.getElementById("shareTemplateBtn").classList.toggle("hidden", !isTpl || tplIsNew);
  document.getElementById("dataTemplateBtn").classList.toggle("hidden", !isTpl || tplIsNew);

  // Flow share buttons: share/data require a saved flow
  document.getElementById("shareFlowBtn").classList.toggle("hidden", !isFlow || flowIsNew);
  document.getElementById("flowDataTemplateBtn").classList.toggle("hidden", !isFlow || flowIsNew);

  updateHowItWorks();
}

function updateHowItWorks() {
  const container = document.getElementById("howItWorks");
  if (activeEditorType === "flow") {
    container.innerHTML = `
      <h4>How Flows Work</h4>
      <ol class="how-list">
        <li>Create templates for each page/step</li>
        <li>Add templates to this flow in order</li>
        <li>Set a <strong>Start URL</strong> — the page to navigate to before each batch item</li>
        <li>Export the flow JSON, then fill the <code>data</code> array with one object per request</li>
        <li>In the popup, choose <strong>Flow</strong> tab, select this flow, upload the JSON, and run</li>
      </ol>
      <div class="how-tip">
        <strong>Tip:</strong> Each data object only needs keys for input fields. Action fields (button/expand) use their configured display name &amp; label match automatically.
      </div>`;
  } else if (activeEditorType === "template") {
    container.innerHTML = `
      <h4>How Templates Work</h4>
      <ol class="how-list">
        <li>Add fields in the order they appear on the page</li>
        <li>Use <strong>Input</strong> types (typeahead, text, choice) for data entry fields</li>
        <li>Use <strong>Action</strong> types (button, expand) for clicks &amp; toggles</li>
        <li>Fill payload values above, or export JSON to upload later</li>
        <li>In the popup, select this template and run</li>
      </ol>
      <div class="how-tip">
        <strong>Tip:</strong> For buttons, the <em>Display Name</em> is the button text to find and click. For expand, <em>Label Match</em> is the toggle text.
      </div>`;
  } else {
    container.innerHTML = `
      <h4>Getting Started</h4>
      <ol class="how-list">
        <li>Click <strong>+ New</strong> under Templates to create a template</li>
        <li>Configure fields to match your target page</li>
        <li>Optionally, create a <strong>Flow</strong> to chain templates for multi-page or batch automation</li>
      </ol>`;
  }
}

// ── New template ─────────────────────────────────────────────────

function startNewTemplate() {
  activeTemplateId = null;
  activeFlowId = null;
  fieldConfigs = [];
  payloadValues = {};

  document.getElementById("templateNameInput").value = "";
  const keyEl = document.getElementById("templateKeyDisplay");
  keyEl.textContent = "";
  keyEl.classList.add("hidden");
  renderFieldList();
  renderPayloadForm();
  renderTemplateList();
  renderFlowList();
  showEditor();

  document.getElementById("templateNameInput").focus();
}

// ── Load existing template ───────────────────────────────────────

function loadTemplate(tpl) {
  activeTemplateId = tpl.id;
  activeFlowId = null;

  document.getElementById("templateNameInput").value = tpl.name || "";
  const keyEl = document.getElementById("templateKeyDisplay");
  if (tpl.key) {
    keyEl.textContent = tpl.key;
    keyEl.classList.remove("hidden");
  } else {
    keyEl.textContent = "";
    keyEl.classList.add("hidden");
  }
  fieldConfigs = JSON.parse(JSON.stringify(tpl.fieldConfigs || []));
  payloadValues = JSON.parse(JSON.stringify(tpl.payload || {}));

  renderFieldList();
  renderPayloadForm();
  renderTemplateList();
  renderFlowList();
  showEditor();
}

// ── Save / Update / Duplicate / Delete ───────────────────────────

function handleSaveNew() {
  const name = document.getElementById("templateNameInput").value.trim();
  if (!name) { alert("Enter a template name."); document.getElementById("templateNameInput").focus(); return; }

  const newTpl = {
    id: "tpl_" + Date.now(),
    key: generateKey(name),
    name,
    payload: readPayloadFromForm(),
    fieldConfigs: JSON.parse(JSON.stringify(fieldConfigs)),
  };

  templates.push(newTpl);
  activeTemplateId = newTpl.id;
  persistTemplates();
  renderTemplateList();
  updateActionButtons();
  showToast(`Template "${name}" saved.`);
}

function handleUpdate() {
  const tpl = templates.find((t) => t.id === activeTemplateId);
  if (!tpl) return;

  const name = document.getElementById("templateNameInput").value.trim();
  if (!name) { alert("Template name cannot be empty."); return; }

  tpl.name = name;
  tpl.payload = readPayloadFromForm();
  tpl.fieldConfigs = JSON.parse(JSON.stringify(fieldConfigs));

  persistTemplates();
  renderTemplateList();
  showToast(`Template "${name}" updated.`);
}

function handleDuplicate() {
  const name = document.getElementById("templateNameInput").value.trim() + " (copy)";
  const dup = {
    id: "tpl_" + Date.now(),
    key: generateKey(name),
    name,
    payload: readPayloadFromForm(),
    fieldConfigs: JSON.parse(JSON.stringify(fieldConfigs)),
  };

  templates.push(dup);
  activeTemplateId = dup.id;
  document.getElementById("templateNameInput").value = name;
  persistTemplates();
  renderTemplateList();
  updateActionButtons();
  showToast(`Duplicated as "${name}".`);
}

function handleDeleteCurrent() {
  const tpl = templates.find((t) => t.id === activeTemplateId);
  if (!tpl) return;
  if (!confirm(`Delete template "${tpl.name}"?`)) return;

  templates = templates.filter((t) => t.id !== activeTemplateId);
  activeTemplateId = null;
  persistTemplates();
  renderTemplateList();
  renderFlowList();
  showEmptyState();
  showToast("Template deleted.");
}

// ── Dynamic payload form ─────────────────────────────────────────

function renderPayloadForm() {
  const container = document.getElementById("payloadForm");
  const emptyMsg = document.getElementById("payloadEmpty");
  container.innerHTML = "";
  container.className = "payload-stepper";

  if (fieldConfigs.length === 0) {
    container.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    return;
  }

  container.classList.remove("hidden");
  emptyMsg.classList.add("hidden");

  fieldConfigs.forEach((cfg, i) => {
    const key = cfg.key;
    const label = cfg.displayName || key;
    const isMulti = cfg.fieldType === "typeahead";
    const isButton = cfg.fieldType === "button";
    const isExpand = cfg.fieldType === "expand";
    const isDialog = cfg.fieldType === "dialog";
    const isDisabled = cfg.enabled === false;

    const stepTypeClass = "payload-step-" + (cfg.fieldType || "typeahead");
    const step = document.createElement("div");
    step.className = "payload-step " + stepTypeClass + (isDisabled ? " payload-step-disabled" : "");
    step.dataset.step = i + 1;

    const indicator = document.createElement("div");
    indicator.className = "payload-step-indicator";
    indicator.innerHTML = `<div class="payload-step-circle">${i + 1}</div><div class="payload-step-line"></div>`;

    const content = document.createElement("div");
    content.className = "payload-step-content";

    if (isButton || isExpand || isDialog) {
      const row = document.createElement("div");
      const actionClass = isButton ? " payload-action-button" : isExpand ? " payload-action-expand" : " payload-action-dialog";
      row.className = "payload-row payload-action-row" + actionClass;
      const dialogLabel = isDialog ? `Dialog: ${(cfg.dialogType || "alert").charAt(0).toUpperCase() + (cfg.dialogType || "alert").slice(1)}` : "";
      const badge = isButton ? "Button" : isExpand ? "Expand" : dialogLabel;
      row.innerHTML = `<span class="payload-action-badge">${badge}</span><span class="payload-action-label">${esc(label)}</span>`;
      content.appendChild(row);
    } else {
      const currentValue = payloadValues[key];
      const row = document.createElement("div");
      row.className = "payload-row";

      const labelEl = document.createElement("label");
      labelEl.textContent = label;
      if (isMulti) {
        const small = document.createElement("small");
        small.textContent = " (one per line)";
        labelEl.appendChild(small);
      }
      const keyTag = document.createElement("span");
      keyTag.className = "payload-key-tag";
      keyTag.textContent = key;
      labelEl.appendChild(keyTag);

      let inputEl;
      if (isMulti && Array.isArray(currentValue)) {
        inputEl = document.createElement("textarea");
        inputEl.rows = 3;
        inputEl.value = currentValue.join("\n");
      } else if (isMulti) {
        inputEl = document.createElement("textarea");
        inputEl.rows = 3;
        inputEl.value = currentValue || "";
      } else {
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.value = currentValue || "";
      }

      inputEl.dataset.payKey = key;
      inputEl.placeholder = `Enter ${label.toLowerCase()}`;

      row.appendChild(labelEl);
      row.appendChild(inputEl);
      content.appendChild(row);
    }

    step.appendChild(indicator);
    step.appendChild(content);
    container.appendChild(step);
  });
}

function handlePayloadInput(e) {
  const key = e.target.dataset.payKey;
  if (!key) return;
  payloadValues[key] = e.target.value;
  scheduleAutoSave();
}

function readPayloadFromForm() {
  const result = {};
  fieldConfigs.forEach((cfg) => {
    if (cfg.fieldType === "button" || cfg.fieldType === "expand" || cfg.fieldType === "dialog") return;
    const key = cfg.key;
    let raw = payloadValues[key] || "";
    if (!raw && cfg.defaultValue) raw = cfg.defaultValue;

    if (cfg.fieldType === "typeahead" && typeof raw === "string" && raw.includes("\n")) {
      result[key] = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(raw)) {
      result[key] = raw;
    } else {
      result[key] = typeof raw === "string" ? raw.trim() : raw;
    }
  });
  return result;
}

// ── Field config UI ──────────────────────────────────────────────

function renderFieldList() {
  const container = document.getElementById("fieldList");
  container.innerHTML = "";

  fieldConfigs.forEach((cfg, idx) => {
    const isAction = cfg.fieldType === "button" || cfg.fieldType === "expand" || cfg.fieldType === "dialog";
    const typeClassMap = { button: "field-item-button", expand: "field-item-expand", dialog: "field-item-dialog", typeahead: "field-item-typeahead", text: "field-item-text", choice: "field-item-choice" };
    const typeClass = typeClassMap[cfg.fieldType] || "field-item-input";
    const item = document.createElement("div");
    item.className = "field-item" + (cfg.enabled === false ? " disabled-field" : "") + (typeClass ? " " + typeClass : "");

    const typeBadgeMap = {
      button: '<span class="field-type-badge badge-button">Action: Button</span>',
      expand: '<span class="field-type-badge badge-expand">Action: Expand</span>',
      dialog: '<span class="field-type-badge badge-dialog">Action: Dialog</span>',
      typeahead: '<span class="field-type-badge badge-typeahead">Input: Typeahead</span>',
      text: '<span class="field-type-badge badge-text">Input: Text</span>',
      choice: '<span class="field-type-badge badge-choice">Input: Choice</span>',
    };
    const typeBadge = typeBadgeMap[cfg.fieldType] || "";

    item.innerHTML = `
      <div class="field-arrows">
        <button data-dir="up" data-idx="${idx}" title="Move up">&uarr;</button>
        <button data-dir="down" data-idx="${idx}" title="Move down">&darr;</button>
      </div>
      <div class="field-body">
        <div class="full-width field-badge-row">${typeBadge}</div>
        <div>
          <label title="Typeahead: dropdowns that search as you type. Text: plain input/textarea. Choice: native HTML select. Button: finds and clicks a button by its visible text. Expand: clicks an expandable section/toggle to reveal hidden fields.">Field Type</label>
          <select data-field="fieldType" data-idx="${idx}">
            <option value="typeahead" ${cfg.fieldType === "typeahead" ? "selected" : ""}>Typeahead</option>
            <option value="text" ${cfg.fieldType === "text" ? "selected" : ""}>Text</option>
            <option value="choice" ${cfg.fieldType === "choice" ? "selected" : ""}>Choice (native select)</option>
            <option value="button" ${cfg.fieldType === "button" ? "selected" : ""}>Button (click)</option>
            <option value="expand" ${cfg.fieldType === "expand" ? "selected" : ""}>Expand (toggle section)</option>
            <option value="dialog" ${cfg.fieldType === "dialog" ? "selected" : ""}>Dialog (alert/confirm/prompt)</option>
          </select>
        </div>
        <div style="${cfg.fieldType === "dialog" ? "" : "display:none"}">
          <label title="Which native browser dialog to intercept.">Dialog Type</label>
          <select data-field="dialogType" data-idx="${idx}">
            <option value="alert" ${(cfg.dialogType || "alert") === "alert" ? "selected" : ""}>Alert</option>
            <option value="confirm" ${cfg.dialogType === "confirm" ? "selected" : ""}>Confirm</option>
            <option value="prompt" ${cfg.dialogType === "prompt" ? "selected" : ""}>Prompt</option>
          </select>
        </div>
        <div style="${(cfg.fieldType === "dialog" && cfg.dialogType === "confirm") ? "" : "display:none"}">
          <label title="The value to return from window.confirm(). true = OK, false = Cancel.">Confirm Return Value</label>
          <select data-field="dialogReturnValue" data-idx="${idx}">
            <option value="true" ${(cfg.dialogReturnValue !== false) ? "selected" : ""}>true (OK)</option>
            <option value="false" ${cfg.dialogReturnValue === false ? "selected" : ""}>false (Cancel)</option>
          </select>
        </div>
        <div style="${(cfg.fieldType === "dialog" && cfg.dialogType === "prompt") ? "" : "display:none"}">
          <label title="The text string to return from window.prompt(). Simulates the user typing this value and clicking OK.">Prompt Return Value</label>
          <input type="text" data-field="promptReturnValue" data-idx="${idx}" value="${esc(cfg.promptReturnValue || "")}">
        </div>
        <div>
          <label title="Unique identifier used as the key in payload JSON. Keep it short, e.g. groupName, members.">Key</label>
          <input type="text" data-field="key" data-idx="${idx}" value="${esc(cfg.key)}">
        </div>
        <div>
          <label title="Friendly name shown in the UI and console logs. For buttons: the visible button text to find and click.">Display Name</label>
          <input type="text" data-field="displayName" data-idx="${idx}" value="${esc(cfg.displayName)}">
        </div>
        <div class="full-width" style="${(cfg.fieldType === "button" || cfg.fieldType === "dialog") ? "display:none" : ""}">
          <label title="Text to match against visible elements on the target page. For expand: matches link/toggle text. Can be the full label or a unique partial fragment. Multiple values are comma-separated — any match wins.">Label Match <small>(full label or partial text, comma-separated)</small></label>
          <input type="text" data-field="labelMatch" data-idx="${idx}" value="${esc((cfg.labelMatch || []).join(", "))}">
        </div>
        <div class="timeout-field" style="${(cfg.fieldType === "text" || cfg.fieldType === "button" || cfg.fieldType === "expand" || cfg.fieldType === "dialog") ? "display:none" : ""}">
          <label title="How long (ms) to wait after typing for AJAX search results to load. Slow fields like member lookup may need 5000–10000ms. Max: 60000ms.">Search Wait <small>(ms, max 60s)</small></label>
          <input type="number" data-field="ajaxWait" data-idx="${idx}" value="${cfg.ajaxWait || 1500}" min="100" max="60000" step="100">
        </div>
        <div class="timeout-field" style="${(cfg.fieldType === "text" || cfg.fieldType === "button" || cfg.fieldType === "expand" || cfg.fieldType === "dialog") ? "display:none" : ""}">
          <label title="After the search wait, how many times to poll for dropdown items (~400ms each). More retries = more time for slow-rendering results. e.g. 15 retries ≈ 6s of polling.">Dropdown Retries</label>
          <input type="number" data-field="dropdownRetries" data-idx="${idx}" value="${cfg.dropdownRetries || 15}" min="1" step="1">
        </div>
        <div class="button-wait-field" style="${(cfg.fieldType !== "button" && cfg.fieldType !== "expand") ? "display:none" : ""}">
          <label title="What to do after clicking the button. No wait: proceed immediately. Fixed wait: sleep for specified ms. Smart wait: wait for next field's label to appear. URL change: wait for page URL to change.">Wait After Click</label>
          <select data-field="buttonWait" data-idx="${idx}">
            <option value="no_wait" ${cfg.buttonWait === "no_wait" ? "selected" : ""}>No wait</option>
            <option value="fixed_wait" ${cfg.buttonWait === "fixed_wait" ? "selected" : ""}>Fixed wait</option>
            <option value="smart_wait" ${(cfg.buttonWait === "smart_wait" || !cfg.buttonWait) ? "selected" : ""}>Smart wait (next field)</option>
            <option value="url_change" ${cfg.buttonWait === "url_change" ? "selected" : ""}>Wait for URL change</option>
          </select>
        </div>
        <div class="button-wait-field" style="${((cfg.fieldType !== "button" && cfg.fieldType !== "expand") || (cfg.buttonWait !== "fixed_wait")) ? "display:none" : ""}">
          <label title="How long (ms) to wait after clicking the button.">Wait Duration <small>(ms)</small></label>
          <input type="number" data-field="buttonWaitMs" data-idx="${idx}" value="${cfg.buttonWaitMs || 3000}" min="100" max="60000" step="100">
        </div>
        <div class="full-width default-value-field" style="${(cfg.fieldType === "expand" || cfg.fieldType === "button" || cfg.fieldType === "dialog") ? "display:none" : ""}">
          <label title="Pre-filled value used when no payload value is provided. Also used as placeholder in exported JSON.">Default Value</label>
          <input type="text" data-field="defaultValue" data-idx="${idx}" value="${esc(cfg.defaultValue || "")}">
        </div>
        <div class="full-width field-footer">
          <label class="toggle-label">
            <input type="checkbox" data-field="enabled" data-idx="${idx}" ${cfg.enabled !== false ? "checked" : ""}>
            Enabled
          </label>
          <button class="btn btn-sm" data-action="duplicate" data-idx="${idx}">Duplicate</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-idx="${idx}">Remove</button>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function handleFieldAction(e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx, 10);

  if (btn.dataset.dir === "up" && idx > 0) {
    [fieldConfigs[idx - 1], fieldConfigs[idx]] = [fieldConfigs[idx], fieldConfigs[idx - 1]];
    renderFieldList();
    renderPayloadForm();
    scheduleAutoSave();
  } else if (btn.dataset.dir === "down" && idx < fieldConfigs.length - 1) {
    [fieldConfigs[idx], fieldConfigs[idx + 1]] = [fieldConfigs[idx + 1], fieldConfigs[idx]];
    renderFieldList();
    renderPayloadForm();
    scheduleAutoSave();
  } else if (btn.dataset.action === "duplicate") {
    const clone = JSON.parse(JSON.stringify(fieldConfigs[idx]));
    clone.key = `${clone.key}_copy_${Date.now()}`;
    clone.displayName = `${clone.displayName} (copy)`;
    fieldConfigs.splice(idx + 1, 0, clone);
    renderFieldList();
    renderPayloadForm();
    scheduleAutoSave();
    const newItem = document.getElementById("fieldList").children[idx + 1];
    if (newItem) {
      newItem.classList.add("field-highlight");
      newItem.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => newItem.classList.remove("field-highlight"), 2000);
    }
  } else if (btn.dataset.action === "delete") {
    if (confirm(`Remove field "${fieldConfigs[idx].displayName}"?`)) {
      fieldConfigs.splice(idx, 1);
      renderFieldList();
      renderPayloadForm();
      scheduleAutoSave();
    }
  }
}

function handleFieldChange(e) {
  const el = e.target;
  const idx = parseInt(el.dataset.idx, 10);
  const field = el.dataset.field;
  if (isNaN(idx) || !field) return;

  if (field === "labelMatch") {
    fieldConfigs[idx].labelMatch = el.value.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (field === "enabled") {
    fieldConfigs[idx].enabled = el.checked;
    const fieldItem = el.closest(".field-item");
    if (fieldItem) fieldItem.classList.toggle("disabled-field", !el.checked);
  } else if (field === "ajaxWait") {
    let val = parseInt(el.value, 10) || 1500;
    if (val > 60000) { val = 60000; el.value = 60000; }
    if (val < 500) { val = 500; el.value = 500; }
    fieldConfigs[idx].ajaxWait = val;
  } else if (field === "dropdownRetries") {
    fieldConfigs[idx].dropdownRetries = parseInt(el.value, 10) || 15;
  } else if (field === "fieldType") {
    fieldConfigs[idx].fieldType = el.value;
    renderFieldList();
    renderPayloadForm();
  } else if (field === "buttonWait") {
    fieldConfigs[idx].buttonWait = el.value;
    const item = el.closest(".field-item");
    if (item) {
      const waitMsField = item.querySelector("[data-field='buttonWaitMs']");
      if (waitMsField) {
        waitMsField.closest(".button-wait-field").style.display = el.value === "fixed_wait" ? "" : "none";
      }
    }
  } else if (field === "buttonWaitMs") {
    let val = parseInt(el.value, 10) || 3000;
    if (val > 60000) { val = 60000; el.value = 60000; }
    if (val < 500) { val = 500; el.value = 500; }
    fieldConfigs[idx].buttonWaitMs = val;
  } else if (field === "dialogType") {
    fieldConfigs[idx].dialogType = el.value;
    renderFieldList();
  } else if (field === "dialogReturnValue") {
    fieldConfigs[idx].dialogReturnValue = el.value === "true";
  } else if (field === "promptReturnValue") {
    fieldConfigs[idx].promptReturnValue = el.value;
  } else {
    const oldKey = fieldConfigs[idx][field];
    fieldConfigs[idx][field] = el.value;
    // If the key changed, migrate the payload value
    if (field === "key" && oldKey !== el.value) {
      if (payloadValues[oldKey] !== undefined) {
        payloadValues[el.value] = payloadValues[oldKey];
        delete payloadValues[oldKey];
      }
      renderPayloadForm();
    }
    if (field === "displayName") {
      renderPayloadForm();
    }
  }

  scheduleAutoSave();
}

function addField() {
  const overlay = document.createElement("div");
  overlay.className = "field-type-picker-overlay";
  overlay.innerHTML = `
    <div class="field-type-picker">
      <h3>Select Field Type</h3>
      <div class="field-type-picker-grid">
        <button data-type="typeahead" class="picker-btn picker-typeahead">Typeahead</button>
        <button data-type="text" class="picker-btn picker-text">Text</button>
        <button data-type="choice" class="picker-btn picker-choice">Choice</button>
        <button data-type="button" class="picker-btn picker-button">Button</button>
        <button data-type="expand" class="picker-btn picker-expand">Expand</button>
        <button data-type="dialog" class="picker-btn picker-dialog">Dialog</button>
      </div>
      <button class="btn btn-sm btn-muted picker-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".picker-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll(".picker-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const base = { key: `field_${Date.now()}`, displayName: "New Field", enabled: true };
      if (type === "button" || type === "expand") {
        Object.assign(base, { fieldType: type, buttonWait: "smart_wait" });
      } else if (type === "dialog") {
        Object.assign(base, { fieldType: type, dialogType: "alert" });
      } else {
        Object.assign(base, { fieldType: type, labelMatch: [], ajaxWait: 1500, dropdownRetries: 15 });
      }
      fieldConfigs.push(base);
      renderFieldList();
      renderPayloadForm();
      scheduleAutoSave();
      overlay.remove();
    });
  });
}

function resetFields() {
  if (confirm("Reset field configuration to defaults?")) {
    fieldConfigs = JSON.parse(JSON.stringify(DEFAULT_FIELD_CONFIGS));
    renderFieldList();
    renderPayloadForm();
    scheduleAutoSave();
  }
}

function exportPayload() {
  const payload = readPayloadFromForm();
  const enabledConfigs = fieldConfigs.filter((f) => f.enabled !== false);
  const exportData = { configuration: enabledConfigs, data: [payload] };
  const name = document.getElementById("templateNameInput").value.trim() || "payload";
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/\s+/g, "-").toLowerCase() + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Auto-save (debounced) ────────────────────────────────────────

function scheduleAutoSave() {
  if (activeTemplateId === null) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(autoSave, 800);
}

function autoSave() {
  if (activeTemplateId === null) return;
  const tpl = templates.find((t) => t.id === activeTemplateId);
  if (!tpl) return;

  const name = document.getElementById("templateNameInput").value.trim();
  if (name) tpl.name = name;
  tpl.payload = readPayloadFromForm();
  tpl.fieldConfigs = JSON.parse(JSON.stringify(fieldConfigs));

  persistTemplates();
  renderTemplateList();
  showToast("Auto-saved.");
}

// ── Persistence ──────────────────────────────────────────────────

function persistTemplates() {
  chrome.storage.sync.set({ [STORAGE_KEYS.TEMPLATES]: templates });
}

function persistFlows() {
  chrome.storage.sync.set({ [STORAGE_KEYS.FLOWS]: flows });
}

function persistDomain() {
  const domain = document.getElementById("domain").value.trim();
  chrome.storage.sync.set({ [STORAGE_KEYS.DOMAIN]: domain });
}

// ── Flow sidebar ─────────────────────────────────────────────────

function renderFlowList() {
  const container = document.getElementById("flowList");
  container.innerHTML = "";

  if (flows.length === 0) {
    container.innerHTML = '<div class="template-list-empty">No flows yet.<br>Click <strong>+ New</strong> to create one.</div>';
    return;
  }

  flows.forEach((flow, idx) => {
    const tplCount = (flow.templateIds || []).length;
    const isActive = activeFlowId === flow.id;

    const item = document.createElement("div");
    item.className = "tpl-item" + (isActive ? " active" : "");
    item.dataset.flowIdx = idx;
    const keyHtml = flow.key ? `<span class="tpl-item-key" title="${esc(flow.key)}">${esc(flow.key)}</span>` : "";
    item.innerHTML = `
      <div class="tpl-item-info">
        <span class="tpl-item-name">${esc(flow.name)}</span>
        <span class="tpl-item-meta">${tplCount} template(s)</span>
        ${keyHtml}
      </div>
    `;
    container.appendChild(item);
  });
}

function handleFlowSidebarClick(e) {
  const item = e.target.closest(".tpl-item");
  if (item && item.dataset.flowIdx !== undefined) {
    const idx = parseInt(item.dataset.flowIdx, 10);
    loadFlow(flows[idx]);
  }
}

// ── Flow editor ──────────────────────────────────────────────────

function startNewFlow() {
  activeFlowId = null;
  activeTemplateId = null;
  flowTemplateIds = [];

  document.getElementById("flowNameInput").value = "";
  const keyEl = document.getElementById("flowKeyDisplay");
  keyEl.textContent = "";
  keyEl.classList.add("hidden");
  document.getElementById("flowStartUrl").value = "";
  document.getElementById("flowAlwaysNavigate").checked = true;
  document.getElementById("flowOnError").value = "stop";
  document.getElementById("flowRetryFallback").value = "skip";
  document.getElementById("retryFallbackGroup").classList.add("hidden");
  renderFlowTemplateList();
  renderTemplateList();
  renderFlowList();
  showFlowEditor();

  document.getElementById("flowNameInput").focus();
}

function loadFlow(flow) {
  activeFlowId = flow.id;
  activeTemplateId = null;
  flowTemplateIds = [...(flow.templateIds || [])];

  document.getElementById("flowNameInput").value = flow.name || "";
  const keyEl = document.getElementById("flowKeyDisplay");
  if (flow.key) {
    keyEl.textContent = flow.key;
    keyEl.classList.remove("hidden");
  } else {
    keyEl.textContent = "";
    keyEl.classList.add("hidden");
  }
  document.getElementById("flowStartUrl").value = flow.startUrl || "";
  document.getElementById("flowAlwaysNavigate").checked = flow.alwaysNavigate !== false;
  document.getElementById("flowOnError").value = flow.onError || "stop";
  document.getElementById("flowRetryFallback").value = flow.retryFallback || "skip";
  document.getElementById("retryFallbackGroup").classList.toggle("hidden", (flow.onError || "stop") !== "retry");
  renderFlowTemplateList();
  renderTemplateList();
  renderFlowList();
  showFlowEditor();
}

function handleSaveFlow() {
  const name = document.getElementById("flowNameInput").value.trim();
  if (!name) { alert("Enter a flow name."); document.getElementById("flowNameInput").focus(); return; }

  const onError = document.getElementById("flowOnError").value;
  const newFlow = {
    id: "flow_" + Date.now(),
    key: generateKey(name),
    name,
    templateIds: [...flowTemplateIds],
    startUrl: document.getElementById("flowStartUrl").value.trim(),
    alwaysNavigate: document.getElementById("flowAlwaysNavigate").checked,
    onError,
    retryFallback: onError === "retry" ? document.getElementById("flowRetryFallback").value : undefined,
  };

  flows.push(newFlow);
  activeFlowId = newFlow.id;
  persistFlows();
  renderFlowList();
  updateActionButtons();
  showToast(`Flow "${name}" saved.`);
}

function handleUpdateFlow() {
  const flow = flows.find((f) => f.id === activeFlowId);
  if (!flow) return;

  const name = document.getElementById("flowNameInput").value.trim();
  if (!name) { alert("Flow name cannot be empty."); return; }

  const onError = document.getElementById("flowOnError").value;
  flow.name = name;
  flow.templateIds = [...flowTemplateIds];
  flow.startUrl = document.getElementById("flowStartUrl").value.trim();
  flow.alwaysNavigate = document.getElementById("flowAlwaysNavigate").checked;
  flow.onError = onError;
  flow.retryFallback = onError === "retry" ? document.getElementById("flowRetryFallback").value : undefined;

  persistFlows();
  renderFlowList();
  showToast(`Flow "${name}" updated.`);
}

function handleDeleteFlow() {
  const flow = flows.find((f) => f.id === activeFlowId);
  if (!flow) return;
  if (!confirm(`Delete flow "${flow.name}"?`)) return;

  flows = flows.filter((f) => f.id !== activeFlowId);
  activeFlowId = null;
  persistFlows();
  renderFlowList();
  showEmptyState();
  showToast("Flow deleted.");
}

function exportFlow() {
  const startUrl = document.getElementById("flowStartUrl").value.trim();
  const mergedConfigs = [];

  for (const tplId of flowTemplateIds) {
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl && tpl.fieldConfigs) {
      const enabled = tpl.fieldConfigs.filter((f) => f.enabled !== false);
      mergedConfigs.push(...enabled);
    }
  }

  // Build a placeholder data item with only user-input fields (skip button/expand actions)
  const placeholder = {};
  for (const cfg of mergedConfigs) {
    if (cfg.fieldType === "button" || cfg.fieldType === "expand") continue;
    placeholder[cfg.key] = cfg.defaultValue || "";
  }

  const onError = document.getElementById("flowOnError").value;
  const exportData = {
    configuration: mergedConfigs,
    startUrl: startUrl || undefined,
    alwaysNavigate: document.getElementById("flowAlwaysNavigate").checked,
    onError,
    retryFallback: onError === "retry" ? document.getElementById("flowRetryFallback").value : undefined,
    data: [placeholder],
  };

  const name = document.getElementById("flowNameInput").value.trim() || "flow";
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/\s+/g, "-").toLowerCase() + "-flow.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Flow JSON exported.");
}

// ── Flow template list rendering ─────────────────────────────────

function renderFlowTemplateList() {
  const container = document.getElementById("flowTemplateList");
  const emptyMsg = document.getElementById("flowTemplateEmpty");
  container.innerHTML = "";

  if (flowTemplateIds.length === 0) {
    container.classList.add("hidden");
    emptyMsg.classList.remove("hidden");
    return;
  }

  container.classList.remove("hidden");
  emptyMsg.classList.add("hidden");

  flowTemplateIds.forEach((tplId, idx) => {
    const tpl = templates.find((t) => t.id === tplId);
    const name = tpl ? tpl.name : "(deleted template)";
    const fieldCount = tpl ? (tpl.fieldConfigs || []).length : 0;

    const item = document.createElement("div");
    item.className = "flow-tpl-item";
    const nameHtml = tpl
      ? `<a href="#" class="flow-tpl-link" data-tpl-id="${tplId}" title="Open template definition">${esc(name)}</a>`
      : `<span class="flow-tpl-deleted">${esc(name)}</span>`;

    item.innerHTML = `
      <div class="flow-tpl-arrows">
        <button data-flow-dir="up" data-flow-idx="${idx}" title="Move up">&uarr;</button>
        <button data-flow-dir="down" data-flow-idx="${idx}" title="Move down">&darr;</button>
      </div>
      <span class="flow-tpl-name">${nameHtml}</span>
      <span class="flow-tpl-meta">${fieldCount} field(s)</span>
      <button class="btn btn-sm btn-danger" data-flow-action="remove" data-flow-idx="${idx}">Remove</button>
    `;
    container.appendChild(item);
  });
}

function handleFlowTemplateAction(e) {
  const link = e.target.closest(".flow-tpl-link");
  if (link) {
    e.preventDefault();
    const tplId = link.dataset.tplId;
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl) loadTemplate(tpl);
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;
  const idx = parseInt(btn.dataset.flowIdx, 10);
  if (isNaN(idx)) return;

  if (btn.dataset.flowDir === "up" && idx > 0) {
    [flowTemplateIds[idx - 1], flowTemplateIds[idx]] = [flowTemplateIds[idx], flowTemplateIds[idx - 1]];
    renderFlowTemplateList();
    scheduleFlowAutoSave();
  } else if (btn.dataset.flowDir === "down" && idx < flowTemplateIds.length - 1) {
    [flowTemplateIds[idx], flowTemplateIds[idx + 1]] = [flowTemplateIds[idx + 1], flowTemplateIds[idx]];
    renderFlowTemplateList();
    scheduleFlowAutoSave();
  } else if (btn.dataset.flowAction === "remove") {
    flowTemplateIds.splice(idx, 1);
    renderFlowTemplateList();
    scheduleFlowAutoSave();
  }
}

function addFlowTemplate() {
  if (templates.length === 0) {
    alert("No templates available. Create a template first.");
    return;
  }

  const options = templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  const dialog = document.createElement("div");
  dialog.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:200;";
  dialog.innerHTML = `
    <div style="background:#fff;border-radius:10px;padding:24px;min-width:320px;box-shadow:0 8px 30px rgba(0,0,0,0.2);">
      <h3 style="margin-bottom:12px;font-size:15px;">Add Template to Flow</h3>
      <select id="flowTplPicker" style="width:100%;padding:8px 10px;font-size:14px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:16px;">
        ${options}
      </select>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="flowTplCancel" class="btn btn-sm">Cancel</button>
        <button id="flowTplAdd" class="btn btn-primary btn-sm">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelector("#flowTplCancel").addEventListener("click", () => dialog.remove());
  dialog.querySelector("#flowTplAdd").addEventListener("click", () => {
    const selected = dialog.querySelector("#flowTplPicker").value;
    if (selected) {
      flowTemplateIds.push(selected);
      renderFlowTemplateList();
      scheduleFlowAutoSave();
    }
    dialog.remove();
  });
}

// ── Flow auto-save ───────────────────────────────────────────────

let _flowAutoSaveTimer = null;

function scheduleFlowAutoSave() {
  if (activeFlowId === null) return;
  clearTimeout(_flowAutoSaveTimer);
  _flowAutoSaveTimer = setTimeout(autoSaveFlow, 800);
}

function autoSaveFlow() {
  if (activeFlowId === null) return;
  const flow = flows.find((f) => f.id === activeFlowId);
  if (!flow) return;

  const name = document.getElementById("flowNameInput").value.trim();
  if (name) flow.name = name;
  flow.templateIds = [...flowTemplateIds];
  flow.startUrl = document.getElementById("flowStartUrl").value.trim();
  flow.alwaysNavigate = document.getElementById("flowAlwaysNavigate").checked;
  const onError = document.getElementById("flowOnError").value;
  flow.onError = onError;
  flow.retryFallback = onError === "retry" ? document.getElementById("flowRetryFallback").value : undefined;

  persistFlows();
  renderFlowList();
  showToast("Flow auto-saved.");
}

// ── Share / Import handlers ───────────────────────────────────────

function handleShareTemplate() {
  const tpl = templates.find((t) => t.id === activeTemplateId);
  if (!tpl) return;
  const exportData = buildTemplateShareExport(tpl);
  const filename = slugify(tpl.name) + ".share-template.json";
  downloadJson(exportData, filename);
  showToast("Template shared.");
}

async function handleImportTemplate(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";

  const text = await file.text();
  let parsed;
  try {
    parsed = parseShareImport(text);
  } catch (err) {
    showToast(err.message);
    return;
  }

  if (parsed.exportType !== "template") {
    showToast('This is a flow export. Use "Import Flow" instead.');
    return;
  }

  const incoming = parsed.template;
  const dup = findDuplicateTemplate(incoming.key, incoming.name, templates);

  if (dup) {
    const choice = await showImportConflictModal(incoming.name, "template");
    if (choice === "cancel") return;
    if (choice === "replace") {
      dup.match.name = incoming.name;
      dup.match.key = incoming.key || dup.match.key;
      dup.match.fieldConfigs = JSON.parse(JSON.stringify(incoming.fieldConfigs));
      dup.match.payload = {};
      persistTemplates();
      loadTemplate(dup.match);
      showToast(`Template "${incoming.name}" replaced.`);
      return;
    }
  }

  const newName = dup ? copyName(incoming.name) : incoming.name;
  const newTpl = {
    id: "tpl_" + Date.now(),
    key: generateKey(newName),
    name: newName,
    payload: {},
    fieldConfigs: JSON.parse(JSON.stringify(incoming.fieldConfigs)),
  };
  templates.push(newTpl);
  persistTemplates();
  loadTemplate(newTpl);
  showToast(`Template "${newName}" imported.`);
}

function handleDataTemplate() {
  const tpl = templates.find((t) => t.id === activeTemplateId);
  if (!tpl) return;
  const enabledConfigs = (tpl.fieldConfigs || []).filter((f) => f.enabled !== false);
  const dataTemplate = buildDataTemplate(enabledConfigs, tpl.name, "template");
  const filename = slugify(tpl.name) + "-data-template.json";
  downloadJson(dataTemplate, filename);
  showToast("Data template downloaded.");
}

function handleShareFlow() {
  const flow = flows.find((f) => f.id === activeFlowId);
  if (!flow) return;

  const resolvedTemplates = (flow.templateIds || [])
    .map((id) => templates.find((t) => t.id === id))
    .filter(Boolean);

  const exportData = buildFlowShareExport(flow, resolvedTemplates);
  const filename = slugify(flow.name) + ".share-flow.json";
  downloadJson(exportData, filename);
  showToast("Flow shared.");
}

async function handleImportFlow(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";

  const text = await file.text();
  let parsed;
  try {
    parsed = parseShareImport(text);
  } catch (err) {
    showToast(err.message);
    return;
  }

  if (parsed.exportType !== "flow") {
    showToast('This is a template export. Use "Import Template" instead.');
    return;
  }

  const incomingFlow = parsed.flow;
  let flowAction = "new";
  let targetFlow = null;

  const flowDup = findDuplicateFlow(incomingFlow.key, incomingFlow.name, flows);
  if (flowDup) {
    const choice = await showImportConflictModal(incomingFlow.name, "flow");
    if (choice === "cancel") return;
    flowAction = choice;
    if (choice === "replace") targetFlow = flowDup.match;
  }

  const collectedTemplateIds = [];
  for (const tplData of parsed.templates) {
    const tplDup = findDuplicateTemplate(tplData.key, tplData.name, templates);

    if (tplDup) {
      const tplChoice = await showImportConflictModal(tplData.name, "template", { showAttach: true });
      if (tplChoice === "cancel") {
        showToast("Flow import cancelled.");
        return;
      }
      if (tplChoice === "replace") {
        tplDup.match.name = tplData.name;
        tplDup.match.key = tplData.key || tplDup.match.key;
        tplDup.match.fieldConfigs = JSON.parse(JSON.stringify(tplData.fieldConfigs));
        tplDup.match.payload = {};
        collectedTemplateIds.push(tplDup.match.id);
      } else if (tplChoice === "attach") {
        collectedTemplateIds.push(tplDup.match.id);
      } else {
        const newName = copyName(tplData.name);
        const newTpl = {
          id: "tpl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          key: generateKey(newName),
          name: newName,
          payload: {},
          fieldConfigs: JSON.parse(JSON.stringify(tplData.fieldConfigs)),
        };
        templates.push(newTpl);
        collectedTemplateIds.push(newTpl.id);
      }
    } else {
      const newTpl = {
        id: "tpl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        key: tplData.key || generateKey(tplData.name),
        name: tplData.name,
        payload: {},
        fieldConfigs: JSON.parse(JSON.stringify(tplData.fieldConfigs)),
      };
      templates.push(newTpl);
      collectedTemplateIds.push(newTpl.id);
    }
  }

  if (flowAction === "replace" && targetFlow) {
    targetFlow.name = incomingFlow.name;
    targetFlow.key = incomingFlow.key || targetFlow.key;
    targetFlow.startUrl = incomingFlow.startUrl || "";
    targetFlow.alwaysNavigate = incomingFlow.alwaysNavigate !== false;
    targetFlow.onError = incomingFlow.onError || "stop";
    targetFlow.retryFallback = incomingFlow.retryFallback;
    targetFlow.templateIds = collectedTemplateIds;
    persistTemplates();
    persistFlows();
    loadFlow(targetFlow);
    showToast(`Flow "${incomingFlow.name}" replaced with ${collectedTemplateIds.length} template(s).`);
  } else {
    const flowName = flowDup ? copyName(incomingFlow.name) : incomingFlow.name;
    const newFlow = {
      id: "flow_" + Date.now(),
      key: generateKey(flowName),
      name: flowName,
      templateIds: collectedTemplateIds,
      startUrl: incomingFlow.startUrl || "",
      alwaysNavigate: incomingFlow.alwaysNavigate !== false,
      onError: incomingFlow.onError || "stop",
      retryFallback: incomingFlow.retryFallback,
    };
    flows.push(newFlow);
    persistTemplates();
    persistFlows();
    loadFlow(newFlow);
    showToast(`Flow "${flowName}" imported with ${collectedTemplateIds.length} template(s).`);
  }
}

function handleFlowDataTemplate() {
  const flow = flows.find((f) => f.id === activeFlowId);
  if (!flow) return;

  const mergedConfigs = [];
  for (const tplId of (flow.templateIds || [])) {
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl && tpl.fieldConfigs) {
      const enabled = tpl.fieldConfigs.filter((f) => f.enabled !== false);
      mergedConfigs.push(...enabled);
    }
  }

  const dataTemplate = buildDataTemplate(mergedConfigs, flow.name, "flow");
  const filename = slugify(flow.name) + "-data-template.json";
  downloadJson(dataTemplate, filename);
  showToast("Data template downloaded.");
}

// ── Import conflict modal ────────────────────────────────────────

function showImportConflictModal(itemName, itemType, { showAttach = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("importConflictModal");
    const attachBtn = document.getElementById("conflictAttach");
    document.getElementById("conflictTitle").textContent = `Duplicate ${itemType} found`;
    document.getElementById("conflictMessage").textContent =
      `A ${itemType} named "${itemName}" already exists. What would you like to do?`;
    attachBtn.classList.toggle("hidden", !showAttach);
    modal.classList.remove("hidden");

    function cleanup(result) {
      modal.classList.add("hidden");
      attachBtn.classList.add("hidden");
      document.getElementById("conflictCreateNew").removeEventListener("click", onNew);
      document.getElementById("conflictReplace").removeEventListener("click", onReplace);
      attachBtn.removeEventListener("click", onAttach);
      document.getElementById("conflictCancel").removeEventListener("click", onCancel);
      modal.removeEventListener("click", onOverlay);
      resolve(result);
    }

    function onNew() { cleanup("new"); }
    function onReplace() { cleanup("replace"); }
    function onAttach() { cleanup("attach"); }
    function onCancel() { cleanup("cancel"); }
    function onOverlay(e) { if (e.target === modal) cleanup("cancel"); }

    document.getElementById("conflictCreateNew").addEventListener("click", onNew);
    document.getElementById("conflictReplace").addEventListener("click", onReplace);
    attachBtn.addEventListener("click", onAttach);
    document.getElementById("conflictCancel").addEventListener("click", onCancel);
    modal.addEventListener("click", onOverlay);
  });
}

// ── Utilities ────────────────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
