const {
  findFieldByCfg,
  findByLabelFor,
  findByAriaLabel,
  findByPlaceholder,
  detectWidget,
  FIELD_STRATEGIES,
} = require("../src/selectors.js");

beforeEach(() => {
  document.body.innerHTML = "";
});

// ── FIELD_STRATEGIES registry ────────────────────────────────────

describe("FIELD_STRATEGIES", () => {
  it("has 3 strategies in correct order", () => {
    expect(FIELD_STRATEGIES).toHaveLength(3);
    expect(FIELD_STRATEGIES.map((s) => s.name)).toEqual(["labelFor", "ariaLabel", "placeholder"]);
  });

  it("each strategy has a find function", () => {
    FIELD_STRATEGIES.forEach((s) => {
      expect(typeof s.find).toBe("function");
    });
  });
});

// ── findByLabelFor ───────────────────────────────────────────────

describe("findByLabelFor", () => {
  it("finds input by matching label text", () => {
    document.body.innerHTML = `
      <label for="field1">Group Name</label>
      <input id="field1" type="text">
    `;
    const el = findByLabelFor(["group name"], new Set());
    expect(el).not.toBeNull();
    expect(el.id).toBe("field1");
  });

  it("matches partial label text", () => {
    document.body.innerHTML = `
      <label for="field1">Enter your group name here</label>
      <input id="field1" type="text">
    `;
    const el = findByLabelFor(["group name"], new Set());
    expect(el).not.toBeNull();
    expect(el.id).toBe("field1");
  });

  it("returns null when no label matches", () => {
    document.body.innerHTML = `
      <label for="field1">Email</label>
      <input id="field1" type="text">
    `;
    expect(findByLabelFor(["group name"], new Set())).toBeNull();
  });

  it("skips excluded elements", () => {
    document.body.innerHTML = `
      <label for="field1">Group Name</label>
      <input id="field1" type="text">
    `;
    const el = document.getElementById("field1");
    expect(findByLabelFor(["group name"], new Set([el]))).toBeNull();
  });

  it("skips labels without for attribute", () => {
    document.body.innerHTML = `
      <label>Group Name</label>
      <input id="field1" type="text">
    `;
    expect(findByLabelFor(["group name"], new Set())).toBeNull();
  });
});

// ── findByAriaLabel ──────────────────────────────────────────────

describe("findByAriaLabel", () => {
  it("finds element by aria-label", () => {
    document.body.innerHTML = `
      <input id="f1" aria-label="Group Name" type="text">
    `;
    const el = findByAriaLabel(["group name"], new Set());
    expect(el).not.toBeNull();
    expect(el.id).toBe("f1");
  });

  it("matches partial aria-label", () => {
    document.body.innerHTML = `
      <input id="f1" aria-label="Enter group name" type="text">
    `;
    const el = findByAriaLabel(["group name"], new Set());
    expect(el).not.toBeNull();
  });

  it("returns null when no match", () => {
    document.body.innerHTML = `
      <input id="f1" aria-label="Email" type="text">
    `;
    expect(findByAriaLabel(["group name"], new Set())).toBeNull();
  });

  it("skips excluded elements", () => {
    document.body.innerHTML = `
      <input id="f1" aria-label="Group Name" type="text">
    `;
    const el = document.getElementById("f1");
    expect(findByAriaLabel(["group name"], new Set([el]))).toBeNull();
  });
});

// ── findByPlaceholder ────────────────────────────────────────────

describe("findByPlaceholder", () => {
  it("finds input by placeholder", () => {
    document.body.innerHTML = `
      <input id="f1" placeholder="Enter group name" type="text">
    `;
    const el = findByPlaceholder(["group name"], new Set());
    expect(el).not.toBeNull();
    expect(el.id).toBe("f1");
  });

  it("finds textarea by placeholder", () => {
    document.body.innerHTML = `
      <textarea id="t1" placeholder="Business justification"></textarea>
    `;
    const el = findByPlaceholder(["business justification"], new Set());
    expect(el).not.toBeNull();
    expect(el.id).toBe("t1");
  });

  it("returns null when no match", () => {
    document.body.innerHTML = `
      <input id="f1" placeholder="Email" type="text">
    `;
    expect(findByPlaceholder(["group name"], new Set())).toBeNull();
  });

  it("skips excluded elements", () => {
    document.body.innerHTML = `
      <input id="f1" placeholder="Group Name" type="text">
    `;
    const el = document.getElementById("f1");
    expect(findByPlaceholder(["group name"], new Set([el]))).toBeNull();
  });
});

// ── detectWidget ─────────────────────────────────────────────────

describe("detectWidget", () => {
  it("returns select2Container for Select2 elements", () => {
    document.body.innerHTML = `
      <select id="sel1" class="select2-offscreen"></select>
      <div id="s2id_sel1" class="select2-container"></div>
    `;
    const el = document.getElementById("sel1");
    const result = detectWidget(el);
    expect(result.el).toBe(el);
    expect(result.select2Container).not.toBeNull();
    expect(result.select2Container.id).toBe("s2id_sel1");
  });

  it("returns null select2Container for non-Select2 elements", () => {
    document.body.innerHTML = `<input id="f1" type="text">`;
    const el = document.getElementById("f1");
    const result = detectWidget(el);
    expect(result.el).toBe(el);
    expect(result.select2Container).toBeNull();
  });

  it("returns null select2Container when container not found", () => {
    document.body.innerHTML = `<select id="sel1" class="select2-offscreen"></select>`;
    const el = document.getElementById("sel1");
    const result = detectWidget(el);
    expect(result.el).toBe(el);
    expect(result.select2Container).toBeNull();
  });
});

// ── findFieldByCfg (integration) ─────────────────────────────────

describe("findFieldByCfg", () => {
  it("returns null for empty labelMatch", () => {
    expect(findFieldByCfg({ labelMatch: [] })).toBeNull();
  });

  it("returns null for missing labelMatch", () => {
    expect(findFieldByCfg({})).toBeNull();
  });

  it("finds by label first (strategy priority)", () => {
    document.body.innerHTML = `
      <label for="byLabel">Group Name</label>
      <input id="byLabel" type="text">
      <input id="byAria" aria-label="Group Name" type="text">
      <input id="byPh" placeholder="Group Name" type="text">
    `;
    const result = findFieldByCfg({ labelMatch: ["group name"] });
    expect(result).not.toBeNull();
    expect(result.el.id).toBe("byLabel");
  });

  it("falls back to aria-label when no label match", () => {
    document.body.innerHTML = `
      <input id="byAria" aria-label="Group Name" type="text">
      <input id="byPh" placeholder="Group Name" type="text">
    `;
    const result = findFieldByCfg({ labelMatch: ["group name"] });
    expect(result).not.toBeNull();
    expect(result.el.id).toBe("byAria");
  });

  it("falls back to placeholder when no label or aria match", () => {
    document.body.innerHTML = `
      <input id="byPh" placeholder="Group Name" type="text">
    `;
    const result = findFieldByCfg({ labelMatch: ["group name"] });
    expect(result).not.toBeNull();
    expect(result.el.id).toBe("byPh");
  });

  it("respects exclude set", () => {
    document.body.innerHTML = `
      <label for="f1">Group Name</label>
      <input id="f1" type="text">
    `;
    const el = document.getElementById("f1");
    const result = findFieldByCfg({ labelMatch: ["group name"] }, new Set([el]));
    expect(result).toBeNull();
  });

  it("returns widget detection result", () => {
    document.body.innerHTML = `
      <label for="sel1">Group Name</label>
      <select id="sel1" class="select2-offscreen"></select>
      <div id="s2id_sel1"></div>
    `;
    const result = findFieldByCfg({ labelMatch: ["group name"] });
    expect(result).not.toBeNull();
    expect(result.select2Container).not.toBeNull();
  });
});
