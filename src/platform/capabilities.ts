export type StaffCapability = "crm:read" | "marketing:lists" | "marketing:outreach" | "marketing:admin";

export function capabilitiesForEmail(email: string | null | undefined): StaffCapability[] {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (normalized === "todd.w@boreal.financial") return ["crm:read", "marketing:lists", "marketing:outreach", "marketing:admin"];
  if (normalized === "andrew.p@boreal.financial") return ["crm:read", "marketing:outreach"];
  return ["crm:read"];
}

export function hasCapability(user: any, capability: StaffCapability): boolean {
  const caps = Array.isArray(user?.capabilities) ? user.capabilities : [];
  return caps.includes(capability);
}
