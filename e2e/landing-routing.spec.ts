import { expect, test } from "@playwright/test";

test("root (/) renders landing for new/unauthenticated visitors", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Tu mente/i })).toBeVisible();
  await expect(page.getByTestId("button-header-login")).toBeVisible();
  await expect(page.getByTestId("button-header-signup")).toBeVisible();
  await expect(page.getByTestId("input-landing-search")).toBeVisible();
});

test("/welcome landing still renders and primary CTAs are available", async ({ page }) => {
  await page.goto("/welcome");

  await expect(page.getByRole("heading", { name: /Tu mente/i })).toBeVisible();
  await expect(page.getByTestId("button-header-login")).toBeVisible();
  await expect(page.getByTestId("button-header-signup")).toBeVisible();
  await expect(page.getByTestId("input-landing-search")).toBeVisible();
});

test("landing search CTA routes to login", async ({ page }) => {
  await page.goto("/welcome");

  await page.getByTestId("input-landing-search").fill("hola");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /Bienvenido/i })).toBeVisible();
});

test("login close button routes back to welcome landing", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: /Bienvenido/i })).toBeVisible();
  await expect(page.getByTestId("button-close-login")).toBeVisible();
  await page.getByTestId("button-close-login").click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: /Tu mente/i })).toBeVisible();
});

test("signup close button routes back to welcome landing", async ({ page }) => {
  await page.goto("/signup");

  const closeSignupButton = page.locator(
    '[data-testid="button-close-signup"], [data-testid="button-close-signup-disabled"]',
  );
  await expect(closeSignupButton.first()).toBeVisible();
  await closeSignupButton.first().click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: /Tu mente/i })).toBeVisible();
});
