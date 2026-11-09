import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const provider = vi.hoisted(()=>({ firebaseRequest:vi.fn(),verifyIdToken:vi.fn(),refreshIdToken:vi.fn() }));
vi.mock('../src/lib/firebase-auth',()=>provider);
import { GET, POST } from '../src/app/api/auth/[action]/route';
import { requireSession } from '../src/lib/auth';
import { createSession } from '../src/lib/session';
import { AppError } from '../src/lib/errors';
const user={id:'uid',email:'a@example.com',name:'Ana'};
const expires=()=>Math.floor(Date.now()/1000)+3600;
const context=(action:string)=>({params:Promise.resolve({action})});
const post=(action:string,body:unknown={},headers:Record<string,string>={})=>POST(new Request('https://app.example/api/auth/'+action,{method:'POST',headers:{origin:'https://app.example','content-type':'application/json',...headers},body:JSON.stringify(body)}),context(action));
beforeEach(()=>{
 for(const [k,v] of Object.entries({FIREBASE_AUTH_PROJECT_ID:'project',FIREBASE_AUTH_TENANT_ID:'tenant',FIREBASE_WEB_API_KEY:'key',SESSION_SECRET:Buffer.alloc(32,7).toString('base64url'),APP_ORIGIN:'https://app.example',RITNAVE_API_URL:'https://api.example'})) vi.stubEnv(k,v);
 vi.resetAllMocks(); provider.firebaseRequest.mockResolvedValue({idToken:'id',refreshToken:'refresh'}); provider.verifyIdToken.mockImplementation(async()=>({user,expiresAt:expires()}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
it('logs in with encrypted cookie, returns me and clears logout',async()=>{
 const login=await post('login',{email:user.email,password:'password1'}); expect(login.status).toBe(200); expect(await login.json()).toEqual({user});
 const cookie=login.headers.get('set-cookie')!; expect(cookie).toContain('HttpOnly');
 const me=await GET(new Request('https://app.example/api/auth/me',{headers:{cookie:cookie.split(';')[0]}}),context('me')); expect(await me.json()).toEqual({user});
 expect((await post('logout')).headers.get('set-cookie')).toContain('Max-Age=0');
});
it('fails closed on missing configuration and missing sessions',async()=>{
 expect(await (await GET(new Request('https://app.example/api/auth/me'),context('me'))).json()).toEqual({user:null});
 await expect(requireSession(new Request('https://app.example'))).rejects.toMatchObject({status:401});
 vi.stubEnv('FIREBASE_WEB_API_KEY',''); expect((await post('login',{email:user.email,password:'password1'})).status).toBe(503);
});
it('rejects CSRF and malformed or oversized JSON before provider calls',async()=>{
 for(const headers of [{origin:'https://evil.example'},{origin:''},{'sec-fetch-site':'cross-site'}] as Record<string,string>[]) expect((await post('login',{},headers)).status).toBe(403);
 for(const body of [{email:'bad',password:'password1'},{email:user.email,password:'short'},[],{email:user.email,password:'x'.repeat(129)}]) expect((await post('login',body)).status).toBe(400);
 expect((await post('signup',{email:user.email,password:'password1',name:'x'.repeat(101)})).status).toBe(400);
 expect((await post('login',{pad:'x'.repeat(17000)})).status).toBe(413);
 expect((await POST(new Request('https://app.example',{method:'POST',headers:{origin:'https://app.example','content-type':'application/json'},body:'{' }),context('login'))).status).toBe(400);
 expect(provider.firebaseRequest).not.toHaveBeenCalled();
});
it('signup sends verification but never creates session; login rejects unverified',async()=>{
 const response=await post('signup',{email:user.email,password:'password1',name:'Ana'});
 expect(await response.json()).toEqual({requiresEmailConfirmation:true}); expect(response.headers.get('set-cookie')).toBeNull();
 expect(provider.firebaseRequest).toHaveBeenLastCalledWith('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:'id',continueUrl:'https://app.example/login'});
 provider.verifyIdToken.mockRejectedValue(new AppError(403,'Confirma tu correo','EMAIL_NOT_VERIFIED'));
 const login=await post('login',{email:user.email,password:'password1'}); expect(login.status).toBe(403); expect(login.headers.get('set-cookie')).toBeNull();
});
it('password reset hides unknown emails and OOB handlers require codes',async()=>{
 provider.firebaseRequest.mockRejectedValueOnce(new AppError(401,'Credenciales no válidas','EMAIL_NOT_FOUND'));
 expect(await (await post('reset',{email:user.email})).json()).toEqual({ok:true});
 expect((await post('update-password',{password:'password1'})).status).toBe(400);
 expect((await post('update-password',{password:'password1',oobCode:'code'})).status).toBe(200);
 expect(provider.firebaseRequest).toHaveBeenLastCalledWith('resetPassword',{newPassword:'password1',oobCode:'code'});
 expect((await post('verify-email',{oobCode:'code'})).status).toBe(200);
 expect(provider.firebaseRequest).toHaveBeenLastCalledWith('update',{oobCode:'code'});
});
it('refreshes expired ID token without extending cookie hard deadline; rejects owner change',async()=>{
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
 const hard=Math.floor(Date.now()/1000)+3600;
 const cookie=await createSession({user,idToken:'old',refreshToken:'refresh',tokenExpiresAt:1},hard);
 const req=new Request('https://app.example',{headers:{cookie:cookie.split(';')[0]}});
 provider.refreshIdToken.mockResolvedValue({idToken:'new',refreshToken:'rotated'});
 const session=await requireSession(req); expect(session.idToken).toBe('new'); expect(session.cookie).toContain('Max-Age=3600');
 provider.verifyIdToken.mockResolvedValue({user:{...user,id:'other'},expiresAt:expires()});
 await expect(requireSession(req)).rejects.toMatchObject({status:401});
 vi.advanceTimersByTime(3601*1000); provider.refreshIdToken.mockClear();
 await expect(requireSession(req)).rejects.toMatchObject({status:401}); expect(provider.refreshIdToken).not.toHaveBeenCalled();
});
