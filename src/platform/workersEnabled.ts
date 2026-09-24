// BI_SERVER_BLOCK_v472_WORKER_SWITCH_v1
// The Azure staging slot shares the live BI database. Any background worker
// running there sends real emails/SMS to real contacts. Set the slot setting
// BI_WORKERS_ENABLED=false on staging; production leaves it unset or true.
// Default is ON so an unset variable never silently stops production.
const OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

export function workersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BI_WORKERS_ENABLED;
  if (raw === undefined || raw.trim() === "") return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}
