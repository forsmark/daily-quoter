import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let providerModule: typeof import("../../src/providers");

beforeAll(async () => {
  process.env.DISABLE_REMOTE_APIS = "1";
  providerModule = await import(`../../src/providers.ts?test=${Date.now()}`);
});

afterAll(() => {
  delete process.env.DISABLE_REMOTE_APIS;
});

describe("providers fallback mode", () => {
  test("returns fallback quotes when remote APIs are disabled", async () => {
    const response = await providerModule.getQuoteSuggestions(4, new Set());
    expect(response.source).toBe("fallback");
    expect(response.quotes.length).toBe(4);
    expect(response.exhausted).toBe(false);
  });

  test("returns fallback backgrounds when remote APIs are disabled", async () => {
    const response = await providerModule.getBackgroundChoices(3);
    expect(response.source).toBe("fallback");
    expect(response.backgrounds.length).toBeGreaterThan(0);
    expect(response.backgrounds.length).toBeLessThanOrEqual(3);
  });
});
