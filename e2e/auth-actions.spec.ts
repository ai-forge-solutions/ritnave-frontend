import {test,expect} from '@playwright/test';
test.describe('auth action wiring — provider mocked',()=>{
 test('forms never submit passwords through a native GET URL',async({page})=>{await page.goto('/login');await expect(page.locator('form')).toHaveAttribute('method','post');});
 test('password recovery forwards the emailed action code, not just a password',async({page})=>{
  let body:Record<string,string>={};await page.route('**/api/auth/update-password',r=>{body=r.request().postDataJSON();return r.fulfill({json:{ok:true}});});
  await page.goto('/actualizar-password?oobCode=controlled-test-code');await page.getByLabel('Contraseña',{exact:true}).fill('new-test-password');await page.getByRole('button',{name:'Guardar contraseña',exact:true}).click();await expect(page.getByRole('status')).toContainText('Contraseña actualizada');expect(body.oobCode).toBe('controlled-test-code');
 });
 test('unverified login offers a real resend action and never enters the studio',async({page})=>{
  await page.route('**/api/auth/login',r=>r.fulfill({status:403,json:{error:'Confirma tu correo electrónico',code:'EMAIL_NOT_VERIFIED'}}));let resends=0;
  await page.route('**/api/auth/resend-verification',r=>{resends++;return r.fulfill({json:{requiresEmailConfirmation:true}});});
  await page.goto('/login');await page.getByLabel('Correo electrónico').fill('ana@example.com');await page.getByLabel('Contraseña',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('button',{name:'Reenviar verificación'}).click();await expect(page.getByRole('status')).toContainText('Revisa tu correo');expect(resends).toBe(1);expect(page.url()).toContain('/login');
 });
});
