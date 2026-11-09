export type ProxyDeps = {
 session: (request: Request) => Promise<{user:{id:string;email:string;name?:string};idToken:string;cookie?:string}>;
 config: () => {apiUrl:string;appOrigin:string};
 iam: (audience:string) => Promise<string>;
 fetch: typeof fetch;
};
const statuses = new Set(['dispatch_pending','queued','running','succeeded','failed']);
const files = new Set(['vocals.wav','vocals.mp3','instrumental.wav','instrumental.mp3']);
const validId=(id:unknown): id is string => typeof id==='string' && /^[a-f0-9]{64}$/.test(id);
const MAX_BYTES=30*1024*1024;
function responseHeaders(cookie?:string) {
 const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex'});
 if(cookie)headers.set('Set-Cookie',cookie);
 return headers;
}
function safeFilename(value:string|null) {
 if(!value || value.length>255 || !/\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(value)) return null;
 const dot=value.lastIndexOf('.');
 const stem=value.slice(0,dot).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9_.-]/g,'_').replace(/\.{2,}/g,'_').replace(/^[^A-Za-z0-9]+/,'').slice(0,180)||'audio';
 return stem+value.slice(dot).toLowerCase();
}
export function makeProxy(deps: ProxyDeps) {
 return async (request: Request, path: string[]) => {
  let cookie: string|undefined;let overLimit=false;
  try {
   const session=await deps.session(request);cookie=session.cookie;
   const config=deps.config();const input=new URL(request.url);
   const fail=(status:number,error:string)=>Response.json({error},{status,headers:responseHeaders(cookie)});
   const isUpload=request.method==='POST'&&path.length===0;
   const isFile=request.method==='GET'&&path.length===3&&validId(path[0])&&path[1]==='files'&&files.has(path[2]);
   if(request.method==='POST'&&(request.headers.get('origin')!==config.appOrigin||request.headers.get('sec-fetch-site')==='cross-site')) return fail(403,'Origen no permitido.');
   if(!isUpload&&!isFile&&(request.method!=='GET'||path.length!==1||!validId(path[0])))return fail(404,'Ruta no disponible.');
   let target=config.apiUrl+'/jobs';
   let body:ReadableStream<Uint8Array>|undefined;
   const headers=new Headers();
   if(isUpload){
    if([...input.searchParams.keys()].some(k=>k!=='filename')||input.searchParams.getAll('filename').length!==1)return fail(400,'Indica un único archivo.');
    const filename=safeFilename(input.searchParams.get('filename'));
    const key=request.headers.get('idempotency-key');
    if(!filename)return fail(415,'Formato de audio no compatible.');
    if(!key||key.length>200||!/^[\x21-\x7e]+$/.test(key))return fail(400,'Falta una clave de envío válida.');
    if(request.headers.get('content-type')?.split(';')[0]!=='application/octet-stream')return fail(415,'Sube el contenido binario del audio.');
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))return fail(413,'El archivo supera 30 MiB.');
    if(!request.body||length==='0')return fail(400,'El archivo está vacío.');
    let bytes=0;
    body=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_BYTES){overLimit=true;throw new Error('Upload too large');}controller.enqueue(chunk);}}));
    target+='?filename='+encodeURIComponent(filename);
    headers.set('Content-Type','application/octet-stream');headers.set('Idempotency-Key',key);
   }else target+='/'+path[0]+(isFile?'/files/'+path[2]:'');
   if(isFile){
    if([...input.searchParams.keys()].some(k=>k!=='download')||(input.searchParams.has('download')&&input.searchParams.get('download')!=='1'))return fail(400,'Parámetro de descarga no válido.');
    const range=request.headers.get('range');if(range&&/^bytes=\d*-\d*$/.test(range))headers.set('Range',range);
   }
   headers.set('Authorization','Bearer '+session.idToken);headers.set('X-Serverless-Authorization',await deps.iam(config.apiUrl));
   const options:RequestInit&{duplex?:'half'}={method:request.method,headers,redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(isUpload?300000:isFile?120000:30000)])};
   if(body){options.body=body;options.duplex='half';}
   const upstream=await deps.fetch(target,options);
   if(!upstream.ok)return fail([401,403].includes(upstream.status)?503:upstream.status,[401,403].includes(upstream.status)?'El servidor de procesamiento no está autorizado o configurado.':'El servicio no pudo completar la solicitud. Conserva la clave para reintentar.');
   if(isFile){
    if(!upstream.body||![200,206].includes(upstream.status))return fail(502,'No se recibió el archivo completo.');
    const outgoing=responseHeaders(cookie);
    outgoing.set('Content-Type',path[2].endsWith('.mp3')?'audio/mpeg':'audio/wav');
    outgoing.set('Content-Disposition',(input.searchParams.get('download')==='1'?'attachment':'inline')+'; filename="'+path[2]+'"');
    for(const name of ['Content-Length','Content-Range','Accept-Ranges']){const value=upstream.headers.get(name);if(value)outgoing.set(name,value);}
    return new Response(upstream.body,{status:upstream.status,headers:outgoing});
   }
   const data=await upstream.json();
   if(!validId(data.id)||(!isUpload&&data.id!==path[0])||!statuses.has(data.status))throw new Error('Invalid upstream contract');
   const result:Record<string,unknown>={id:data.id,status:data.status,files:Array.isArray(data.files)?data.files.filter((f:unknown)=>typeof f==='string'&&files.has(f)):[]};
   for(const key of ['created_at','updated_at'])if(typeof data[key]==='string')result[key]=data[key];
   return Response.json(result,{status:isUpload?202:200,headers:responseHeaders(cookie)});
  } catch(error) {
   const status=overLimit?413:typeof error==='object'&&error!==null&&'status'in error&&[400,401,403,413,429,503].includes(Number(error.status))?Number(error.status):503;
   return Response.json({error:status===401?'Entra en tu cuenta para continuar.':status===413?'El archivo supera 30 MiB.':'No se pudo completar la conexión. Reintenta sin cambiar la clave del envío.'},{status,headers:responseHeaders(cookie)});
  }
 };
}
