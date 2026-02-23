import { expect, test, type Page } from "@playwright/test";

async function refreshBackgrounds(page: Page): Promise<void> {
  const waitForBackgrounds = page.waitForResponse(
    (response) => response.url().includes("/api/backgrounds") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Refresh Backgrounds" }).click();
  await waitForBackgrounds;
}

function sectionByHeading(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading })
    .locator("xpath=ancestor::section[1]");
}

async function clearHistory(page: Page): Promise<void> {
  await page.request.delete("/api/quotes/history");
}

async function generateAndSaveSelection(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Generate \d+ Quotes/ }).click();

  const quoteSection = sectionByHeading(page, "1. Choose a Quote");
  const firstQuote = quoteSection.locator("button").first();
  await expect(firstQuote).toBeVisible();
  await firstQuote.click();
  await expect(firstQuote).toHaveAttribute("aria-pressed", "true");

  await refreshBackgrounds(page);

  const backgroundSection = sectionByHeading(page, "2. Choose Background");
  const firstBackground = backgroundSection.locator("button[aria-label]").first();
  await expect(firstBackground).toBeVisible();
  await firstBackground.click();

  const fontSection = sectionByHeading(page, "3. Choose Font");
  await expect(fontSection).toBeVisible();
  await fontSection.locator("button").first().click();

  await page.getByRole("button", { name: "Save Selection" }).click();
  await expect(page.getByText(/Saved quote #/)).toBeVisible();
}

test("can generate quote, choose background/font, and lock save until regenerate", async ({ page }) => {
  await clearHistory(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Generate \d+ Quotes/ }).click();

  const quoteSection = sectionByHeading(page, "1. Choose a Quote");
  const firstQuote = quoteSection.locator("button").first();
  await expect(firstQuote).toBeVisible();
  await firstQuote.click();
  await expect(firstQuote).toHaveAttribute("aria-pressed", "true");
  await refreshBackgrounds(page);

  const backgroundSection = sectionByHeading(page, "2. Choose Background");
  await expect(backgroundSection).toBeVisible();
  const firstBackground = backgroundSection.locator("button[aria-label]").first();
  await expect(firstBackground).toBeVisible();
  await firstBackground.click();

  const fontSection = sectionByHeading(page, "3. Choose Font");
  await expect(fontSection).toBeVisible();
  await fontSection.getByRole("button", { name: /Oswald/i }).click();

  await page.getByRole("button", { name: "Full Screen" }).click();
  const generateOverlay = page.getByRole("dialog", { name: "Presentation overlay" });
  await expect(generateOverlay).toBeVisible();
  await generateOverlay.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Presentation overlay" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save Selection" }).click();
  await expect(page.getByText(/Saved quote #/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved For This Round" })).toBeDisabled();

  await page.getByRole("button", { name: /Generate \d+ Quotes/ }).click();
  await quoteSection.locator("button").first().click();
  await backgroundSection.locator("button[aria-label]").first().click();
  await fontSection.getByRole("button", { name: /Oswald/i }).click();

  await expect(page.getByRole("button", { name: "Save Selection" })).toBeEnabled();
});

test("settings allows configuring default font and counts", async ({ page }) => {
  await clearHistory(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();

  await page.locator("#quote-count").fill("4");
  await page.locator("#background-count").fill("6");
  await page.locator("#default-font").selectOption("jetbrains-mono");
  await page.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.getByText("Settings updated.")).toBeVisible();

  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: /Generate \d+ Quotes/ }).click();

  const quoteSection = sectionByHeading(page, "1. Choose a Quote");
  const firstQuote = quoteSection.locator("button").first();
  await firstQuote.click();
  await expect(firstQuote).toHaveAttribute("aria-pressed", "true");
  await refreshBackgrounds(page);

  const backgroundSection = sectionByHeading(page, "2. Choose Background");
  await expect(backgroundSection).toBeVisible();
  await backgroundSection.locator("button[aria-label]").first().click();

  const selectedFontButton = page
    .getByRole("heading", { name: "3. Choose Font" })
    .locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: /JetBrains Mono/i });

  await expect(selectedFontButton).toHaveAttribute("aria-pressed", "true");
});

test("history supports fullscreen, deleting one entry, and clearing all entries", async ({ page }) => {
  await clearHistory(page);
  await page.goto("/");

  await generateAndSaveSelection(page);
  await generateAndSaveSelection(page);

  await page.getByRole("button", { name: "History" }).click();

  const entries = page.locator("[data-history-entry]");
  await expect(entries).toHaveCount(2);

  const firstEntry = entries.first();
  await firstEntry.getByRole("button", { name: /Full Screen entry #/ }).click();
  const historyOverlay = page.getByRole("dialog", { name: "Presentation overlay" });
  await expect(historyOverlay).toBeVisible();
  await historyOverlay.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Presentation overlay" })).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await firstEntry.getByRole("button", { name: /Delete entry #/ }).click();
  await expect(entries).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete All History" }).click();
  await expect(page.getByText("No quotes saved yet.")).toBeVisible();
});
