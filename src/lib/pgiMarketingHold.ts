// BI_SERVER_PGI_MARKETING_HOLD_v1 (Todd, 2026-11-19: "pause all PGI marketing emails till we confirm with Craig").
// While held, nothing sends PGI marketing: email flows do not send or start, sequences do not start, queued campaign
// emails wait, list sends are refused (test sends to yourself still work), and the field-rep information email and
// follow-up text are not sent. Transactional mail (applications, OTP, documents) is not affected.
// Held unless PGI_MARKETING_HOLD=off is set on BI-Server - set that only once PGI Canada Ltd. has confirmed the material.
export const pgiMarketingHeld = (): boolean => String(process.env.PGI_MARKETING_HOLD ?? "").trim().toLowerCase() !== "off";
export const PGI_HOLD_MESSAGE = "PGI marketing is on hold until PGI Canada Ltd. confirms the material.";
