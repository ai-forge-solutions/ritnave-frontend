import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
const seam = vi.hoisted(()=>({ key:undefined as unknown, error:undefined as Error|undefined }));
vi.mock('jose',async original => ({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>()=>{ if(seam.error) throw seam.error; return seam.key; }}));
import { verifyIdToken, firebaseRequest, refreshIdToken } from '../src/lib/firebase-auth';
beforeEach(()=>{
  for(const [k,v] of Object.entries({FIREBASE_AUTH_PROJECT_ID:'project',FIREBASE_AUTH_TENANT_ID:'tenant',FIREBASE_WEB_API_KEY:'key',SESSION_SECRET:Buffer.alloc(32,7).toString('base64url'),APP_ORIGIN:'https://app.example',RITNAVE_API_URL:'https://api.example'})) vi.stubEnv(k,v);
});
afterEach(()=>{seam.error=undefined;vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('reports JWKS infrastructure failure as unavailable rather than logged out',async()=>{
 const {privateKey}=await generateKeyPair('RS256');
 const token=await new SignJWT({}).setProtectedHeader({alg:'RS256'}).sign(privateKey);
 seam.error=new TypeError('fetch failed: internal secret');
 await expect(verifyIdToken(token)).rejects.toMatchObject({status:503,message:'Autenticación no disponible'});
});
it('cryptographically verifies project, issuer, tenant, email and RS256 signature',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'); seam.key=publicKey;
 const token = (claims:Record<string,unknown>={})=>new SignJWT({sub:'uid',aud:'project',iss:'https://securetoken.google.com/project',email:'a@example.com',email_verified:true,firebase:{tenant:'tenant'},...claims}).setExpirationTime('1h').setProtectedHeader({alg:'RS256'}).sign(privateKey);
 expect((await verifyIdToken(await token())).user.id).toBe('uid');
 for(const claims of [{firebase:{tenant:'other'}},{email_verified:false},{email:'bad'},{aud:'other'},{iss:'wrong'}]) await expect(verifyIdToken(await token(claims))).rejects.toMatchObject({status:expect.any(Number)});
 await expect(verifyIdToken('fake')).rejects.toMatchObject({status:401});
});
it('scopes REST and refresh calls and sanitizes provider errors',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({idToken:'id',refreshToken:'r'})); vi.stubGlobal('fetch',fetcher);
 await firebaseRequest('signInWithPassword',{email:'a@example.com',password:'password'});
 const [url,init]=fetcher.mock.calls[0]; expect(url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=key'); expect(JSON.parse(init.body).tenantId).toBe('tenant'); expect(init.signal).toBeDefined();
 fetcher.mockResolvedValueOnce(Response.json({id_token:'new',refresh_token:'rotated'}));
 expect(await refreshIdToken('refresh')).toEqual({idToken:'new',refreshToken:'rotated'});
 expect(fetcher.mock.calls[1][0]).toBe('https://securetoken.googleapis.com/v1/token?key=key'); expect(String(fetcher.mock.calls[1][1].body)).toContain('grant_type=refresh_token');
 fetcher.mockResolvedValueOnce(Response.json({error:{message:'INVALID_PASSWORD: secret'}},{status:400})); await expect(firebaseRequest('signInWithPassword',{})).rejects.toMatchObject({status:401,message:'Credenciales no válidas'});
});
