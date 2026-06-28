import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ContactMapper,
  MappingSchema,
  NormalizationError,
  PatternRegistry,
  normalizeValue,
} from "../src/index.js";

test("pattern registry loads the synced Python truth table", () => {
  const pythonPatterns = JSON.parse(
    readFileSync(new URL("../../../../src/rolodexter/patterns.json", import.meta.url), "utf8"),
  ) as { fields: Record<string, string[]> };
  const registry = new PatternRegistry();

  assert.deepEqual(registry.canonicalFields.sort(), Object.keys(pythonPatterns.fields).sort());
  assert.equal(registry.exactLookup("fname"), "first_name");
  assert.equal(registry.exactLookup("MobilePhone"), "phone");
});

test("maps and normalizes a basic contact payload", () => {
  const result = new ContactMapper().mapPayload({
    fname: "jane",
    surname: "doe",
    mobile: "(202) 555-0143",
    employer: "Tech Corp",
    "Column 1": "jane.doe@example.com",
  });

  assert.equal(result.normalized.first_name, "Jane");
  assert.equal(result.normalized.last_name, "Doe");
  assert.equal(result.normalized.phone, "+12025550143");
  assert.equal(result.normalized.company, "Tech Corp");
  assert.equal(result.normalized.email, "jane.doe@example.com");
  assert.equal(result.unmatchedCount, 0);
});

test("handles normalized headers and dot paths", () => {
  const mapper = new ContactMapper();

  assert.equal(mapper.identify("FirstName").canonical, "first_name");
  assert.equal(mapper.identify("Account.Name").canonical, "company");
  assert.equal(mapper.identify("Phone 1 - Value").canonical, "phone");
  assert.equal(mapper.identify("hs_lead_status").canonical, "lead_status");
});

test("heuristics detect already-normalized E.164 phone values", () => {
  const match = new ContactMapper().identify("Mystery Column", {
    value: "+12025550143",
  });

  assert.equal(match.canonical, "phone");
  assert.equal(match.strategy, "heuristic");
});

test("drops low-confidence heuristic matches at threshold", () => {
  const result = new ContactMapper({ confidenceThreshold: 0.8 }).mapPayload({
    Mystery: "jane@example.com",
  });

  assert.equal(result.normalized.email, undefined);
  assert.equal(result.unmapped.Mystery, "jane@example.com");
  assert.match(result.warnings[0] ?? "", /dropped low-confidence/);
});

test("strict mode raises on warnings", () => {
  assert.throws(
    () => new ContactMapper({ strict: true }).mapPayload({ phone: "not a phone" }),
    NormalizationError,
  );
});

test("normalizes list fields and dedupes collisions", () => {
  const result = new ContactMapper().mapPayload({
    tags: "vip, newsletter",
    labels: '["vip", "beta"]',
  });

  assert.deepEqual(result.normalized.tags, ["vip", "newsletter", "beta"]);
});

test("extracts embedded phone numbers when opted in", () => {
  const result = new ContactMapper().mapPayload(
    { notes: "Call +1-650-253-0000 before lunch" },
    { extractEmbeddedPhones: true },
  );

  assert.deepEqual(result.getAllPhones(), ["+16502530000"]);
});

test("embedded phone extraction is bounded and warns", () => {
  const manyNumbers = Array.from({ length: 7 }, () => "+1 202 555 1234").join(" ");
  const result = new ContactMapper().mapPayload(
    { notes: manyNumbers },
    { extractEmbeddedPhones: true },
  );

  assert.equal(
    result.fieldMatches.filter((match) => match.strategy === "embedded_phone").length,
    5,
  );
  assert.match(result.warnings[0] ?? "", /for this field/);
});

test("compileSchema returns a reusable header plan", () => {
  const schema = new ContactMapper().compileSchema(["First Name", "Mobile Phone", "Whatever"]);

  assert.ok(schema instanceof MappingSchema);
  assert.deepEqual(schema.columnMap(), {
    "First Name": "first_name",
    "Mobile Phone": "phone",
  });
  assert.deepEqual(schema.unmatchedHeaders(), ["Whatever"]);

  const result = schema.apply({ "First Name": "jane", "Mobile Phone": "(202) 555-0143" });
  assert.equal(result.normalized.first_name, "Jane");
  assert.equal(result.normalized.phone, "+12025550143");
});

test("mapBatch and mapStream agree", () => {
  const mapper = new ContactMapper();
  const rows = [{ fname: "A" }, { surname: "B" }, { email: "C@Example.COM" }];

  assert.deepEqual(
    mapper.mapBatch(rows).map((result) => result.normalized),
    [...mapper.mapStream(rows)].map((result) => result.normalized),
  );
});

test("standalone normalizeValue covers public normalizers", () => {
  assert.equal(normalizeValue("email", " A@EXAMPLE.COM "), "a@example.com");
  assert.deepEqual(normalizeValue("tags", "a;b"), ["a", "b"]);
  assert.equal(normalizeValue("postal_code", "k1a0b1"), "K1A 0B1");
});
