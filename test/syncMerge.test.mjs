import assert from "node:assert/strict";
import test from "node:test";

import {
  addFavoriteDeletion,
  mergeAllRecords,
  mergeFavorites,
  mergeNotePages,
  mergeReadLaters,
  READ_STATUS_READED,
  READ_STATUS_READING,
  READ_STATUS_UNREAD
} from "../src/scripts/easyReadData.mjs";
import { normalizeEndpoint } from "../src/scripts/syncEngine.mjs";

test("read later merge keeps the highest status and never downgrades", () => {
  const local = [
    { key: "https://a.com/", url: "https://a.com/", title: "A", createDateTime: 1, status: READ_STATUS_READED }
  ];
  const remote = [
    { key: "https://a.com/", url: "https://a.com/", title: "A", createDateTime: 1, status: READ_STATUS_UNREAD }
  ];

  const merged = mergeReadLaters(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, READ_STATUS_READED);
});

test("read later merge adopts the larger status and the missing position", () => {
  const local = [{ key: "https://b.com/", url: "https://b.com/", title: "B", status: READ_STATUS_UNREAD }];
  const remote = [{
    key: "https://b.com/", url: "https://b.com/", title: "B",
    status: READ_STATUS_READING,
    position: { progress: 42, scrollX: 0, scrollY: 1200 }
  }];

  const merged = mergeReadLaters(local, remote);
  assert.equal(merged[0].status, READ_STATUS_READING);
  assert.deepEqual(merged[0].position, { progress: 42, scrollX: 0, scrollY: 1200 });
});

test("read later merge appends cloud only entries and drops deleted keys", () => {
  const local = [{ key: "https://c.com/", url: "https://c.com/", title: "C", status: READ_STATUS_UNREAD }];
  const remote = [{ key: "https://d.com/", url: "https://d.com/", title: "D", status: READ_STATUS_UNREAD }];

  const merged = mergeReadLaters(local, remote, ["https://c.com/"]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, "https://d.com/");
});

test("read later merge normalizes the page key before matching", () => {
  const local = [{ key: "https://e.com/", url: "https://e.com/", title: "E", status: READ_STATUS_UNREAD }];
  const remote = [{ key: "https://e.com/", url: "https://e.com/#top", title: "E", status: READ_STATUS_READED }];

  const merged = mergeReadLaters(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, READ_STATUS_READED);
});

test("browsing history merge unions visit timestamps", () => {
  const local = { "https://f.com/": { url: "https://f.com/", title: "F", datetimes: [10, 20] } };
  const remote = { "https://f.com/": { url: "https://f.com/", title: "F", datetimes: [20, 30] } };

  const merged = mergeAllRecords(local, remote);
  assert.deepEqual(merged["https://f.com/"].datetimes, [10, 20, 30]);
});

test("browsing history merge adds unknown pages and keeps local video progress", () => {
  const local = {
    "https://g.com/": { url: "https://g.com/", title: "G", datetimes: [1], videoProgress: { currentTime: 30, duration: 60 } }
  };
  const remote = { "https://h.com/": { url: "https://h.com/", title: "H", datetimes: [2] } };

  const merged = mergeAllRecords(local, remote);
  assert.equal(merged["https://g.com/"].videoProgress.currentTime, 30);
  assert.deepEqual(merged["https://h.com/"].datetimes, [2]);
});

test("notes merge adds cloud notes without duplicating known ids", () => {
  const local = {
    "https://i.com/": { url: "https://i.com/", title: "I", createDateTime: 5, notes: [{ id: "n1", comment: "local" }] }
  };
  const remote = {
    "https://i.com/": { url: "https://i.com/", title: "I", createDateTime: 5, notes: [{ id: "n1", comment: "cloud" }, { id: "n2", comment: "new" }] }
  };

  const merged = mergeNotePages(local, remote);
  assert.equal(merged["https://i.com/"].notes.length, 2);
  assert.equal(merged["https://i.com/"].notes[0].comment, "local");
  assert.equal(merged["https://i.com/"].notes[1].id, "n2");
});

test("notes merge removes deleted note ids and drops the empty page", () => {
  const local = {
    "https://j.com/": { url: "https://j.com/", title: "J", notes: [{ id: "n3" }] },
    "https://k.com/": { url: "https://k.com/", title: "K", notes: [{ id: "n4" }] }
  };

  const merged = mergeNotePages(local, {}, ["n3"]);
  assert.equal(merged["https://j.com/"], undefined);
  assert.equal(merged["https://k.com/"].notes.length, 1);
});

test("endpoint normalization adds a scheme and trims trailing slashes", () => {
  assert.equal(normalizeEndpoint("example.workers.dev/"), "https://example.workers.dev");
  assert.equal(normalizeEndpoint("https://a.com///"), "https://a.com");
  assert.equal(normalizeEndpoint("http://b.com"), "http://b.com");
  assert.equal(normalizeEndpoint("   "), "");
});

test("favorites merge unions both sides by key without overwriting local fields", () => {
  const local = [
    { key: "https://a.com/", url: "https://a.com/", title: "Local A", createDateTime: 1 }
  ];
  const remote = [
    { key: "https://a.com/", url: "https://a.com/", title: "Cloud A", createDateTime: 1 },
    { key: "https://b.com/", url: "https://b.com/", title: "B", createDateTime: 2 }
  ];

  const merged = mergeFavorites(local, remote);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, "Local A", "local fields win on conflict");
  assert.equal(merged[1].key, "https://b.com/");
});

test("favorites merge drops tombstoned keys from both sides", () => {
  const local = [
    { key: "https://a.com/", url: "https://a.com/", title: "A", createDateTime: 1 },
    { key: "https://b.com/", url: "https://b.com/", title: "B", createDateTime: 2 }
  ];
  const remote = [
    { key: "https://b.com/", url: "https://b.com/", title: "B", createDateTime: 2 },
    { key: "https://c.com/", url: "https://c.com/", title: "C", createDateTime: 3 }
  ];

  const merged = mergeFavorites(local, remote, ["https://a.com/"]);
  assert.deepEqual(merged.map(item => item.key), ["https://b.com/", "https://c.com/"]);
});

test("deleted favorites are queued once so the server can tombstone them", () => {
  const first = addFavoriteDeletion(undefined, "https://a.com/");
  assert.deepEqual(first, ["https://a.com/"]);

  const again = addFavoriteDeletion(first, "https://a.com/");
  assert.deepEqual(again, ["https://a.com/"], "same key is not queued twice");

  const second = addFavoriteDeletion(again, "https://b.com/#section");
  assert.deepEqual(second, ["https://a.com/", "https://b.com/"]);

  assert.deepEqual(addFavoriteDeletion(second, ""), second, "empty keys are ignored");
  assert.deepEqual(addFavoriteDeletion(null, "https://c.com/"), ["https://c.com/"]);
});
