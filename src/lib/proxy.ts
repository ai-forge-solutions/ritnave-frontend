/*
 * Server-side bridge to the private processing API. Audio bytes never pass
 * through here: the browser PUTs to / GETs from GCS with short-lived signed
 * URLs that the private API issues only to the verified owner.
 *   POST /api/jobs/uploads {filename,size} -> signed PUT (+ headers to send)
 *   POST /api/jobs {filename}              -> admit the staged upload
 *   GET  /api/jobs/:id                     -> status
 *   GET  /api/jobs/:id/files/:name         -> 302 to a 10-minute signed GET
 */
export type ProxyDeps = {
 session: (request: Request) => Promise<{user:{id:string;email:string;name?:string};idToken:string;cookie?:string}>;
 config: () => {apiUrl:string;appOrigin:string};
 iam: (audience:string) => Promise<string>;
 fetch: typeof fetch;
};
const statuses = new Set(['dispatch_pending','queued','running','succeeded','failed']);
const files = new Set(['vocals.wav','vocals.mp3','instrumental.wav','instrumental.mp3']);
const validId=(id:unknown): id is string => typeof id==='string' && /^[a-f0-9]{64}$/.test(id);
export const MAX_BYTES=50*1024*1024;
const SIGNED_HOST='storage.googleapis.com';
const UPLOAD_HEADERS=new Set(['content-type','x-goog-content-length-range']);
function responseHeaders(cookie?:string) {
 const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex'});
 if(cookie)headers.set('Set-Cookie',cookie);
 return headers;
}
export function safeFilename(value:unknown) {
 if(typeof value!=='string' || value.length>255 || !/\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(value)) return null;
 const dot=value.lastIndexOf('.');
 const stem=value.slice(0,dot).normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9_.-]/g,'_').replace(/\.{2,}/g,'_').replace(/^[^A-Za-z0-9]+/,'').slice(0,180)||'audio';
 return stem+value.slice(dot).toLowerCase();
}
function signedUrl(value:unknown) {
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname===SIGNED_HOST&&!url.username&&!url.password?url.toString():null;}catch{return null;}
}
async function smallJson(request:Request):Promise<Record<string,unknown>|null> {
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return null;
 const text=await request.text();if(text.length>2048)return null;
 try{const data=JSON.parse(text);return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}
}
export function makeProxy(deps: ProxyDeps) {
 return async (request: Request, path: string[]) => {
  let cookie: string|undefined;
  try {
   const session=await deps.session(request);cookie=session.cookie;
   const config=deps.config();const input=new URL(request.url);
   const fail=(status:number,error:string)=>Response.json({error},{status,headers:responseHeaders(cookie)});
   const isAdmit=request.method==='POST'&&path.length===0;
   const isUploadUrl=request.method==='POST'&&path.length===1&&path[0]==='uploads';
   const isFile=request.method==='GET'&&path.length===3&&validId(path[0])&&path[1]==='files'&&files.has(path[2]);
   const isStatus=request.method==='GET'&&path.length===1&&validId(path[0]);
   if(request.method==='POST'&&(request.headers.get('origin')!==config.appOrigin||request.headers.get('sec-fetch-site')==='cross-site')) return fail(403,'Origen no permitido.');
   if(!isAdmit&&!isUploadUrl&&!isFile&&!isStatus)return fail(404,'Ruta no disponible.');
   if([...input.searchParams.keys()].some(k=>!(isFile&&k==='download'))||(isFile&&input.searchParams.has('download')&&input.searchParams.get('download')!=='1'))return fail(400,'Parámetro no válido.');
   const headers=new Headers();
   let target=config.apiUrl+'/jobs';let body:string|undefined;
   if(isAdmit||isUploadUrl){
    const key=request.headers.get('idempotency-key');
    if(!key||key.length>200||!/^[\x21-\x7e]+$/.test(key))return fail(400,'Falta una clave de envío válida.');
    const data=await smallJson(request);if(!data)return fail(400,'Solicitud no válida.');
    const filename=safeFilename(data.filename);if(!filename)return fail(415,'Formato de audio no compatible.');
    if(isUploadUrl){
     const size=data.size;
     if(typeof size!=='number'||!Number.isInteger(size)||size<=0)return fail(400,'El archivo está vacío.');
     if(size>MAX_BYTES)return fail(413,'El archivo supera 50 MiB.');
     target=config.apiUrl+'/uploads';body=JSON.stringify({filename,size});
    }else body=JSON.stringify({filename});
    headers.set('Content-Type','application/json');headers.set('Idempotency-Key',key);
   }else target+='/'+path[0]+(isFile?'/files/'+path[2]+'/link'+(input.searchParams.get('download')==='1'?'?download=1':''):'');
   headers.set('Authorization','Bearer '+session.idToken);headers.set('X-Serverless-Authorization',await deps.iam(config.apiUrl));
   // Admission downloads + probes the staged audio server-side: allow a few minutes.
   const upstream=await deps.fetch(target,{method:request.method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(isAdmit?240000:30000)])});
   if(!upstream.ok){
    if([401,403].includes(upstream.status))return fail(503,'El servidor de procesamiento no está autorizado o configurado.');
    if(isAdmit&&upstream.status===404)return fail(409,'No encontramos el audio subido. Vuelve a enviarlo con la misma clave.');
    return fail(upstream.status,'El servicio no pudo completar la solicitud. Conserva la clave para reintentar.');
   }
   const data=await upstream.json();
   if(isFile){
    const url=signedUrl(data.url);if(!url)throw new Error('Invalid upstream contract');
    const outgoing=responseHeaders(cookie);outgoing.set('Location',url);outgoing.set('Referrer-Policy','no-referrer');
    return new Response(null,{status:302,headers:outgoing});
   }
   if(isUploadUrl){
    const url=signedUrl(data.url);
    const sent=data.headers&&typeof data.headers==='object'?Object.entries(data.headers as Record<string,unknown>):[];
    if(!url||data.method!=='PUT'||sent.some(([k,v])=>!UPLOAD_HEADERS.has(k.toLowerCase())||typeof v!=='string'))throw new Error('Invalid upstream contract');
    return Response.json({url,method:'PUT',headers:Object.fromEntries(sent),expires_in:Number(data.expires_in)||0},{headers:responseHeaders(cookie)});
   }
   if(!validId(data.id)||(isStatus&&data.id!==path[0])||!statuses.has(data.status))throw new Error('Invalid upstream contract');
   const result:Record<string,unknown>={id:data.id,status:data.status,files:Array.isArray(data.files)?data.files.filter((f:unknown)=>typeof f==='string'&&files.has(f)):[]};
   for(const key of ['created_at','updated_at'])if(typeof data[key]==='string')result[key]=data[key];
   return Response.json(result,{status:isAdmit?202:200,headers:responseHeaders(cookie)});
  } catch(error) {
   const status=typeof error==='object'&&error!==null&&'status'in error&&[400,401,403,413,429,503].includes(Number(error.status))?Number(error.status):503;
   return Response.json({error:status===401?'Entra en tu cuenta para continuar.':'No se pudo completar la conexión. Reintenta sin cambiar la clave del envío.'},{status,headers:responseHeaders(cookie)});
  }
 };
}
