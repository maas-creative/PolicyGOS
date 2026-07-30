import { expect, test } from "@playwright/test";

const pagesUrl = new URL("../../docs/index.html", import.meta.url).href;

test("GitHub Pages用サイトがデスクトップとモバイルで表示できる", async ({
  page
}) => {
  await page.goto(pagesUrl);
  await expect(
    page.getByRole("heading", { name: "政策文書を、 根拠とともに読める形へ。" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "生成する前に、根拠を確かめる。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHubで見る" })).toHaveAttribute(
    "href",
    "https://github.com/ukyonagata0105/PolicyGOS"
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".workspace-preview")).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
});
