import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {generateKeyPair,SignJWT,jwtVerify} from 'jose';
import {createHash} from 'node:crypto';
const seam=vi.hoisted(()=>({key:undefined as CryptoKey|undefined,iam:vi.fn()}));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>async()=>seam.key}));
vi.mock('google-auth-library',()=>({GoogleAuth:class{async getIdTokenClient(){return {getRequestHeaders:async()=>{seam.iam();return new Headers({Authorization:'Bearer CONTROLLED_IAM'});}};}}}));
import {POST as authPost,GET as authGet} from '../src/app/api/auth/[action]/route';
import {POST as jobsPost,GET as jobsGet} from '../src/app/api/jobs/[[...path]]/route';
let privateKey:CryptoKey;let publicKey:CryptoKey;
beforeAll(async()=>{const keys=await generateKeyPair('RS256');privateKey=keys.privateKey;publicKey=keys.publicKey;seam.key=publicKey;});
beforeEach(()=>{vi.stubEnv('FIREBASE_AUTH_PROJECT_ID','ritnave-test');vi.stubEnv('FIREBASE_AUTH_TENANT_ID','isolated-tenant');vi.stubEnv('FIREBASE_WEB_API_KEY','public-test-key');vi.stubEnv('SESSION_SECRET',Buffer.alloc(32,13).toString('base64url'));vi.stubEnv('APP_ORIGIN','https://web.example');vi.stubEnv('RITNAVE_API_URL','https://private.run.app');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const authContext=(action:string)=>({params:Promise.resolve({action})});
const jobContext=(path:string[]=[])=>({params:Promise.resolve({path})});
function post(url:string,body:unknown,cookie?:string){return new Request('https://web.example'+url,{method:'POST',headers:{Origin:'https://web.example','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
it('runs real auth handlers, RSA verification, encrypted cookies and job route bridge across two isolated users (external services substituted)',async()=>{
 const jobs=new Map<string,string>();let observedOwner='';
 const token=async(uid:string)=>new SignJWT({email:uid+'@example.com',email_verified:true,firebase:{tenant:'isolated-tenant'}}).setSubject(uid).setAudience('ritnave-test').setIssuer('https://securetoken.google.com/ritnave-test').setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime('5m').sign(privateKey);
 vi.stubGlobal('fetch',async(input:string|URL|Request,options?:RequestInit)=>{
  const url=String(input);
  if(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword')){const body=JSON.parse(String(options?.body));expect(body.tenantId).toBe('isolated-tenant');const uid=body.email.startsWith('bob')?'bob':'alice';return Response.json({idToken:await token(uid),refreshToken:'controlled-refresh-token'});}
  expect(url.startsWith('https://private.run.app/jobs')).toBe(true);
  const h=new Headers(options?.headers);expect(h.get('X-Serverless-Authorization')).toBe('Bearer CONTROLLED_IAM');
  const verified=await jwtVerify(h.get('Authorization')!.slice(7),publicKey,{audience:'ritnave-test',issuer:'https://securetoken.google.com/ritnave-test'});const uid=verified.payload.sub!;observedOwner=uid;
  if(options?.method==='POST'){await new Response(options.body).arrayBuffer();const id=createHash('sha256').update(uid+h.get('Idempotency-Key')).digest('hex');jobs.set(id,uid);return Response.json({id,status:'succeeded',files:['vocals.wav','instrumental.wav','vocals.mp3','instrumental.mp3']},{status:202});}
  const id=new URL(url).pathname.split('/')[2];if(jobs.get(id)!==uid)return Response.json({error:'not found'},{status:404});
  if(url.includes('/files/'))return new Response('controlled-media-contract',{headers:{'Content-Type':'audio/mpeg'}});
  return Response.json({id,status:'succeeded',files:[]});
 });
 const login=async(email:string)=>{const result=await authPost(post('/api/auth/login',{email,password:'test-password'}),authContext('login'));expect(result.status).toBe(200);const body=await result.json();expect(body).not.toHaveProperty('idToken');return result.headers.get('set-cookie')!.split(';')[0];};
 const alice=await login('alice@example.com');const bob=await login('bob@example.com');
 const upload=new Request('https://web.example/api/jobs?filename=demo.wav',{method:'POST',headers:{Origin:'https://web.example',Cookie:alice,'Content-Type':'application/octet-stream','Idempotency-Key':'stable-test-key'},body:'controlled-upload-contract'});
 const admitted=await jobsPost(upload,jobContext());expect(admitted.status).toBe(202);const {id}=await admitted.json();expect(observedOwner).toBe('alice');
 const denied=await jobsGet(new Request('https://web.example/api/jobs/'+id,{headers:{Cookie:bob}}),jobContext([id]));expect(denied.status).toBe(404);
 const download=await jobsGet(new Request('https://web.example/api/jobs/'+id+'/files/vocals.mp3?download=1',{headers:{Cookie:alice}}),jobContext([id,'files','vocals.mp3']));expect(download.status).toBe(200);expect(await download.text()).toBe('controlled-media-contract');expect(download.headers.get('Content-Disposition')).toContain('attachment');expect(seam.iam).toHaveBeenCalled();
 const logout=await authPost(post('/api/auth/logout',{},alice),authContext('logout'));expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
 const me=await authGet(new Request('https://web.example/api/auth/me'),authContext('me'));expect(await me.json()).toEqual({user:null});
});
