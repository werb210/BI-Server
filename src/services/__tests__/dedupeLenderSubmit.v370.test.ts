// BI_SERVER_BLOCK_v370_DEDUPE_LENDER_SUBMIT_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const serviceSrc = fs.readFileSync(path.resolve(__dirname, "../lenderCarrierSubmit.ts"), "utf8");
const apiRouteSrc = fs.readFileSync(path.resolve(__dirname, "../../routes/biLenderApiRoutes.ts"), "utf8");
const portalRouteSrc = fs.readFileSync(path.resolve(__dirname, "../../routes/biLenderApplicationCreate.ts"), "utf8");

describe("v370 — service exists and is called from both routes", () => {
  it("submitLenderApplicationToCarrier exported", () => {
    expect(serviceSrc).toMatch(/export async function submitLenderApplicationToCarrier/);
  });
  it("biLenderApiRoutes uses the service", () => {
    expect(apiRouteSrc).toMatch(/submitLenderApplicationToCarrier/);
  });
  it("biLenderApplicationCreate uses the service", () => {
    expect(portalRouteSrc).toMatch(/submitLenderApplicationToCarrier/);
  });
  it("neither route still does its own pgiSubmit call", () => {
    // Direct pgiSubmit calls should ONLY be in the service file now.
    expect(apiRouteSrc).not.toMatch(/await pgiSubmit\(/);
    expect(portalRouteSrc).not.toMatch(/await pgiSubmit\(/);
  });
});
