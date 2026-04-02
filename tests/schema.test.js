const { validateInput } = require("../src/schema.js");

describe("validateInput", () => {
  it("rejects null", () => {
    const result = validateInput(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/JSON object/);
  });

  it("rejects arrays", () => {
    const result = validateInput([1, 2]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/JSON object/);
  });

  it("rejects strings", () => {
    const result = validateInput("hello");
    expect(result.valid).toBe(false);
  });

  it("rejects empty object", () => {
    const result = validateInput({});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/empty/);
  });

  it("rejects object where all values are empty", () => {
    const result = validateInput({ a: "", b: [], c: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/empty/);
  });

  it("accepts valid object with string value", () => {
    const result = validateInput({ name: "test" });
    expect(result.valid).toBe(true);
    expect(result.data.name).toBe("test");
  });

  it("accepts valid object with array value", () => {
    const result = validateInput({ members: ["a@b.com"] });
    expect(result.valid).toBe(true);
    expect(result.data.members).toEqual(["a@b.com"]);
  });

  it("accepts object with numeric value", () => {
    const result = validateInput({ count: 42 });
    expect(result.valid).toBe(true);
    expect(result.data.count).toBe(42);
  });

  it("trims string values", () => {
    const result = validateInput({ name: "  hello  " });
    expect(result.valid).toBe(true);
    expect(result.data.name).toBe("hello");
  });

  it("trims strings inside arrays and filters empty", () => {
    const result = validateInput({ items: ["  a  ", "", "b"] });
    expect(result.valid).toBe(true);
    expect(result.data.items).toEqual(["a", "b"]);
  });

  it("passes through non-string non-array values", () => {
    const result = validateInput({ flag: true, count: 0 });
    expect(result.valid).toBe(true);
    expect(result.data.flag).toBe(true);
    expect(result.data.count).toBe(0);
  });
});
