/**
 * Label-based field finder for web forms.
 *
 * Strategy: match visible label text → read its for= attribute → getElementById.
 * For Select2-wrapped fields (class select2-offscreen), also locate the
 * Select2 container for UI interaction.
 */

/**
 * @param {Object} cfg  - { labelMatch: string[] }
 * @param {Set} [excludeEls] - elements to skip
 * @returns {{ el: HTMLElement, select2Container: HTMLElement|null } | null}
 */
function findFieldByCfg(cfg, excludeEls) {
  const exclude = excludeEls || new Set();
  const matchTexts = (cfg.labelMatch || []).map((m) => m.toLowerCase());
  if (matchTexts.length === 0) return null;

  const labels = document.querySelectorAll("label[for]");

  for (const label of labels) {
    const text = label.textContent.trim().toLowerCase();
    const matched = matchTexts.some((m) => text.includes(m));
    if (!matched) continue;

    const targetId = label.getAttribute("for");
    if (!targetId) continue;

    const el = document.getElementById(targetId);
    if (!el || exclude.has(el)) continue;

    console.log("[Selector] Matched label →", targetId, `<${el.tagName.toLowerCase()}>`, el.className.substring(0, 50));

    // Check if this is a Select2-wrapped element
    const isSelect2 = el.classList.contains("select2-offscreen");
    let select2Container = null;

    if (isSelect2) {
      // Select2 container ID is "s2id_" + original element ID
      select2Container = document.getElementById("s2id_" + targetId);
      console.log("[Selector] Select2 container:", select2Container ? "found" : "not found");
    }

    return { el, select2Container };
  }

  return null;
}
