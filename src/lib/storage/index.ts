// BI_HARDENING_v44 — Storage factory. Chooses backend at process start.
// In production NODE_ENV requires AZURE_STORAGE_CONNECTION_STRING (enforced by env.ts).
import path from "node:path";
import { AzureBlobBackend } from "./azureBlob";
import { LocalBackend } from "./local";
import type { StorageBackend } from "./types";

let _instance: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (_instance) return _instance;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const container = process.env.AZURE_STORAGE_CONTAINER_BI || "bi-documents";
  if (conn) {
    _instance = new AzureBlobBackend(container, conn);
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[STORAGE] AZURE_STORAGE_CONNECTION_STRING is required in production");
    }
    _instance = new LocalBackend(path.join(process.cwd(), "uploads", "bi"));
  }
  return _instance;
}

// Test-only: allow reset between unit tests.
export function __resetStorageForTests() {
  _instance = null;
}

export type { StorageBackend, PutResult } from "./types";
