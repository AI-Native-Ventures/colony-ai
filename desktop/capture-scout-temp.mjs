import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const b=await chromium.launch();const p=await b.newPage({reducedMotion:'reduce'});
await p.goto('http://127.0.0.1:5334/20260930-onboarding-scout-r4/reference/app/onboarding/index.html#account');
await p.locator('.scout-ant svg').waitFor();
const svg=await p.locator('.scout-ant svg').evaluate(el=>el.outerHTML);
await fs.writeFile('src/features/onboarding/assets/scout.svg',svg);
await b.close();
