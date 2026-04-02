const { resetStorage } = require("./helpers/chrome-mock.js");
const {
  STORAGE_KEYS,
  DEFAULT_FIELD_CONFIGS,
  EMPTY_PAYLOAD,
  loadOrMigrateStorage,
} = require("../src/storage-defaults.js");

beforeEach(() => {
  resetStorage();
});

// ── STORAGE_KEYS ─────────────────────────────────────────────────

describe("STORAGE_KEYS", () => {
  it("has all expected keys", () => {
    const expected = ["DOMAIN", "FIELD_CONFIGS", "ACTIVE_PAYLOAD", "TEMPLATES", "LAST_INPUT_MODE", "LAST_TEMPLATE_ID", "FLOWS", "LAST_FLOW_ID"];
    expected.forEach((k) => {
      expect(STORAGE_KEYS).toHaveProperty(k);
      expect(typeof STORAGE_KEYS[k]).toBe("string");
    });
  });
});

// ── DEFAULT_FIELD_CONFIGS ────────────────────────────────────────

describe("DEFAULT_FIELD_CONFIGS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_FIELD_CONFIGS)).toBe(true);
    expect(DEFAULT_FIELD_CONFIGS.length).toBeGreaterThan(0);
  });

  it("each config has required properties", () => {
    DEFAULT_FIELD_CONFIGS.forEach((cfg) => {
      expect(cfg).toHaveProperty("key");
      expect(cfg).toHaveProperty("displayName");
      expect(cfg).toHaveProperty("labelMatch");
      expect(cfg).toHaveProperty("fieldType");
      expect(cfg).toHaveProperty("enabled");
      expect(Array.isArray(cfg.labelMatch)).toBe(true);
    });
  });
});

// ── EMPTY_PAYLOAD ────────────────────────────────────────────────

describe("EMPTY_PAYLOAD", () => {
  it("is a plain object", () => {
    expect(typeof EMPTY_PAYLOAD).toBe("object");
    expect(EMPTY_PAYLOAD).not.toBeNull();
    expect(Array.isArray(EMPTY_PAYLOAD)).toBe(false);
  });
});

// ── loadOrMigrateStorage ─────────────────────────────────────────

describe("loadOrMigrateStorage", () => {
  it("populates defaults on empty storage", async () => {
    const result = await loadOrMigrateStorage();
    expect(result[STORAGE_KEYS.FIELD_CONFIGS]).toEqual(DEFAULT_FIELD_CONFIGS);
    expect(result[STORAGE_KEYS.ACTIVE_PAYLOAD]).toEqual(EMPTY_PAYLOAD);
    expect(result[STORAGE_KEYS.TEMPLATES]).toEqual([]);
    expect(result[STORAGE_KEYS.LAST_INPUT_MODE]).toBe("upload");
    expect(result[STORAGE_KEYS.FLOWS]).toEqual([]);
  });

  it("preserves existing values", async () => {
    resetStorage({ [STORAGE_KEYS.DOMAIN]: "example.com", [STORAGE_KEYS.TEMPLATES]: [{ name: "T1" }] });
    const result = await loadOrMigrateStorage();
    expect(result[STORAGE_KEYS.DOMAIN]).toBe("example.com");
    expect(result[STORAGE_KEYS.TEMPLATES]).toEqual([{ name: "T1" }]);
  });

  it("is idempotent -- calling twice gives same result", async () => {
    const first = await loadOrMigrateStorage();
    const second = await loadOrMigrateStorage();
    expect(first[STORAGE_KEYS.FIELD_CONFIGS]).toEqual(second[STORAGE_KEYS.FIELD_CONFIGS]);
    expect(first[STORAGE_KEYS.TEMPLATES]).toEqual(second[STORAGE_KEYS.TEMPLATES]);
  });
});
