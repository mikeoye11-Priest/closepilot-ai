export const INTERACTIVE_UPLOAD_MAX_FILES = 12;
export const INTERACTIVE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const BACKGROUND_UPLOAD_MAX_FILES = 50;
export const BACKGROUND_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const BACKGROUND_UPLOAD_MAX_BYTES = 250 * 1024 * 1024;
export const SUPPORTED_FINANCE_FILE = /\.(csv|tsv|txt|xlsx|xls)$/i;
export const BACKGROUND_SUPPORTED_FINANCE_FILE = /\.(csv|tsv|txt)$/i;

export type UploadCapacityFile = { name: string; size: number };
export type UploadMode = "interactive" | "background" | "rejected";

export type UploadCapacityDecision = {
  mode: UploadMode;
  totalBytes: number;
  message: string;
};

export function decideUploadMode(files: UploadCapacityFile[]): UploadCapacityDecision {
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  const unsupported = files.filter((file) => !SUPPORTED_FINANCE_FILE.test(file.name));
  if (unsupported.length) {
    return { mode: "rejected", totalBytes, message: `Unsupported file type: ${unsupported.map((file) => file.name).join(", ")}` };
  }
  if (files.length > BACKGROUND_UPLOAD_MAX_FILES) {
    return { mode: "rejected", totalBytes, message: `Upload at most ${BACKGROUND_UPLOAD_MAX_FILES} files in one finance pack.` };
  }
  const oversized = files.find((file) => file.size > BACKGROUND_UPLOAD_MAX_FILE_BYTES);
  if (oversized) {
    return { mode: "rejected", totalBytes, message: `${oversized.name} exceeds the 100 MB per-file limit.` };
  }
  if (totalBytes > BACKGROUND_UPLOAD_MAX_BYTES) {
    return { mode: "rejected", totalBytes, message: "The combined finance pack exceeds the 250 MB background-processing limit." };
  }
  if (files.length <= INTERACTIVE_UPLOAD_MAX_FILES && totalBytes <= INTERACTIVE_UPLOAD_MAX_BYTES) {
    return { mode: "interactive", totalBytes, message: "This pack can be reviewed immediately." };
  }
  const unsupportedBackground = files.filter((file) => !BACKGROUND_SUPPORTED_FINANCE_FILE.test(file.name));
  if (unsupportedBackground.length) {
    return { mode: "rejected", totalBytes, message: "Large Excel workbooks are not background-ready yet. Export large workbook sheets as CSV or keep the combined Excel pack below 4 MB." };
  }
  return { mode: "background", totalBytes, message: "This pack will upload directly to secure storage and be processed in the background." };
}

export function formatUploadBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
