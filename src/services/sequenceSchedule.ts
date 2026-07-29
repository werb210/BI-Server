// BI_SEQ_BUSINESS_HOURS_v1
export const SEQUENCE_TIME_ZONE = "America/Edmonton";

export type SendWindow = {
  startHour: number;
  endHour: number;
  weekdaysOnly: boolean;
};

type LocalParts = { weekday: string; hour: number; minute: number; second: number };

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEQUENCE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(at: Date): LocalParts {
  const parts = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function normalized(window: SendWindow): SendWindow {
  return {
    startHour: Math.max(0, Math.min(23, Math.trunc(window.startHour))),
    endHour: Math.max(1, Math.min(24, Math.trunc(window.endHour))),
    weekdaysOnly: window.weekdaysOnly,
  };
}

export function isSendableAt(at: Date, sendWindow: SendWindow): boolean {
  const window = normalized(sendWindow);
  if (!Number.isFinite(at.getTime()) || window.startHour >= window.endHour) return false;
  const local = localParts(at);
  if (window.weekdaysOnly && (local.weekday === "Sat" || local.weekday === "Sun")) return false;
  return local.hour >= window.startHour && local.hour < window.endHour;
}

/** Return the first open minute at or after `at`; it never moves time backwards. */
export function nextSendableAt(at: Date, sendWindow: SendWindow): Date {
  const candidate = new Date(at);
  if (!Number.isFinite(candidate.getTime())) throw new RangeError("Invalid schedule date");
  if (isSendableAt(candidate, sendWindow)) return candidate;

  // Scan in minutes. This is deliberately timezone-rule driven rather than based on
  // a fixed Mountain offset, so DST transitions remain correct.
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  const maxMinutes = 8 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (isSendableAt(candidate, sendWindow)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new RangeError("No sendable time exists in the next eight days");
}

export function scheduleFromNow(delaySeconds: number, sendWindow: SendWindow, now = new Date()): Date {
  const delayMs = Math.max(0, Number.isFinite(delaySeconds) ? delaySeconds : 0) * 1_000;
  return nextSendableAt(new Date(now.getTime() + delayMs), sendWindow);
}
