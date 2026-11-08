import assert from "node:assert/strict";
import test from "node:test";

import { orderSaveKeys } from "../src/scripts/easyReadData.mjs";

const available = ["html", "pdf", "image", "markdown", "link"];

test("stored order is applied as-is when every key is known", () => {
  const stored = ["link", "markdown", "image", "pdf", "html"];
  assert.deepEqual(orderSaveKeys(stored, available), stored);
});

test("keys that no longer exist are dropped", () => {
  const stored = ["link", "removed-item", "html"];
  assert.deepEqual(orderSaveKeys(stored, ["html", "link"]), ["link", "html"]);
});

test("entries the stored order never saw are appended at the end", () => {
  const stored = ["link", "html"];
  assert.deepEqual(orderSaveKeys(stored, available), ["link", "html", "pdf", "image", "markdown"]);
});

test("duplicates in the stored order do not repeat entries", () => {
  assert.deepEqual(orderSaveKeys(["link", "link", "html"], ["html", "link"]), ["link", "html"]);
});

test("missing or malformed stored order falls back to the available order", () => {
  assert.deepEqual(orderSaveKeys(undefined, available), available);
  assert.deepEqual(orderSaveKeys("link,html", available), available);
  assert.deepEqual(orderSaveKeys([], available), available);
});
