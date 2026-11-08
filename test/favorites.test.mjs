import assert from "node:assert/strict";
import test from "node:test";

import {
  FAVORITES_NAME,
  UPDATE_STATUS_NO,
  UPDATE_STATUS_YES,
  createFavoriteUpdate,
  removeFavoriteEntry
} from "../src/scripts/easyReadData.mjs";

const messages = { added: "added", duplicate: "duplicate", removed: "removed", missing: "missing" };

test("collecting a link creates the list on first use", () => {
  const result = createFavoriteUpdate({}, {
    storageKey: FAVORITES_NAME,
    tab: { url: "https://example.com/a", title: "A" },
    now: () => 1000,
    messages
  });

  assert.equal(result.status, UPDATE_STATUS_YES);
  assert.deepEqual(result.value, [{
    key: "https://example.com/a",
    url: "https://example.com/a",
    title: "A",
    createDateTime: 1000
  }]);
  assert.equal(result.message, "added");
});

test("collecting the same link twice does not duplicate it", () => {
  const existing = [{
    key: "https://example.com/a",
    url: "https://example.com/a",
    title: "A",
    createDateTime: 1000
  }];
  const result = createFavoriteUpdate({ [FAVORITES_NAME]: existing }, {
    storageKey: FAVORITES_NAME,
    tab: { url: "https://example.com/a", title: "A" },
    now: () => 2000,
    messages
  });

  assert.equal(result.status, UPDATE_STATUS_NO);
  assert.equal(result.value, null);
  assert.equal(result.message, "duplicate");
});

test("collecting a different link appends to the existing list", () => {
  const existing = [{
    key: "https://example.com/a",
    url: "https://example.com/a",
    title: "A",
    createDateTime: 1000
  }];
  const result = createFavoriteUpdate({ [FAVORITES_NAME]: existing }, {
    storageKey: FAVORITES_NAME,
    tab: { url: "https://example.com/b", title: "B" },
    now: () => 2000,
    messages
  });

  assert.equal(result.status, UPDATE_STATUS_YES);
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0].key, "https://example.com/a");
  assert.equal(result.value[1].key, "https://example.com/b");
});

test("removing a saved link drops only that entry", () => {
  const existing = [
    { key: "https://example.com/a", url: "https://example.com/a", title: "A", createDateTime: 1000 },
    { key: "https://example.com/b", url: "https://example.com/b", title: "B", createDateTime: 2000 }
  ];
  const result = removeFavoriteEntry({ [FAVORITES_NAME]: existing }, {
    storageKey: FAVORITES_NAME,
    pageKey: "https://example.com/a",
    messages
  });

  assert.equal(result.status, UPDATE_STATUS_YES);
  assert.deepEqual(result.value.map(item => item.key), ["https://example.com/b"]);
  assert.equal(result.message, "removed");
});

test("removing an unknown link reports missing without writing", () => {
  const existing = [{ key: "https://example.com/a", url: "https://example.com/a", title: "A", createDateTime: 1000 }];
  const result = removeFavoriteEntry({ [FAVORITES_NAME]: existing }, {
    storageKey: FAVORITES_NAME,
    pageKey: "https://example.com/zzz",
    messages
  });

  assert.equal(result.status, UPDATE_STATUS_NO);
  assert.equal(result.value, null);
  assert.equal(result.message, "missing");
});
