import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {generateKeyPair,SignJWT} from 'jose';
const key=vi.hoisted(()=>({value:undefined as CryptoKey|undefined}));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>async()=>key.value}));
import {verifyIdToken} from '../src/lib/firebase-auth';
let privateKey:CryptoKey;
beforeAll(async()=>{const keys=await generateKeyPair('RS256');privateKey=keys.privateKey;key.value=keys.publicKey;});
beforeEach(()=>{vi.stubEnv('FIREBASE_AUTH_PROJECT_ID','ritnave-test');vi.stubEnv('FIREBASE_AUTH_TENANT_ID','isolated-tenant');vi.stubEnv('FIREBASE_WEB_API_KEY','test-only-public-key');vi.stubEnv('SESSION_SECRET',Buffer.alloc(32,7).toString('base64url'));vi.stubEnv('APP_ORIGIN','https://web.example');vi.stubEnv('RITNAVE_API_URL','https://private.run.app');});
afterEach(()=>vi.unstubAllEnvs());
async function signed(options:{tenant?:string;issuer?:string;verified?:boolean;expires?:number}={}){
 return new SignJWT({email:'ana@example.com',email_verified:options.verified??true,firebase:{tenant:options.tenant??'isolated-tenant'}}).setProtectedHeader({alg:'RS256'}).setSubject('test-ana').setAudience('ritnave-test').setIssuer(options.issuer??'https://securetoken.google.com/ritnave-test').setIssuedAt().setExpirationTime(options.expires??Math.floor(Date.now()/1000)+120).sign(privateKey);
}
it('verifies a real RSA signature and tenant/verified claims using only a substituted public key source',async()=>{expect((await verifyIdToken(await signed())).user.id).toBe('test-ana');});
it('rejects a tampered actual signature',async()=>{const parts=(await signed()).split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);await expect(verifyIdToken(parts.join('.'))).rejects.toMatchObject({status:401});});
it.each([{tenant:'nutria-other'},{issuer:'https://securetoken.google.com/other-project'},{verified:false},{expires:Math.floor(Date.now()/1000)-10}])('rejects signed but unauthorized/expired Firebase identity %#',async options=>{await expect(verifyIdToken(await signed(options))).rejects.toBeDefined();});
it('dedicated project without tenant: accepts tenant-less tokens and rejects tenant tokens',async()=>{
 vi.stubEnv('FIREBASE_AUTH_TENANT_ID','');
 const plain=await new SignJWT({email:'ana@example.com',email_verified:true,firebase:{}}).setProtectedHeader({alg:'RS256'}).setSubject('test-ana').setAudience('ritnave-test').setIssuer('https://securetoken.google.com/ritnave-test').setIssuedAt().setExpirationTime('10m').sign(privateKey);
 expect((await verifyIdToken(plain)).user.id).toBe('test-ana');
 await expect(verifyIdToken(await signed({tenant:'isolated-tenant'}))).rejects.toMatchObject({status:401});
});
