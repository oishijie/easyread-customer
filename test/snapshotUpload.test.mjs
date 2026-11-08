import assert from "node:assert/strict";
import test from "node:test";

import { snapshotUploadFormat, SNAPSHOT_UPLOAD_MAX_BYTES } from "../src/scripts/easyReadData.mjs";

test("screenshot captures map to the screenshot backend format", () => {
  assert.equal(snapshotUploadFormat("image"), "screenshot");
});

test("html and markdown keep their own format", () => {
  assert.equal(snapshotUploadFormat("html"), "html");
  assert.equal(snapshotUploadFormat("markdown"), "markdown");
});

test("pdf and unknown types are not uploadable", () => {
  assert.equal(snapshotUploadFormat("pdf"), null);
  assert.equal(snapshotUploadFormat(""), null);
  assert.equal(snapshotUploadFormat(undefined), null);
});

test("upload size limit stays small enough for extension messaging", () => {
  assert.equal(SNAPSHOT_UPLOAD_MAX_BYTES, 15 * 1024 * 1024);
});
