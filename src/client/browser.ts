import { chromium } from 'playwright';
import env from '../utils/env';
(async () => {
  // Setup
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Block external images
  await context.route('**.jpg', route => route.abort());
  await context.route('**.png', route => route.abort());
  await context.route('**.gif', route => route.abort());
  await context.route('**.webp', route => route.abort());
  await context.route('**.svg', route => route.abort());
  await context.route('**.ico', route => route.abort());
  
  // Login
  await page.goto('https://www.instagram.com/');
  await page.fill('input[name="username"]', env.INSTAGRAM_USERNAME);
  await page.fill('input[name="password"]', env.INSTAGRAM_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for login to complete
  await page.waitForNavigation({ waitUntil: 'networkidle' });

  // Go to profile
  await page.goto(`https://www.instagram.com/${env.INSTAGRAM_USERNAME}/`);

  // Teardown
  await context.close();
  await browser.close();
})();