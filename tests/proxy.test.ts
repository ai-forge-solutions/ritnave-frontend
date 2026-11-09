import { describe, it, expect, vi } from 'vitest';
import { makeProxy } from '../src/lib/proxy';
describe('private processing bridge', () => {
 it('rejects unauthenticated callers before minting IAM or fetching upstream', async () => {
  const iam = vi.fn(); const upstream = vi.fn();
  const proxy = makeProxy({ session: async () => { throw Object.assign(new Error('Sesión requerida'), {status:401}); }, config: () => ({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}), iam, fetch: upstream });
  const response = await proxy(new Request('https://web.example/api/jobs/'+'a'.repeat(64)), ['a'.repeat(64)]);
  expect(response.status).toBe(401); expect(iam).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
 });
 it('keeps signed user identity separate from server IAM and ignores client identity headers', async () => {
  const id='a'.repeat(64);
  const upstream=vi.fn(async (_url:unknown,_options?:RequestInit) => {void _url;void _options;return Response.json({id,status:'running',owner:'must-not-leak'});});
  const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'alice@example.com'},idToken:'SIGNED_FIREBASE',cookie:'rotated-cookie'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam:async()=> 'Bearer SERVER_IAM',fetch:upstream as typeof fetch});
  const response=await proxy(new Request('https://web.example/api/jobs/'+id,{headers:{Authorization:'Bearer attacker','X-Owner':'bob'}}),[id]);
  expect(response.status).toBe(200);expect(await response.json()).toEqual({id,status:'running',files:[]});
  expect(upstream.mock.calls[0][0]).toBe('https://private.run.app/jobs/'+id);
  const headers=new Headers(upstream.mock.calls[0][1]?.headers);
  expect(headers.get('Authorization')).toBe('Bearer SIGNED_FIREBASE');expect(headers.get('X-Serverless-Authorization')).toBe('Bearer SERVER_IAM');expect(headers.get('X-Owner')).toBeNull();
  expect(response.headers.get('set-cookie')).toBe('rotated-cookie');expect(response.headers.get('cache-control')).toContain('no-store');
 });
 const alice={user:{id:'alice',email:'alice@example.com'},idToken:'FIREBASE'};
 const cfg=()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'});
 const json=(path:string,body:unknown,headers:Record<string,string>={})=>new Request('https://web.example/api/jobs'+path,{method:'POST',headers:{Origin:'https://web.example','Content-Type':'application/json','Idempotency-Key':'same-key',...headers},body:JSON.stringify(body)});
 it('requests a signed PUT with a safe filename and the exact size, never forwarding audio', async()=>{
  const signed='https://storage.googleapis.com/bucket/uploads/x/mi_cancion.wav?X-Goog-Signature=abc';
  const upstream=vi.fn(async(_url:unknown,_options?:RequestInit)=>{void _url;void _options;return Response.json({url:signed,method:'PUT',headers:{'Content-Type':'application/octet-stream','x-goog-content-length-range':'17,17'},expires_in:900});});
  const proxy=makeProxy({session:async()=>alice,config:cfg,iam:async()=>'Bearer IAM',fetch:upstream as typeof fetch});
  const response=await proxy(json('/uploads',{filename:'mi canción.wav',size:17}),['uploads']);
  expect(response.status).toBe(200);
  expect(upstream.mock.calls[0][0]).toBe('https://private.run.app/uploads');
  expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({filename:'mi_cancion.wav',size:17});
  expect(new Headers(upstream.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe('same-key');
  expect(await response.json()).toEqual({url:signed,method:'PUT',headers:{'Content-Type':'application/octet-stream','x-goog-content-length-range':'17,17'},expires_in:900});
 });
 it.each([{url:'https://evil.example/x',headers:{}},{url:'https://storage.googleapis.com/x',headers:{'Authorization':'Bearer leak'}}])('rejects an upstream signed URL outside GCS or with extra headers',async({url,headers})=>{
  const proxy=makeProxy({session:async()=>alice,config:cfg,iam:async()=>'Bearer IAM',fetch:(async()=>Response.json({url,method:'PUT',headers})) as typeof fetch});
  const response=await proxy(json('/uploads',{filename:'a.wav',size:1}),['uploads']);expect(response.status).toBe(503);
 });
 it('admits the staged upload with the same key and maps a missing upload to 409', async()=>{
  const id='b'.repeat(64);
  const upstream=vi.fn(async(_url:unknown,_options?:RequestInit)=>{void _url;void _options;return Response.json({id,status:'queued',owner:'private'},{status:202});});
  const proxy=makeProxy({session:async()=>alice,config:cfg,iam:async()=>'Bearer IAM',fetch:upstream as typeof fetch});
  const response=await proxy(json('',{filename:'mi canción.wav'}),[]);
  expect(response.status).toBe(202);expect(await response.json()).toEqual({id,status:'queued',files:[]});
  expect(upstream.mock.calls[0][0]).toBe('https://private.run.app/jobs');expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({filename:'mi_cancion.wav'});
  const missing=makeProxy({session:async()=>alice,config:cfg,iam:async()=>'Bearer IAM',fetch:(async()=>new Response('{}',{status:404})) as typeof fetch});
  expect((await missing(json('',{filename:'a.wav'}),[])).status).toBe(409);
 });
 it.each([{origin:'https://evil.example',size:1,status:403},{origin:'https://web.example',size:50*1024*1024+1,status:413},{origin:'https://web.example',size:0,status:400}])('rejects unsafe upload before contacting the GPU API: $status',async({origin,size,status})=>{
  const iam=vi.fn();const upstream=vi.fn();const proxy=makeProxy({session:async()=>alice,config:cfg,iam,fetch:upstream});
  const response=await proxy(json('/uploads',{filename:'a.wav',size},{Origin:origin}),['uploads']);
  expect(response.status).toBe(status);expect(iam).not.toHaveBeenCalled();expect(upstream).not.toHaveBeenCalled();
 });
 it('redirects only allowlisted outputs to a signed GCS URL, inline or attachment',async()=>{
  const id='c'.repeat(64);const signed='https://storage.googleapis.com/bucket/jobs/c/outputs/vocals.mp3?X-Goog-Signature=1';
  const upstream=vi.fn(async(_url:unknown)=>{void _url;return Response.json({url:signed,expires_in:600});});
  const proxy=makeProxy({session:async()=>alice,config:cfg,iam:async()=>'Bearer IAM',fetch:upstream as typeof fetch});
  for(const download of [false,true]){
   const response=await proxy(new Request('https://web.example/api/jobs/'+id+'/files/vocals.mp3'+(download?'?download=1':'')),[id,'files','vocals.mp3']);
   expect(response.status).toBe(302);expect(response.headers.get('location')).toBe(signed);expect(response.headers.get('cache-control')).toContain('no-store');
  }
  expect(upstream.mock.calls.map(c=>c[0])).toEqual(['https://private.run.app/jobs/'+id+'/files/vocals.mp3/link','https://private.run.app/jobs/'+id+'/files/vocals.mp3/link?download=1']);
  const bad=await proxy(new Request('https://web.example/api/jobs/'+id+'/files/secret.json'),[id,'files','secret.json']);expect(bad.status).toBe(404);expect(upstream).toHaveBeenCalledTimes(2);
 });
 it('reports upstream IAM failure as unavailable, not as a user login failure, without leaking the upstream HTML',async()=>{
  const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'a@example.com'},idToken:'FIREBASE'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam:async()=>'Bearer IAM',fetch:async()=>new Response('private-infra-token',{status:403})});
  const response=await proxy(new Request('https://web.example/api/jobs/'+'a'.repeat(64)),['a'.repeat(64)]);expect(response.status).toBe(503);expect(await response.text()).not.toContain('private-infra-token');
 });
});
