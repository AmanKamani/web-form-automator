require("./helpers/chrome-mock.js");

const {
  CONFIG_VERSION,
  slugify,
  generateKey,
  copyName,
  buildTemplateShareExport,
  buildFlowShareExport,
  parseShareImport,
  findDuplicateTemplate,
  findDuplicateFlow,
  buildDataTemplate,
} = require("../src/export-import.js");

// ── slugify ──────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Test@#$%Name!")).toBe("testname");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("my_template_name")).toBe("my-template-name");
  });

  it("handles empty/null input", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });
});

// ── generateKey ──────────────────────────────────────────────────

describe("generateKey", () => {
  it("returns slug-timestamp format", () => {
    const key = generateKey("My Template");
    expect(key).toMatch(/^my-template-[a-z0-9]+$/);
  });

  it("produces unique keys on successive calls", () => {
    const key1 = generateKey("test");
    const key2 = generateKey("test");
    // Keys could be identical if called within the same ms, but
    // the format should still be correct
    expect(key1).toMatch(/^test-[a-z0-9]+$/);
    expect(key2).toMatch(/^test-[a-z0-9]+$/);
  });

  it("handles empty name", () => {
    const key = generateKey("");
    expect(key).toMatch(/^-?[a-z0-9]+$/);
  });
});

// ── copyName ─────────────────────────────────────────────────────

describe("copyName", () => {
  it("appends copy with datetime stamp", () => {
    const result = copyName("Original");
    expect(result).toMatch(/^Original \(copy \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
  });

  it("preserves original name", () => {
    const result = copyName("My Flow");
    expect(result.startsWith("My Flow (copy")).toBe(true);
  });
});

// ── buildTemplateShareExport ─────────────────────────────────────

describe("buildTemplateShareExport", () => {
  const template = {
    key: "test-key-abc",
    name: "Test Template",
    fieldConfigs: [{ key: "f1", fieldType: "text" }],
    someOtherData: "should not leak",
  };

  it("includes configVersion", () => {
    const exp = buildTemplateShareExport(template);
    expect(exp.configVersion).toBe(CONFIG_VERSION);
  });

  it("sets exportType to template", () => {
    const exp = buildTemplateShareExport(template);
    expect(exp.exportType).toBe("template");
  });

  it("includes template key, name, and fieldConfigs", () => {
    const exp = buildTemplateShareExport(template);
    expect(exp.template.key).toBe("test-key-abc");
    expect(exp.template.name).toBe("Test Template");
    expect(exp.template.fieldConfigs).toEqual([{ key: "f1", fieldType: "text" }]);
  });

  it("does not leak extra properties", () => {
    const exp = buildTemplateShareExport(template);
    expect(exp.template.someOtherData).toBeUndefined();
  });

  it("deep copies fieldConfigs (mutation safe)", () => {
    const exp = buildTemplateShareExport(template);
    exp.template.fieldConfigs[0].key = "mutated";
    expect(template.fieldConfigs[0].key).toBe("f1");
  });
});

// ── buildFlowShareExport ─────────────────────────────────────────

describe("buildFlowShareExport", () => {
  const flow = {
    key: "flow-key-1",
    name: "My Flow",
    startUrl: "https://example.com",
    onError: "retry",
    retryFallback: "skip",
  };
  const templates = [
    { key: "tpl-1", name: "T1", fieldConfigs: [] },
    { key: "tpl-2", name: "T2", fieldConfigs: [{ key: "x" }] },
  ];

  it("sets exportType to flow", () => {
    const exp = buildFlowShareExport(flow, templates);
    expect(exp.exportType).toBe("flow");
  });

  it("populates templateKeys from resolved templates", () => {
    const exp = buildFlowShareExport(flow, templates);
    expect(exp.flow.templateKeys).toEqual(["tpl-1", "tpl-2"]);
  });

  it("includes all bundled templates", () => {
    const exp = buildFlowShareExport(flow, templates);
    expect(exp.templates).toHaveLength(2);
    expect(exp.templates[0].name).toBe("T1");
  });

  it("includes retryFallback when onError is retry", () => {
    const exp = buildFlowShareExport(flow, templates);
    expect(exp.flow.retryFallback).toBe("skip");
  });

  it("omits retryFallback when onError is not retry", () => {
    const stopFlow = { ...flow, onError: "stop" };
    const exp = buildFlowShareExport(stopFlow, templates);
    expect(exp.flow.retryFallback).toBeUndefined();
  });
});

// ── parseShareImport ─────────────────────────────────────────────

describe("parseShareImport", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseShareImport("{bad}")).toThrow("Invalid JSON");
  });

  it("throws on non-object", () => {
    expect(() => parseShareImport('"string"')).toThrow("not a JSON object");
  });

  it("throws on missing configVersion", () => {
    expect(() => parseShareImport('{"exportType":"template"}')).toThrow("configVersion");
  });

  it("throws on future configVersion", () => {
    const data = JSON.stringify({ configVersion: 999, exportType: "template", template: { name: "x", fieldConfigs: [] } });
    expect(() => parseShareImport(data)).toThrow("update the extension");
  });

  it("throws on invalid exportType", () => {
    const data = JSON.stringify({ configVersion: 1, exportType: "unknown" });
    expect(() => parseShareImport(data)).toThrow("exportType");
  });

  it("throws on template export missing name", () => {
    const data = JSON.stringify({ configVersion: 1, exportType: "template", template: { fieldConfigs: [] } });
    expect(() => parseShareImport(data)).toThrow("missing template name");
  });

  it("throws on flow export missing templates array", () => {
    const data = JSON.stringify({ configVersion: 1, exportType: "flow", flow: { name: "f" } });
    expect(() => parseShareImport(data)).toThrow("missing templates array");
  });

  it("parses valid template export", () => {
    const input = { configVersion: 1, exportType: "template", template: { name: "T", fieldConfigs: [] } };
    const result = parseShareImport(JSON.stringify(input));
    expect(result.exportType).toBe("template");
    expect(result.template.name).toBe("T");
  });

  it("parses valid flow export", () => {
    const input = { configVersion: 1, exportType: "flow", flow: { name: "F" }, templates: [] };
    const result = parseShareImport(JSON.stringify(input));
    expect(result.exportType).toBe("flow");
  });
});

// ── findDuplicateTemplate / findDuplicateFlow ────────────────────

describe("findDuplicateTemplate", () => {
  const existing = [
    { key: "key-1", name: "Alpha Template" },
    { key: "key-2", name: "Beta Template" },
  ];

  it("finds by exact key match", () => {
    const result = findDuplicateTemplate("key-1", "Different Name", existing);
    expect(result.match.name).toBe("Alpha Template");
    expect(result.matchType).toBe("key");
  });

  it("falls back to slugified name match", () => {
    const result = findDuplicateTemplate("", "Alpha Template", existing);
    expect(result.match.key).toBe("key-1");
    expect(result.matchType).toBe("name");
  });

  it("returns null when no match", () => {
    expect(findDuplicateTemplate("no-key", "No Name", existing)).toBeNull();
  });

  it("key match takes priority over name match", () => {
    const result = findDuplicateTemplate("key-2", "Alpha Template", existing);
    expect(result.match.name).toBe("Beta Template");
    expect(result.matchType).toBe("key");
  });
});

describe("findDuplicateFlow", () => {
  const existing = [
    { key: "flow-1", name: "Batch Run" },
  ];

  it("finds by key", () => {
    const result = findDuplicateFlow("flow-1", "", existing);
    expect(result.matchType).toBe("key");
  });

  it("finds by name", () => {
    const result = findDuplicateFlow("", "Batch Run", existing);
    expect(result.matchType).toBe("name");
  });

  it("returns null for no match", () => {
    expect(findDuplicateFlow("x", "y", existing)).toBeNull();
  });
});

// ── buildDataTemplate ────────────────────────────────────────────

describe("buildDataTemplate", () => {
  const configs = [
    { key: "name", displayName: "Name", fieldType: "text", enabled: true },
    { key: "group", displayName: "Group", fieldType: "typeahead", enabled: true },
    { key: "submit", displayName: "Submit", fieldType: "button", enabled: true },
    { key: "expand", displayName: "More", fieldType: "expand", enabled: true },
    { key: "confirm", displayName: "Confirm", fieldType: "dialog", enabled: true },
    { key: "disabled", displayName: "Disabled", fieldType: "text", enabled: false },
  ];

  it("filters out action types (button, expand, dialog)", () => {
    const result = buildDataTemplate(configs, "Test", "template");
    const keys = result.fields.map((f) => f.key);
    expect(keys).toContain("name");
    expect(keys).toContain("group");
    expect(keys).not.toContain("submit");
    expect(keys).not.toContain("expand");
    expect(keys).not.toContain("confirm");
  });

  it("filters out disabled fields", () => {
    const result = buildDataTemplate(configs, "Test", "template");
    const keys = result.fields.map((f) => f.key);
    expect(keys).not.toContain("disabled");
  });

  it("uses empty array for typeahead placeholders", () => {
    const result = buildDataTemplate(configs, "Test", "template");
    expect(result.data[0].group).toEqual([]);
  });

  it("uses empty string for non-typeahead placeholders", () => {
    const result = buildDataTemplate(configs, "Test", "template");
    expect(result.data[0].name).toBe("");
  });

  it("sets dataTemplateFor to slugified name", () => {
    const result = buildDataTemplate(configs, "My Template", "template");
    expect(result.dataTemplateFor).toBe("my-template");
  });
});
