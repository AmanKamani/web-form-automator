(() => {
  // Remove previous listener if script is re-injected into the same page
  if (window.__snAutoFillListener) {
    chrome.runtime.onMessage.removeListener(window.__snAutoFillListener);
  }
  window.__snAutoFillAborted = false;

  const RETRY_INTERVAL = 600;
  const MAX_RETRIES = 25;
  const TYPING_DELAY = 60;
  const DROPDOWN_POLL = 400;
  const DEFAULT_AJAX_WAIT = 1500;
  const DEFAULT_DROPDOWN_RETRIES = 15;

  function checkAborted() {
    if (window.__snAutoFillAborted) throw new Error("STOPPED");
  }

  window.__snAutoFillListener = (msg, _sender, sendResponse) => {
    if (msg.type === "FILL_FORM") {
      window.__snAutoFillAborted = false;
      handleFillForm(msg.payload, msg.fieldConfigs)
        .then((result) => {
          chrome.runtime.sendMessage(result);
          sendResponse({ ok: true });
        })
        .catch((err) => {
          const stopped = err.message === "STOPPED";
          chrome.runtime.sendMessage({
            type: "AUTOMATION_RESULT",
            ok: false,
            stopped,
            error: stopped ? "Automation stopped by user." : err.message,
          });
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    if (msg.type === "STOP_AUTOMATION") {
      window.__snAutoFillAborted = true;
      reportStep("Stop requested — aborting after current step.", "step");
      sendResponse({ ok: true });
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(window.__snAutoFillListener);

  // ────────────────────────────────────────────────────────────────
  // Main orchestration
  // ────────────────────────────────────────────────────────────────

  async function handleFillForm(payload, fieldConfigs) {
    reportStep("Starting automation...", "step");
    reportStep(`Processing ${fieldConfigs.length} field(s) in configured order.`, "step");

    const usedElements = new Set();

    for (let i = 0; i < fieldConfigs.length; i++) {
      checkAborted();
      const cfg = fieldConfigs[i];
      const name = cfg.displayName || cfg.key;
      const value = payload[cfg.key] ?? cfg.defaultValue ?? undefined;

      // ── Expand field type — click a section toggle to reveal hidden fields ──
      if (cfg.fieldType === "expand") {
        const matchTexts = (cfg.labelMatch || []).map((m) => m.toLowerCase());
        if (matchTexts.length === 0) {
          reportStep(`Skipping expand "${name}" — no label match configured.`, "step");
          continue;
        }
        reportStep(`[${i + 1}/${fieldConfigs.length}] Expanding section "${name}"...`, "step");
        reportStep(`  Looking for text: ${JSON.stringify(matchTexts)}`);

        const trigger = await waitForExpandTrigger(matchTexts);
        const ariaExpanded = trigger.getAttribute("aria-expanded");
        reportStep(`  Found: <${trigger.tagName.toLowerCase()}> class="${(trigger.className || "").substring(0, 80)}" aria-expanded="${ariaExpanded}"`);

        if (ariaExpanded === "true") {
          reportStep(`  Section already expanded — skipping click.`, "step");
        } else {
          simulateClick(trigger);
          reportStep(`  Clicked expand trigger.`);
        }

        const waitMode = cfg.buttonWait || "smart_wait";
        if (waitMode === "no_wait") {
          await sleep(300);
        } else if (waitMode === "fixed_wait") {
          const ms = cfg.buttonWaitMs || 3000;
          reportStep(`  Fixed wait: ${ms}ms...`);
          await sleep(ms);
        } else if (waitMode === "url_change") {
          const urlBefore = window.location.href;
          reportStep(`  Waiting for URL to change...`);
          await waitForUrlChange(urlBefore, 30000);
        } else {
          const nextCfg = fieldConfigs[i + 1];
          if (nextCfg && nextCfg.labelMatch && nextCfg.labelMatch.length > 0) {
            reportStep(`  Smart wait: waiting for label "${nextCfg.labelMatch[0]}"...`);
            await waitForLabel(nextCfg.labelMatch, 30000);
            reportStep(`  Next field label found.`);
          } else if (nextCfg && nextCfg.fieldType === "button") {
            const nextBtnText = nextCfg.displayName || nextCfg.key;
            reportStep(`  Smart wait: waiting for button "${nextBtnText}"...`);
            await waitForButton(nextBtnText, 50);
          } else {
            await sleep(2000);
          }
        }
        continue;
      }

      // ── Button field type — find and click a button by its text ──
      if (cfg.fieldType === "button") {
        const btnText = cfg.displayName || cfg.key;
        if (!btnText) {
          reportStep(`Skipping button "${name}" — no button text specified.`, "step");
          continue;
        }
        reportStep(`[${i + 1}/${fieldConfigs.length}] Clicking button "${btnText}"...`, "step");

        const waitMode = cfg.buttonWait || "smart_wait";
        const urlBefore = window.location.href;

        const btn = await waitForButton(btnText);
        simulateClick(btn);
        reportStep(`  Clicked button "${btnText}".`);

        if (waitMode === "no_wait") {
          await sleep(300);
        } else if (waitMode === "fixed_wait") {
          const ms = cfg.buttonWaitMs || 3000;
          reportStep(`  Fixed wait: ${ms}ms...`);
          await sleep(ms);
        } else if (waitMode === "url_change") {
          reportStep(`  Waiting for URL to change...`);
          await waitForUrlChange(urlBefore, 30000);
          reportStep(`  URL changed.`);
        } else {
          // smart_wait: wait for next field's label or button text to appear
          const nextCfg = fieldConfigs[i + 1];
          if (nextCfg) {
            if (nextCfg.fieldType === "button") {
              const nextBtnText = nextCfg.displayName || nextCfg.key;
              reportStep(`  Smart wait: waiting for button "${nextBtnText}"...`);
              await waitForButton(nextBtnText, 50);
              reportStep(`  Next button found.`);
            } else if (nextCfg.labelMatch && nextCfg.labelMatch.length > 0) {
              reportStep(`  Smart wait: waiting for label "${nextCfg.labelMatch[0]}"...`);
              await waitForLabel(nextCfg.labelMatch, 30000);
              reportStep(`  Next field label found.`);
            } else {
              await sleep(2000);
            }
          } else {
            await sleep(1000);
          }
        }
        continue;
      }

      if (value === null || value === undefined || value === "") {
        reportStep(`Skipping "${name}" — no value in payload for key "${cfg.key}".`, "step");
        continue;
      }

      reportStep(`[${i + 1}/${fieldConfigs.length}] Processing "${name}" (${cfg.fieldType})...`, "step");

      const ajaxWait = cfg.ajaxWait || DEFAULT_AJAX_WAIT;
      const retries = cfg.dropdownRetries || DEFAULT_DROPDOWN_RETRIES;

      const found = await waitForFieldByCfg(cfg, usedElements);
      const el = found.el;
      const s2Container = found.select2Container;
      usedElements.add(el);

      const isSelect2 = el.classList.contains("select2-offscreen");
      const tagInfo = `<${el.tagName.toLowerCase()}#${el.id || el.name || "?"}>`;
      reportStep(`  Found ${tagInfo} ${isSelect2 ? "(Select2)" : ""}`);

      if (el.tagName === "SELECT" && isSelect2) {
        await fillSelect2Choice(el, s2Container, String(value), name);
        reportStep(`  Select2 choice set: "${value}"`);
      }
      else if (isSelect2 && s2Container) {
        if (Array.isArray(value)) {
          for (const item of value) {
            await fillSelect2Typeahead(s2Container, el, item, name, ajaxWait, retries);
            reportStep(`  Select2 typeahead selected: "${item}"`);
            await sleep(600);
          }
        } else {
          await fillSelect2Typeahead(s2Container, el, String(value), name, ajaxWait, retries);
          reportStep(`  Select2 typeahead selected: "${value}"`);
        }
      }
      else if (cfg.fieldType === "typeahead") {
        if (Array.isArray(value)) {
          for (const item of value) {
            await fillTypeahead(el, item, name, ajaxWait, retries);
            reportStep(`  Typeahead selected: "${item}"`);
            await sleep(600);
          }
        } else {
          await fillTypeahead(el, String(value), name, ajaxWait, retries);
          reportStep(`  Typeahead selected: "${value}"`);
        }
      }
      else if (el.tagName === "SELECT") {
        await fillNativeSelect(el, String(value), name);
        reportStep(`  Native select set: "${value}"`);
      }
      else {
        await fillPlainText(el, String(value));
        reportStep(`  Text filled.`);
      }

      await sleep(800);
    }

    reportStep("Automation complete — all fields processed.", "step");
    return { type: "AUTOMATION_RESULT", ok: true, message: "All fields processed successfully." };
  }

  // ────────────────────────────────────────────────────────────────
  // Field finder
  // ────────────────────────────────────────────────────────────────

  function waitForFieldByCfg(cfg, excludeEls) {
    const name = cfg.displayName || cfg.key;
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const check = () => {
        const result = findFieldByCfg(cfg, excludeEls);
        if (result) return resolve(result);
        attempt++;
        if (attempt >= MAX_RETRIES) {
          reject(new Error(
            `Could not find field "${name}" after ${MAX_RETRIES} retries.\n` +
            `  labelMatch: ${JSON.stringify(cfg.labelMatch)}\n` +
            `Verify the label text in Options matches the text on the SN page.`
          ));
          return;
        }
        setTimeout(check, RETRY_INTERVAL);
      };
      check();
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Select2 choice dropdown (hidden <select>)
  // ────────────────────────────────────────────────────────────────

  async function fillSelect2Choice(selectEl, s2Container, value, fieldName) {
    const normalised = value.toLowerCase().trim();

    // Strategy 1: Open the Select2 dropdown via UI and click the option
    if (s2Container) {
      const choiceLink = s2Container.querySelector(".select2-choice");
      if (choiceLink) {
        simulateClick(choiceLink);
        await sleep(500);

        // The dropdown appears as .select2-drop-active with .select2-results
        const picked = await pickSelect2ChoiceResult(normalised, 10);
        if (picked) { await sleep(300); return; }
      }
    }

    // Strategy 2: Open via jQuery Select2 API
    try {
      const $ = window.jQuery || window.$;
      if ($) {
        $(selectEl).select2("open");
        await sleep(500);
        const picked = await pickSelect2ChoiceResult(normalised, 10);
        if (picked) { await sleep(300); return; }
      }
    } catch (_) {}

    // Strategy 3: Set hidden <select> value directly
    let matchedValue = null;
    for (const opt of selectEl.options) {
      const label = opt.textContent.toLowerCase().trim();
      const val = opt.value.toLowerCase().trim();
      if (label === normalised || val === normalised || label.includes(normalised) || normalised.includes(label)) {
        matchedValue = opt.value;
        break;
      }
    }

    if (matchedValue === null) {
      const available = Array.from(selectEl.options).map((o) => `"${o.textContent.trim()}"`).join(", ");
      throw new Error(`No option matches "${value}" in "${fieldName}". Available: ${available}`);
    }

    try {
      const $ = window.jQuery || window.$;
      if ($ && $(selectEl).select2) {
        $(selectEl).select2("val", matchedValue);
        $(selectEl).trigger("change");
        await sleep(300);
        return;
      }
    } catch (_) {}

    selectEl.value = matchedValue;
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    try { if (typeof angular !== "undefined") angular.element(selectEl).triggerHandler("change"); } catch (_) {}
    await sleep(300);
  }

  async function pickSelect2ChoiceResult(normalised, retries) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const items = document.querySelectorAll(
        ".select2-drop-active .select2-results .select2-result-selectable, " +
        ".select2-drop-active .select2-results li"
      );
      for (const item of items) {
        const text = item.textContent.toLowerCase().trim();
        if (text.includes(normalised) || normalised.includes(text)) {
          simulateClick(item);
          await sleep(200);
          return true;
        }
      }
      await sleep(DROPDOWN_POLL);
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────
  // Select2 typeahead (hidden <input> with Select2 search)
  // ────────────────────────────────────────────────────────────────

  async function fillSelect2Typeahead(s2Container, hiddenEl, value, fieldName, ajaxWait, retries) {
    // Find the Select2 search input inside the container
    let searchInput = s2Container.querySelector("input.select2-input");
    if (!searchInput) {
      // For single-select Select2, need to open dropdown first
      const choice = s2Container.querySelector(".select2-choice, .select2-choices");
      if (choice) {
        choice.click();
        await sleep(400);
      }
      // The search input appears in the dropdown (appended to body)
      const dropdownId = hiddenEl.id ? `select2-drop` : null;
      searchInput = document.querySelector(".select2-drop-active input.select2-input");
    }

    if (!searchInput) {
      // Last resort: open via Select2 API
      try {
        const $ = window.jQuery || window.$;
        if ($) {
          $(hiddenEl).select2("open");
          await sleep(400);
          searchInput = document.querySelector(".select2-drop-active input.select2-input");
        }
      } catch (_) {}
    }

    if (!searchInput) {
      throw new Error(`Could not find Select2 search input for "${fieldName}".`);
    }

    // Clear and type into the Select2 search input
    searchInput.focus();
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(100);

    // Type character by character
    for (const char of value) {
      document.execCommand("insertText", false, char);
      await sleep(TYPING_DELAY);
    }

    reportStep(`  Typed "${value}" in Select2 search, waiting ${ajaxWait}ms...`);
    await sleep(ajaxWait);

    // Look for results in the Select2 dropdown
    const picked = await pickSelect2Result(value, retries);
    if (!picked) {
      reportStep(`  Warn: no Select2 result for "${value}", pressing Enter.`, "step");
      pressKey(searchInput, "Enter");
      await sleep(500);
    }

    await sleep(500);
  }

  async function pickSelect2Result(value, retries) {
    const normalised = value.toLowerCase().trim();

    for (let attempt = 0; attempt < retries; attempt++) {
      // Select2 results appear in .select2-results inside .select2-drop-active
      const resultItems = document.querySelectorAll(
        ".select2-drop-active .select2-results li.select2-result, " +
        ".select2-drop-active .select2-results .select2-result-selectable"
      );

      if (resultItems.length > 0) {
        // Find best text match
        for (const item of resultItems) {
          const text = item.textContent.toLowerCase().trim();
          if (text.includes(normalised) || normalised.includes(text)) {
            item.click();
            simulateClick(item);
            await sleep(300);
            return true;
          }
        }
        // If only one result, click it
        if (resultItems.length === 1) {
          resultItems[0].click();
          simulateClick(resultItems[0]);
          await sleep(300);
          return true;
        }
      }

      // Also check for generic dropdown items
      const genericItems = document.querySelectorAll(
        ".select2-drop-active li, " +
        "[role='listbox'] [role='option']"
      );
      for (const item of genericItems) {
        const text = item.textContent.toLowerCase().trim();
        if (text.includes(normalised)) {
          simulateClick(item);
          await sleep(300);
          return true;
        }
      }

      await sleep(DROPDOWN_POLL);
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────
  // Plain typeahead (non-Select2 inputs)
  // ────────────────────────────────────────────────────────────────

  async function fillTypeahead(el, value, fieldName, ajaxWait, retries) {
    await clearField(el);
    await sleep(300);

    const domBefore = new Set(document.querySelectorAll("*"));
    el.focus();
    el.click();
    await sleep(100);

    for (const char of value) {
      document.execCommand("insertText", false, char);
      await sleep(TYPING_DELAY);
    }

    reportStep(`  Typed "${value}", waiting ${ajaxWait}ms...`);
    await sleep(ajaxWait);

    const picked = await pickFromDropdown(value, domBefore, retries);
    if (!picked) {
      reportStep(`  Warn: no dropdown match, pressing Enter.`, "step");
      pressKey(el, "Enter");
      await sleep(800);
    }

    await sleep(500);
  }

  async function pickFromDropdown(value, domBefore, retries) {
    const normalised = value.toLowerCase().trim();

    for (let attempt = 0; attempt < retries; attempt++) {
      // New elements that appeared after typing
      const newItems = [];
      const allNow = document.querySelectorAll("li, tr, a, td, div[role='option'], [role='option'], [role='menuitem']");
      for (const el of allNow) {
        if (!domBefore.has(el) && _isVisibleCS(el)) {
          const text = el.textContent.trim();
          if (text.length > 0 && text.length < 500) newItems.push(el);
        }
      }

      if (newItems.length > 0) {
        for (const item of newItems) {
          const text = item.textContent.toLowerCase().trim();
          if (text.includes(normalised) || normalised.includes(text)) {
            simulateClick(item);
            await sleep(500);
            return true;
          }
        }
        if (newItems.length <= 3) {
          simulateClick(newItems[0]);
          await sleep(500);
          return true;
        }
      }

      await sleep(DROPDOWN_POLL);
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────────
  // Native <select> and plain text
  // ────────────────────────────────────────────────────────────────

  async function fillNativeSelect(el, value, fieldName) {
    const normalised = value.toLowerCase().trim();
    for (const opt of el.options) {
      if (opt.textContent.toLowerCase().trim().includes(normalised) || opt.value.toLowerCase() === normalised) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(200);
        return;
      }
    }
    throw new Error(`No option matches "${value}" in "${fieldName}".`);
  }

  async function fillPlainText(el, value) {
    await clearField(el);
    el.focus();
    el.click();
    await sleep(100);
    document.execCommand("insertText", false, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(100);
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ────────────────────────────────────────────────────────────────
  // Utilities
  // ────────────────────────────────────────────────────────────────

  async function clearField(el) {
    el.focus(); el.click(); await sleep(50);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true, metaKey: true, bubbles: true }));
    document.execCommand("selectAll");
    document.execCommand("delete");
    await sleep(50);
    if ("value" in el) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      if (setter) setter.call(el, ""); else el.value = "";
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function simulateClick(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    el.click();
  }

  function pressKey(el, key) {
    const opts = { key, code: key, keyCode: key === "Enter" ? 13 : 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (window.__snAutoFillAborted) return reject(new Error("STOPPED"));
        resolve();
      };
      if (ms <= 200) return setTimeout(check, ms);
      // For longer sleeps, poll every 200ms so stop is responsive
      let elapsed = 0;
      const tick = () => {
        if (window.__snAutoFillAborted) return reject(new Error("STOPPED"));
        elapsed += 200;
        if (elapsed >= ms) return resolve();
        setTimeout(tick, 200);
      };
      setTimeout(tick, 200);
    });
  }

  function _isVisibleCS(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  // ────────────────────────────────────────────────────────────────
  // Button finder
  // ────────────────────────────────────────────────────────────────

  function waitForButton(text, retries = MAX_RETRIES) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const check = () => {
        const buttons = document.querySelectorAll("button, input[type='submit'], a.btn, a.button, [role='button']");
        for (const btn of buttons) {
          const t = (btn.textContent || btn.value || "").trim();
          if (t.toLowerCase() === text.toLowerCase()) return resolve(btn);
        }
        for (const btn of buttons) {
          const t = (btn.textContent || btn.value || "").trim();
          if (t.toLowerCase().includes(text.toLowerCase())) return resolve(btn);
        }
        attempt++;
        if (attempt >= retries) { reject(new Error(`Button "${text}" not found.`)); return; }
        setTimeout(check, RETRY_INTERVAL);
      };
      check();
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Expand trigger finder — finds element by label match text, then
  // walks up to the nearest clickable parent and clicks that.
  // ────────────────────────────────────────────────────────────────

  function waitForExpandTrigger(matchTexts, retries = MAX_RETRIES) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const check = () => {
        if (window.__snAutoFillAborted) return reject(new Error("STOPPED"));

        const result = findExpandTrigger(matchTexts);
        if (result) return resolve(result);

        attempt++;
        if (attempt >= retries) {
          reject(new Error(
            `Expand trigger not found for matches: ${JSON.stringify(matchTexts)}.\n` +
            `Verify the label text in Options matches visible text on the SN page.`
          ));
          return;
        }
        setTimeout(check, RETRY_INTERVAL);
      };
      check();
    });
  }

  function findExpandTrigger(matchTexts) {
    // Step 1: Find the deepest element whose text content matches
    // Search ALL matching text nodes, not just the first one
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const candidates = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.toLowerCase().trim();
      if (!text) continue;
      for (const match of matchTexts) {
        if (text.includes(match)) {
          const parentEl = walker.currentNode.parentElement;
          if (parentEl && _isVisibleCS(parentEl)) {
            candidates.push(parentEl);
          }
          break;
        }
      }
    }

    if (candidates.length === 0) return null;

    // Step 2: For each candidate, walk up to the nearest clickable parent
    for (const matchedNode of candidates) {
      let el = matchedNode;
      for (let depth = 0; depth < 15; depth++) {
        if (!el || el === document.body) break;
        const clickable =
          el.tagName === "A" ||
          el.tagName === "BUTTON" ||
          el.tagName === "SUMMARY" ||
          el.getAttribute("role") === "button" ||
          el.hasAttribute("data-toggle") ||
          el.hasAttribute("aria-expanded") ||
          el.style.cursor === "pointer" ||
          window.getComputedStyle(el).cursor === "pointer" ||
          el.getAttribute("tabindex") !== null;
        if (clickable) {
          console.log("[SN Expand] Found clickable:", el.tagName, el.className?.substring(0, 80), "for match:", matchTexts);
          return el;
        }
        el = el.parentElement;
      }
    }

    // Fallback: return the first matched element itself
    console.log("[SN Expand] No clickable parent found, using fallback:", candidates[0].tagName, candidates[0].textContent?.substring(0, 80));
    return candidates[0];
  }

  function waitForUrlChange(originalUrl, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (window.__snAutoFillAborted) return reject(new Error("STOPPED"));
        if (window.location.href !== originalUrl) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(check, 300);
      };
      setTimeout(check, 500);
    });
  }

  function waitForLabel(labelMatches, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (window.__snAutoFillAborted) return reject(new Error("STOPPED"));
        const labels = document.querySelectorAll("label");
        for (const label of labels) {
          const text = label.textContent.toLowerCase().trim();
          for (const match of labelMatches) {
            if (text.includes(match.toLowerCase())) return resolve();
          }
        }
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(check, 500);
      };
      setTimeout(check, 500);
    });
  }

  function reportStep(msg, level) {
    console.log("[SN Group Join]", msg);
    try { chrome.runtime.sendMessage({ type: "STEP_LOG", text: msg, level: level || "debug" }); } catch (_) {}
  }
})();
