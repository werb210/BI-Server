// BI_SERVER_v784_SENDGRID_SIGNED_ONLY - test helper that signs SendGrid Event
// Webhook payloads the way SendGrid does: ECDSA P-256 over timestamp + raw body,
// base64 DER signature, public key configured as base64 SPKI without PEM armour.
import crypto from "node:crypto";

export type SendgridSigner = {
  publicKeyBase64: string;
  sign: (rawBody: string, timestamp?: string) => Record<string, string>;
};

export function createSendgridSigner(): SendgridSigner {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    publicKeyBase64,
    sign(rawBody: string, timestamp = String(Math.floor(Date.now() / 1000))) {
      const s = crypto.createSign("sha256");
      s.update(timestamp + rawBody);
      s.end();
      return {
        "X-Twilio-Email-Event-Webhook-Signature": s.sign(privateKey, "base64"),
        "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
      };
    },
  };
}
