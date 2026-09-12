import { expect, test } from "@playwright/test";

test("production card master smoke is read-only and healthy", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", error => pageErrors.push(error));
  const response = await page.goto("https://loveca-card-list.pages.dev/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByLabel("登録カード総数")).toContainText("1817");
  await expect(page.getByText("メンバー 1526 · ライブ 291")).toBeVisible();
  for (const category of ["すべて 1817", "μ's 271", "Aqours 305", "虹ヶ咲 454", "Liella! 483", "蓮ノ空 295", "その他 22"]) {
    await expect(page.getByRole("button", { name: category, exact: true })).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});
