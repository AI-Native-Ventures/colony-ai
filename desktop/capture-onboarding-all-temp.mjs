import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { ONBOARDING_SCENE_IDS } from './src/features/onboarding/ui/onboardingScenes.ts';
import { waitForAnimations } from './tests/helpers/animations.ts';
const browser=await chromium.launch();
const out='/tmp/colony-onboarding-design-proof';await fs.mkdir(out,{recursive:true});
const records=[];
for(const width of [1728,1440]){
 const viewport={width,height:width===1728?1117:900};
 const ref=await browser.newPage({viewport,reducedMotion:'reduce'});
 const app=await browser.newPage({viewport,reducedMotion:'reduce'});
 for(const scene of ONBOARDING_SCENE_IDS.filter(s=>!['workspace','history','history-review'].includes(s))){
  await ref.goto(`http://127.0.0.1:5334/20260930-onboarding-scout-r4/reference/app/onboarding/index.html?capture=${scene}#${scene}`);
  await ref.locator('.scout-guide').waitFor();
  // Strip review-only chrome and fit the product canvas to a native window.
  await ref.evaluate((css) => { const sheet = [...document.styleSheets].find(s => s.href?.endsWith('scout-presence.css')); for(const rule of css.split('}').filter(x=>x.trim()))sheet.insertRule(rule+'}',sheet.cssRules.length); },'.reviewbar,.reviewfoot,.otp-review-note,.skip{display:none!important}html,body{margin:0;padding:0;height:100vh;overflow:hidden}#app.app-frame{margin:0;width:100vw;height:100vh;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none}.windowbar{display:none}.setup{height:100vh}');
  await app.goto(`http://127.0.0.1:5335/tests/visual/onboarding.html?scene=${scene}`);
  await app.locator('.scout-guide').waitFor();
  for(const [kind,page] of [['reference',ref],['presentation',app]]){
   await page.evaluate(()=>document.fonts.ready);
   await waitForAnimations(page,150);
   await page.screenshot({path:`${out}/${kind}-${scene}-${width}.png`});
  }
  const reference=await ref.locator('.story-main').innerText();
  const presentation=await app.locator('.story-main').innerText();
  records.push({scene,width,reference,presentation,copyMatch:reference===presentation});
 }
 await ref.close();await app.close();
}
await fs.writeFile(`${out}/scene-comparison.json`,JSON.stringify(records,null,2));
console.log(JSON.stringify({pairs:records.length,copyMismatch:records.filter(x=>!x.copyMatch).map(x=>({scene:x.scene,width:x.width,reference:x.reference,presentation:x.presentation}))}));
await browser.close();
