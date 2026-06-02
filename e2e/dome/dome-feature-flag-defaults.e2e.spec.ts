import { test, expect } from '@playwright/test';

test.describe('DOME Feature Flags - AC-09', () => {
  test('AC-09 - FeatureFlagsService defaults OFF', async ({ page }) => {

    await page.goto('https://dome.127.0.0.1.nip.io:4443/wallet/');

    const values = await page.evaluate(() => {

      const env = (window as any).env ?? {};
      const isDomeAutoRecoveryEnabled = env.wallet?.dome?.auto_recovery?.enabled === true;
      const isDomeModeServerEnabled = env.wallet?.dome?.mode_server === true;

      return {
        isDomeAutoRecoveryEnabled,
        isDomeModeServerEnabled
      };
    });
    
    expect(values.isDomeAutoRecoveryEnabled).toBe(false);
    expect(values.isDomeModeServerEnabled).toBe(false);
  });
})
