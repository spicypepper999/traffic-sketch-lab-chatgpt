import {test, expect} from '@playwright/test';

test('Firefox boots the graphical game without JavaScript crashes', async ({page}, testInfo) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('#networkBadge')).toContainText('LANES');
  await expect.poll(async () => Number(await page.locator('#nodeStat').innerText())).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator('#laneStat').innerText())).toBeGreaterThan(0);
  await expect(page.locator('#tripStatus')).toContainText('Route found');
  await expect(page.locator('#world')).toBeVisible();
  await expect.poll(async () => page.locator('#world').evaluate(canvas => canvas.width)).toBeGreaterThan(500);
  await testInfo.attach('Firefox overview', {body:await page.screenshot(), contentType:'image/png'});
  expect(errors).toEqual([]);
});

test('Firefox mouse wheel zoom and inspector controls respond', async ({page}) => {
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#networkBadge')).toContainText('LANES');
  const zoom = await page.locator('#zoomText').innerText();
  await page.mouse.move(750, 450);
  await page.mouse.wheel(0, -350);
  await expect.poll(() => page.locator('#zoomText').innerText()).not.toBe(zoom);
  await page.locator('#helpBtn').click();
  await expect(page.locator('#helpBackdrop')).toBeVisible();
  await page.locator('#helpClose').click();
  await expect(page.locator('#helpBackdrop')).toBeHidden();
  await page.locator('#addPair').click();
  await expect(page.locator('#pairList')).toContainText('Pair 2');
  expect(errors).toEqual([]);
});

test('Firefox intersection selection opens on-map traffic controls', async ({page}, testInfo) => {
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#networkBadge')).toContainText('LANES');
  await page.locator('[data-tool="junctions"]').click();
  // Sample map includes a junction at world (-80, 0); initial camera is (0, 0), zoom 1.25.
  const box=await page.locator('#world').boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + box.width/2 - 80*1.25, box.y + box.height/2);
  await expect(page.locator('#inspectorTitle')).toContainText('Intersection');
  await expect(page.locator('#junctionMenu')).toBeVisible();
  await expect(page.locator('#junctionMenu [data-menu="road"]')).not.toHaveCount(0);
  await page.locator('#junctionMenu [data-menu="type"][data-value="priority"]').click();
  await expect(page.locator('#junctionMenu [data-menu="type"][data-value="priority"]')).toHaveClass(/active/);
  await page.locator('#junctionMenu [data-menu="road"]').first().click();
  await expect(page.locator('#junctionMenu [data-menu="road"].priority')).not.toHaveCount(0);
  await testInfo.attach('Priority intersection', {body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);
});
