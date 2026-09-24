// BI_SERVER_BLOCK_v471_WORKERS_SWITCH
// The BI-Server staging slot shares the production database. Its background
// workers were sending real sequence emails with a different backend token, so
// every other send failed with 401 invalid_backend_token. Workers run only where
// BI_WORKERS_ENABLED is not "false": set BI_WORKERS_ENABLED=false as a slot
// setting on the staging slot, and true (or unset) on production.
export function workersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.BI_WORKERS_ENABLED ?? "true").trim().toLowerCase() !== "false";
}
