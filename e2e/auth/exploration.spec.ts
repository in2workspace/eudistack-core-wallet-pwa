import { test } from '@playwright/test';

test.only('exploration', async ({ page }) => {
  await page.goto('https://dome.127.0.0.1.nip.io:4443/wallet/');
  await page.pause();
});
