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
 it('streams upload with the same retry key and a safe filename without exposing service credentials', async()=>{
  const id='b'.repeat(64);let sent='';
  const upstream=vi.fn(async(_url:unknown,options?:RequestInit)=>{sent=await new Response(options?.body).text();return Response.json({id,status:'queued',owner:'private'},{status:202});});
  const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'alice@example.com'},idToken:'FIREBASE'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam:async()=>'Bearer IAM',fetch:upstream as typeof fetch});
  const request=new Request('https://web.example/api/jobs?filename=mi%20canci%C3%B3n.wav',{method:'POST',headers:{Origin:'https://web.example','Content-Type':'application/octet-stream','Idempotency-Key':'same-key'},body:'RIFFcontract-only'});
  const response=await proxy(request,[]);expect(response.status).toBe(202);expect(sent).toBe('RIFFcontract-only');expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream.mock.calls[0][0]).toBe('https://private.run.app/jobs?filename=mi_cancion.wav');expect(new Headers(upstream.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe('same-key');
  expect(await response.json()).toEqual({id,status:'queued',files:[]});
 });
 it.each([{origin:'https://evil.example',size:'1',status:403},{origin:'https://web.example',size:String(30*1024*1024+1),status:413}])('rejects unsafe upload before contacting the GPU API: $status',async({origin,size,status})=>{
  const iam=vi.fn();const upstream=vi.fn();const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'a@example.com'},idToken:'FIREBASE'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam,fetch:upstream});
  const response=await proxy(new Request('https://web.example/api/jobs?filename=a.wav',{method:'POST',headers:{Origin:origin,'Content-Length':size,'Content-Type':'application/octet-stream','Idempotency-Key':'same'},body:'a'}),[]);
  expect(response.status).toBe(status);expect(iam).not.toHaveBeenCalled();expect(upstream).not.toHaveBeenCalled();
 });
 it('streams only allowlisted private audio and selects inline or attachment safely',async()=>{
  const id='c'.repeat(64);const upstream=vi.fn(async()=>new Response('audio-contract-bytes',{headers:{'Content-Type':'audio/mpeg','Set-Cookie':'evil=secret','Access-Control-Allow-Origin':'*'}}));
  const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'a@example.com'},idToken:'FIREBASE'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam:async()=>'Bearer IAM',fetch:upstream});
  for(const download of [false,true]){
   const response=await proxy(new Request('https://web.example/api/jobs/'+id+'/files/vocals.mp3'+(download?'?download=1':'')),[id,'files','vocals.mp3']);
   expect(response.status).toBe(200);expect(await response.text()).toBe('audio-contract-bytes');expect(response.headers.get('content-disposition')).toContain(download?'attachment':'inline');expect(response.headers.get('set-cookie')).toBeNull();expect(response.headers.get('access-control-allow-origin')).toBeNull();
  }
  const bad=await proxy(new Request('https://web.example/api/jobs/'+id+'/files/secret.json'),[id,'files','secret.json']);expect(bad.status).toBe(404);expect(upstream).toHaveBeenCalledTimes(2);
 });
 it('reports upstream IAM failure as unavailable, not as a user login failure, without leaking the upstream HTML',async()=>{
  const proxy=makeProxy({session:async()=>({user:{id:'alice',email:'a@example.com'},idToken:'FIREBASE'}),config:()=>({apiUrl:'https://private.run.app',appOrigin:'https://web.example'}),iam:async()=>'Bearer IAM',fetch:async()=>new Response('private-infra-token',{status:403})});
  const response=await proxy(new Request('https://web.example/api/jobs/'+'a'.repeat(64)),['a'.repeat(64)]);expect(response.status).toBe(503);expect(await response.text()).not.toContain('private-infra-token');
 });
});
