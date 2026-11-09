import { test, expect } from '@playwright/test';

test.describe('UI contracts — mocked API, not live backend', () => {
  test('landing CTA gates studio and stays usable at 375px', async ({ page }) => {
    await page.route('**/api/auth/me', r => r.fulfill({ json: { user: null } }));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Tu audio, en dos pistas/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:'/tmp/ritnave-mobile.png',fullPage:true});
    await page.getByRole('link', { name: 'Separar mi audio', exact: true }).first().click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  });
  test('signup confirmation and visible login API errors', async ({ page }) => {
    await page.route('**/api/auth/signup', r => r.fulfill({ json: { requiresEmailConfirmation: true } }));
    await page.goto('/registro');
    await page.getByLabel('Nombre').fill('Ana');
    await page.getByLabel('Correo electrónico').fill('ana@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('long-password-123');
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revisa tu correo');
    await page.route('**/api/auth/login', r => r.fulfill({ status: 401, json: { error: 'Credenciales incorrectas' } }));
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill('ana@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('bad-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert').filter({hasText:'Credenciales incorrectas'})).toContainText('Credenciales incorrectas');
  });
  test('upload retries same idempotency key then polls real status contract and renders four downloads', async ({ page }) => {
    const id='a'.repeat(64); const keys:string[]=[]; let gets=0;
    // Portable codec fixture for browser media decoding; not a provider result.
    const samples=4410;const wav=Buffer.alloc(44+samples*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(176400,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*4,40);
    await page.route('**/api/jobs/*/files/*',r=>r.fulfill({contentType:'audio/wav',body:wav}));
    await page.route('**/api/auth/me', r=>r.fulfill({json:{user:{id:'user-a',email:'ana@example.com'}}}));
    await page.route('**/api/jobs?*', async r=>{keys.push(r.request().headers()['idempotency-key']);await r.fulfill(keys.length===1?{status:503,json:{error:'ambiguous'}}:{status:202,json:{id,status:'queued'}});});
    await page.route('**/api/jobs/'+id, r=>r.fulfill({json:{id,status:++gets===1?'running':'succeeded'}}));
    await page.goto('/estudio');
    await page.getByLabel('Archivo de audio').setInputFiles({name:'mi-audio.wav',mimeType:'audio/wav',buffer:Buffer.from('RIFFtest')});
    await page.getByRole('button',{name:'Separar audio',exact:true}).click();
    await expect(page.getByText(/misma clave/)).toBeVisible();
    await page.getByRole('button',{name:'Reintentar envío',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Tus pistas'})).toBeVisible({timeout:12000});
    expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[0]).toBe(keys[1]);
    await expect(page.locator('.results audio')).toHaveCount(2);
    await page.locator('.results audio').first().click({position:{x:20,y:20}});
    await expect.poll(()=>page.locator('.results audio').first().evaluate(a=>(a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
    await expect(page.locator('a[href*="download=1"]')).toHaveCount(4);
    await page.screenshot({path:'/tmp/ritnave-studio.png',fullPage:true});
  });
  test('rejects audio over 30 MiB without sending a job', async ({page})=>{
    await page.route('**/api/auth/me', r=>r.fulfill({json:{user:{id:'user-a',email:'ana@example.com'}}}));
    let posts=0;await page.route('**/api/jobs?*',r=>{posts++;return r.abort();});
    await page.goto('/estudio');
    await page.getByLabel('Archivo de audio').setInputFiles({name:'grande.wav',mimeType:'audio/wav',buffer:Buffer.alloc(30*1024*1024+1)});
    await expect(page.getByRole('alert').filter({hasText:'30 MiB'})).toBeVisible();expect(posts).toBe(0);
  });
});
