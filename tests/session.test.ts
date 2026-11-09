import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/lib/config';
import { errorResponse } from '../src/lib/errors';


const input = { user: { id:'uid',email:'a@example.com' }, idToken:'id-secret', refreshToken:'refresh-secret', tokenExpiresAt: Math.floor(Date.now()/1000)+3600 };
const request = (cookie:string) => new Request('https://app.example',{headers:{cookie:cookie.split(';')[0]}});
it('encrypts, authenticates and expires cookies with secure attributes', async () => {
  const { createSession, readSession, clearSessionCookie } = await import('../src/lib/session');
  const cookie = await createSession(input);
  expect(cookie).toContain('__Host-ritnave_session=');
  for (const part of ['HttpOnly','Secure','SameSite=Lax','Path=/']) expect(cookie).toContain(part);
  expect(cookie).not.toContain('refresh-secret');
  expect((await readSession(request(cookie))).user.id).toBe('uid');
  await expect(readSession(request(cookie.replace(/session=./,'session=X')))).rejects.toMatchObject({status:401});
  await expect(readSession(request(''))).rejects.toMatchObject({status:401});
  await expect(readSession(request('__Host-ritnave_session='+'x'.repeat(5000)))).rejects.toMatchObject({status:401});
  expect(clearSessionCookie()).toContain('Max-Age=0');
  vi.useFakeTimers(); vi.advanceTimersByTime(8*86400*1000);
  await expect(readSession(request(cookie))).rejects.toMatchObject({status:401});
});

beforeEach(() => {
  vi.stubEnv('FIREBASE_AUTH_PROJECT_ID','project'); vi.stubEnv('FIREBASE_AUTH_TENANT_ID','tenant');
  vi.stubEnv('FIREBASE_WEB_API_KEY','key'); vi.stubEnv('SESSION_SECRET',Buffer.alloc(32,7).toString('base64url'));
  vi.stubEnv('APP_ORIGIN','https://app.example'); vi.stubEnv('RITNAVE_API_URL','https://api.example');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it('allows insecure localhost only in explicit development or test mode', () => {
  vi.stubEnv('APP_ORIGIN','http://localhost:3000'); vi.stubEnv('NODE_ENV','test'); expect(getConfig().appOrigin).toBe('http://localhost:3000');
  vi.stubEnv('NODE_ENV','production'); expect(getConfig).toThrow();
  vi.stubEnv('NODE_ENV',''); expect(getConfig).toThrow();
});
describe('server config', () => {
  it('accepts an explicit tenant or none, rejects invalid ones and never exposes raw errors', async () => {
    expect(getConfig().tenantId).toBe('tenant');
    vi.stubEnv('FIREBASE_AUTH_TENANT_ID','');
    expect(getConfig().tenantId).toBeUndefined();
    for (const bad of ['default',' tenant','a/b']) { vi.stubEnv('FIREBASE_AUTH_TENANT_ID',bad); expect(getConfig).toThrow(); }
    try { getConfig(); } catch (e) { expect(errorResponse(e).status).toBe(503); }
    expect(await errorResponse(new Error('secret')).text()).not.toContain('secret');
  });
  it('rejects invalid secret, unsafe origins and API paths', () => {
    for (const [key,value] of [['SESSION_SECRET','bad'],['APP_ORIGIN','http://app.example'],['RITNAVE_API_URL','https://api.example/path']]) {
      const original = process.env[key]; vi.stubEnv(key,value); expect(getConfig).toThrow(); vi.stubEnv(key,original!);
    }
  });
});
