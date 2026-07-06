import { describe, it, expect } from "vitest";
import {
  parseAcceptQuery,
  formatAcceptQuery,
  negotiateQuery,
  AcceptQueryError,
} from "../src/index.js";

describe("parseAcceptQuery", () => {
  it("parses a single media type with default quality 1", () => {
    expect(parseAcceptQuery("application/json")).toEqual([
      { type: "application", subtype: "json", quality: 1, params: {} },
    ]);
  });

  it("sorts by quality descending", () => {
    const result = parseAcceptQuery(
      "application/sql;q=0.5, application/json;q=0.9, text/csv;q=0.7",
    );
    expect(result.map((r) => `${r.type}/${r.subtype}`)).toEqual([
      "application/json",
      "text/csv",
      "application/sql",
    ]);
  });

  it("lowercases type, subtype, and parameter keys", () => {
    const [range] = parseAcceptQuery("Application/JSON;Charset=UTF-8");
    expect(range).toMatchObject({
      type: "application",
      subtype: "json",
      params: { charset: "UTF-8" },
    });
  });

  it("clamps quality to the 0–1 range", () => {
    expect(parseAcceptQuery("a/b;q=5")[0]!.quality).toBe(1);
    expect(parseAcceptQuery("a/b;q=-3")[0]!.quality).toBe(0);
  });

  it("breaks quality ties by specificity (exact > type/* > */*)", () => {
    const result = parseAcceptQuery("*/*, application/*, application/json");
    expect(result.map((r) => `${r.type}/${r.subtype}`)).toEqual([
      "application/json",
      "application/*",
      "*/*",
    ]);
  });

  it("respects quoted parameter values containing commas and semicolons", () => {
    const result = parseAcceptQuery('application/json;note="a,b;c", text/csv');
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.subtype === "json")!.params.note).toBe("a,b;c");
  });

  it("returns [] for empty or whitespace input", () => {
    expect(parseAcceptQuery("")).toEqual([]);
    expect(parseAcceptQuery("   ")).toEqual([]);
  });

  it("skips malformed tokens leniently", () => {
    const result = parseAcceptQuery("not-a-media-type, application/json, /nope");
    expect(result).toEqual([
      { type: "application", subtype: "json", quality: 1, params: {} },
    ]);
  });
});

describe("formatAcceptQuery", () => {
  it("formats mixed strings and structured ranges", () => {
    expect(
      formatAcceptQuery([
        "application/json",
        { type: "application", subtype: "sql", quality: 0.8 },
      ]),
    ).toBe("application/json, application/sql;q=0.8");
  });

  it("omits q when quality is 1 and trims trailing zeros otherwise", () => {
    expect(formatAcceptQuery([{ type: "a", subtype: "b" }])).toBe("a/b");
    expect(
      formatAcceptQuery([{ type: "a", subtype: "b", quality: 0.5 }]),
    ).toBe("a/b;q=0.5");
  });

  it("quotes parameter values that aren't tokens", () => {
    expect(
      formatAcceptQuery([
        { type: "a", subtype: "b", params: { note: "x y" } },
      ]),
    ).toBe('a/b;note="x y"');
  });

  it("throws AcceptQueryError when type or subtype is missing", () => {
    expect(() =>
      formatAcceptQuery([{ type: "a", subtype: "" }]),
    ).toThrow(AcceptQueryError);
  });

  it("round-trips through parseAcceptQuery", () => {
    const header = "application/json, application/sql;q=0.8";
    expect(formatAcceptQuery(parseAcceptQuery(header))).toBe(header);
  });
});

describe("negotiateQuery", () => {
  it("picks the offered type with the highest server quality", () => {
    expect(
      negotiateQuery("application/sql;q=0.9, application/json;q=0.4", [
        "application/json",
        "application/sql",
      ]),
    ).toBe("application/sql");
  });

  it("keeps client preference order on equal quality", () => {
    expect(
      negotiateQuery("application/json, application/sql", [
        "application/sql",
        "application/json",
      ]),
    ).toBe("application/sql");
  });

  it("matches via a type wildcard", () => {
    expect(
      negotiateQuery("application/*", ["application/json"]),
    ).toBe("application/json");
  });

  it("matches via a full wildcard", () => {
    expect(negotiateQuery("*/*", ["text/csv"])).toBe("text/csv");
  });

  it("prefers an exact range over a wildcard of lower quality", () => {
    expect(
      negotiateQuery("*/*;q=0.1, application/json;q=1", [
        "text/csv",
        "application/json",
      ]),
    ).toBe("application/json");
  });

  it("excludes types the server weights at q=0", () => {
    expect(
      negotiateQuery("application/*, application/json;q=0", [
        "application/json",
      ]),
    ).toBeNull();
  });

  it("returns null when nothing matches or the header is empty", () => {
    expect(negotiateQuery("application/json", ["text/csv"])).toBeNull();
    expect(negotiateQuery("", ["application/json"])).toBeNull();
  });
});
