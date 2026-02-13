import { test, expect } from '@playwright/test';

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUXFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGi0lHyYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6gD/xAAVEAEBAAAAAAAAAAAAAAAAAAABAP/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//9k=';

test('mini computadora virtual mantiene 2cm y abre fullscreen al tocar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
  });

  await page.goto('/');
  await expect(page.getByText('¿En qué puedo ayudarte?')).toBeVisible({ timeout: 20000 });

  await page.waitForFunction(() => !!(window as any).__ILIAGPT_BROWSER_SESSION_DEBUG__, { timeout: 20000 });

  await page.evaluate((tinyJpegBase64) => {
    const debugApi = (window as any).__ILIAGPT_BROWSER_SESSION_DEBUG__;
    if (!debugApi) {
      throw new Error('Debug API de BrowserSession no disponible');
    }

    debugApi.start('Prueba mini pantalla');
    debugApi.update({
      stepNumber: 1,
      totalSteps: 3,
      action: 'navigate',
      reasoning: 'Navegando',
      goalProgress: '33%',
      screenshot: tinyJpegBase64,
      url: 'https://example.com',
      title: 'Example',
    });
  }, TINY_JPEG_BASE64);

  const miniComputer = page.getByTestId('virtual-computer-mini');
  await expect(miniComputer).toBeVisible();

  const miniBounds = await miniComputer.boundingBox();
  expect(miniBounds).not.toBeNull();
  if (!miniBounds) {
    throw new Error('No se pudo obtener bounding box de la mini computadora');
  }

  const cssSize = await miniComputer.evaluate((el) => {
    const styles = window.getComputedStyle(el as HTMLElement);
    return {
      width: parseFloat(styles.width),
      height: parseFloat(styles.height),
    };
  });

  // 2 cm at CSS 96 DPI is ~75.6px. Tolerance keeps the check stable across environments.
  expect(cssSize.width).toBeGreaterThanOrEqual(74);
  expect(cssSize.width).toBeLessThanOrEqual(78);
  expect(cssSize.height).toBeGreaterThanOrEqual(74);
  expect(cssSize.height).toBeLessThanOrEqual(78);

  await miniComputer.click();
  await expect(page.getByTestId('virtual-computer-expanded-overlay')).toBeVisible();
  await expect(page.getByText('Computadora Virtual')).toBeVisible();
});
