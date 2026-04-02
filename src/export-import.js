/**
 * Export/Import share system for templates and flows.
 * Provides config-only exports (no user data), duplicate detection,
 * data template generation, and version-stamped formats.
 */

const CONFIG_VERSION = 1;

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateKey(name) {
  const slug = slugify(name);
  const ts = Date.now().toString(36);
  return `${slug}-${ts}`;
}

function copyName(originalName) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${originalName} (copy ${stamp})`;
}

function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (_) {
    return "unknown";
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildTemplateShareExport(template) {
  return {
    configVersion: CONFIG_VERSION,
    exportType: "template",
    exportedAt: new Date().toISOString(),
    extensionVersion: getExtensionVersion(),
    template: {
      key: template.key || "",
      name: template.name,
      fieldConfigs: JSON.parse(JSON.stringify(template.fieldConfigs || [])),
    },
  };
}

function buildFlowShareExport(flow, resolvedTemplates) {
  const tplExports = resolvedTemplates.map((tpl) => ({
    key: tpl.key || "",
    name: tpl.name,
    fieldConfigs: JSON.parse(JSON.stringify(tpl.fieldConfigs || [])),
  }));

  return {
    configVersion: CONFIG_VERSION,
    exportType: "flow",
    exportedAt: new Date().toISOString(),
    extensionVersion: getExtensionVersion(),
    flow: {
      key: flow.key || "",
      name: flow.name,
      startUrl: flow.startUrl || "",
      alwaysNavigate: flow.alwaysNavigate !== false,
      onError: flow.onError || "stop",
      retryFallback: flow.onError === "retry" ? (flow.retryFallback || "skip") : undefined,
      templateKeys: tplExports.map((t) => t.key),
    },
    templates: tplExports,
  };
}

function parseShareImport(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (_) {
    throw new Error("Invalid JSON file.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid export file: not a JSON object.");
  }

  const version = parsed.configVersion;
  if (!version || typeof version !== "number") {
    throw new Error("Invalid export file: missing or invalid configVersion.");
  }
  if (version > CONFIG_VERSION) {
    throw new Error(
      `This file uses config version ${version}, but your extension only supports up to version ${CONFIG_VERSION}. Please update the extension.`
    );
  }

  const type = parsed.exportType;
  if (type !== "template" && type !== "flow") {
    throw new Error('Invalid export file: exportType must be "template" or "flow".');
  }

  if (type === "template") {
    if (!parsed.template || !parsed.template.name || !Array.isArray(parsed.template.fieldConfigs)) {
      throw new Error("Invalid template export: missing template name or fieldConfigs.");
    }
  }

  if (type === "flow") {
    if (!parsed.flow || !parsed.flow.name) {
      throw new Error("Invalid flow export: missing flow name.");
    }
    if (!Array.isArray(parsed.templates)) {
      throw new Error("Invalid flow export: missing templates array.");
    }
  }

  return parsed;
}

function findDuplicateTemplate(incomingKey, incomingName, existingTemplates) {
  if (incomingKey) {
    const byKey = existingTemplates.find((t) => t.key === incomingKey);
    if (byKey) return { match: byKey, matchType: "key" };
  }
  if (incomingName) {
    const byName = existingTemplates.find((t) => slugify(t.name) === slugify(incomingName));
    if (byName) return { match: byName, matchType: "name" };
  }
  return null;
}

function findDuplicateFlow(incomingKey, incomingName, existingFlows) {
  if (incomingKey) {
    const byKey = existingFlows.find((f) => f.key === incomingKey);
    if (byKey) return { match: byKey, matchType: "key" };
  }
  if (incomingName) {
    const byName = existingFlows.find((f) => slugify(f.name) === slugify(incomingName));
    if (byName) return { match: byName, matchType: "name" };
  }
  return null;
}

function buildDataTemplate(fieldConfigs, targetName, targetType) {
  const ACTION_TYPES = ["button", "expand", "dialog"];
  const inputConfigs = fieldConfigs.filter(
    (f) => f.enabled !== false && !ACTION_TYPES.includes(f.fieldType)
  );

  const fields = inputConfigs.map((f) => ({
    key: f.key,
    label: f.displayName || f.key,
    type: f.fieldType || "typeahead",
  }));

  const placeholder = {};
  for (const f of inputConfigs) {
    placeholder[f.key] = f.fieldType === "typeahead" ? [] : "";
  }

  return {
    dataTemplateFor: slugify(targetName),
    targetType,
    fields,
    data: [placeholder],
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    CONFIG_VERSION,
    slugify,
    generateKey,
    copyName,
    getExtensionVersion,
    downloadJson,
    buildTemplateShareExport,
    buildFlowShareExport,
    parseShareImport,
    findDuplicateTemplate,
    findDuplicateFlow,
    buildDataTemplate,
  };
}
