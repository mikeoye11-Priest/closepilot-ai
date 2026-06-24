import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_UPLOAD_MAX_BYTES,
  BACKGROUND_UPLOAD_MAX_FILE_BYTES,
  BACKGROUND_UPLOAD_MAX_FILES,
  INTERACTIVE_UPLOAD_MAX_BYTES,
  INTERACTIVE_UPLOAD_MAX_FILES,
  decideUploadMode,
} from "../apps/web/lib/upload-capacity";

test("small finance packs remain on the immediate review path", () => {
  const files = Array.from({ length: INTERACTIVE_UPLOAD_MAX_FILES }, (_, index) => ({ name: `export-${index}.csv`, size: Math.floor(INTERACTIVE_UPLOAD_MAX_BYTES / INTERACTIVE_UPLOAD_MAX_FILES) }));
  assert.equal(decideUploadMode(files).mode, "interactive");
});

test("packs above the immediate limit move to background processing", () => {
  const decision = decideUploadMode([{ name: "ledger.csv", size: INTERACTIVE_UPLOAD_MAX_BYTES + 1 }]);
  assert.equal(decision.mode, "background");
  assert.match(decision.message, /background/i);
});

test("multi-file packs above the immediate file count move to background processing", () => {
  const files = Array.from({ length: INTERACTIVE_UPLOAD_MAX_FILES + 1 }, (_, index) => ({ name: `export-${index}.csv`, size: 100 }));
  assert.equal(decideUploadMode(files).mode, "background");
});

test("background capacity rejects excessive total size, individual size, file count and unsupported formats", () => {
  assert.equal(decideUploadMode([{ name: "ledger.csv", size: BACKGROUND_UPLOAD_MAX_BYTES + 1 }]).mode, "rejected");
  assert.equal(decideUploadMode([{ name: "ledger.csv", size: BACKGROUND_UPLOAD_MAX_FILE_BYTES + 1 }]).mode, "rejected");
  assert.equal(decideUploadMode(Array.from({ length: BACKGROUND_UPLOAD_MAX_FILES + 1 }, (_, index) => ({ name: `export-${index}.csv`, size: 1 }))).mode, "rejected");
  assert.equal(decideUploadMode([{ name: "ledger.pdf", size: 1024 }]).mode, "rejected");
});
