import { getConfig } from '../../../../lib/config';
import { AppError, errorResponse } from '../../../../lib/errors';
import { firebaseRequest, verifyIdToken } from '../../../../lib/firebase-auth';
import { createSession, clearSessionCookie } from '../../../../lib/session';
import { requireSession } from '../../../../lib/auth';
export const runtime='nodejs';
type Context={params:Promise<{action:string}>};
function json(body:unknown,cookie?:string) { return Response.json(body,{headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}}); }
function invalid():never { throw new AppError(400,'Datos no válidos','INVALID_INPUT'); }
function string(body:Record<string,unknown>,key:string,max:number,min=1):string { const v=body[key]; if(typeof v!=='string' || v.length<min || v.length>max) return invalid(); return v; }
function email(body:Record<string,unknown>) { const value=string(body,'email',254).trim(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return invalid(); return value; }
async function bodyJSON(request:Request):Promise<Record<string,unknown>> {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) throw new AppError(415,'Se requiere JSON');
  if(Number(request.headers.get('content-length'))>16384) throw new AppError(413,'Solicitud demasiado grande');
  const reader=request.body?.getReader(); if(!reader) return invalid();
  let size=0; const chunks:Uint8Array[]=[];
  for(;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>16384) { await reader.cancel(); throw new AppError(413,'Solicitud demasiado grande'); } chunks.push(value); }
  try { const body=JSON.parse(Buffer.concat(chunks).toString('utf8')); if(!body || typeof body!=='object' || Array.isArray(body)) return invalid(); return body; } catch { return invalid(); }
}
export async function GET(request:Request,context:Context):Promise<Response> {
  try {
    getConfig(); if((await context.params).action!=='me') throw new AppError(404,'Ruta no encontrada');
    const session=await requireSession(request); return json({user:session.user},session.cookie);
  } catch(error) { if(error instanceof AppError && error.status===401) return json({user:null}); return errorResponse(error); }
}
export async function POST(request:Request,context:Context):Promise<Response> {
  try {
    const config=getConfig();
    if(request.headers.get('origin')!==config.appOrigin || request.headers.get('sec-fetch-site')==='cross-site') throw new AppError(403,'Origen no permitido','CSRF_REJECTED');
    const body=await bodyJSON(request); const {action}=await context.params;
    if(action==='logout') return json({ok:true},clearSessionCookie());
    if(action==='login' || action==='signup' || action==='resend-verification') {
      const address=email(body); const password=string(body,'password',128,8);
      const name=action==='signup'?string(body,'name',100).trim():undefined;
      if(action==='signup' && !name) return invalid();
      const result=await firebaseRequest(action==='signup'?'signUp':'signInWithPassword',{email:address,password,returnSecureToken:true,...(name?{displayName:name}:{})});
      if(typeof result.idToken!=='string' || !result.idToken) throw new AppError(503,'Autenticación no disponible');
      if(action==='signup' || action==='resend-verification') {
        await firebaseRequest('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:result.idToken,continueUrl:config.appOrigin+'/login'});
        return json({requiresEmailConfirmation:true});
      }
      const verified=await verifyIdToken(result.idToken);
      if(typeof result.refreshToken!=='string' || !result.refreshToken) throw new AppError(503,'Autenticación no disponible');
      const cookie=await createSession({user:verified.user,idToken:result.idToken,refreshToken:result.refreshToken,tokenExpiresAt:verified.expiresAt});
      return json({user:verified.user},cookie);
    }
    if(action==='reset') {
      const address=email(body);
      try { await firebaseRequest('sendOobCode',{requestType:'PASSWORD_RESET',email:address,continueUrl:config.appOrigin+'/login'}); }
      catch(error) { if(!(error instanceof AppError && error.code==='EMAIL_NOT_FOUND')) throw error; }
      return json({ok:true});
    }
    if(action==='update-password') {
      const password=string(body,'password',128,8); const oobCode=string(body,'oobCode',2048);
      await firebaseRequest('resetPassword',{newPassword:password,oobCode}); return json({ok:true});
    }
    if(action==='verify-email') { await firebaseRequest('update',{oobCode:string(body,'oobCode',2048)}); return json({ok:true}); }
    throw new AppError(404,'Ruta no encontrada');
  } catch(error) { return errorResponse(error); }
}
