import crypto from "crypto";

export function generateGateCode(): string {
  return crypto.randomBytes(6).toString("hex");
}
