import { expect, test } from "@playwright/test";

const pagesUrl = new URL("../../docs/index.html", import.meta.url).href;

test("GitHub Pages用サイトがデスクトップとモバイルで表示できる", async ({
  page
}) => {
  await page.goto(pagesUrl);
  await expect(
    page.getByRole("heading", { name: "政策文書から、 検証できる説明へ。" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "生成を、確認の後に置く。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub ↗" })).toHaveAttribute(
    "href",
    "https://github.com/maas-creative/PolicyGOS"
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".record-sheet")).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
});
