import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { getConfig } from './config';
import { AppError } from './errors';
export interface User { id:string; email:string; name?:string }
export interface VerifiedToken { user:User; expiresAt:number }
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),{timeoutDuration:15000});
export async function verifyIdToken(token:string):Promise<VerifiedToken> {
  const config = getConfig();
  try {
    if(typeof token !== 'string' || token.length > 10000) throw new Error();
    const {payload:p} = await jwtVerify(token,jwks,{algorithms:['RS256'],audience:config.projectId,issuer:`https://securetoken.google.com/${config.projectId}`});
    if(typeof p.sub !== 'string' || !p.sub || p.sub.length > 128 || /[\x00-\x20\x7f]/.test(p.sub) || !Number.isFinite(p.exp) || (p.firebase as {tenant?:string}|undefined)?.tenant !== config.tenantId /* undefined = no tenant allowed */ || typeof p.email !== 'string' || p.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new Error();
    if(p.email_verified !== true) throw new AppError(403,'Confirma tu correo electrónico','EMAIL_NOT_VERIFIED');
    return {user:{id:p.sub,email:p.email,...(typeof p.name === 'string' && p.name.length<=100 ? {name:p.name}: {})},expiresAt:p.exp!};
  } catch(error) {
    if(error instanceof AppError) throw error;
    if(error instanceof TypeError || error instanceof joseErrors.JWKSTimeout || (error instanceof Error && ['ERR_JWKS_TIMEOUT','ERR_JOSE_GENERIC','ERR_JWKS_INVALID'].includes((error as {code?:string}).code || ''))) throw new AppError(503,'Autenticación no disponible');
    throw new AppError(401,'Token no válido','UNAUTHENTICATED');
  }
}
const actions = new Set(['signInWithPassword','signUp','sendOobCode','resetPassword','update']);
async function providerFetch(url:string,init:RequestInit):Promise<Record<string,unknown>> {
  let response:Response; let data:Record<string,unknown>;
  try {
    response=await fetch(url,{...init,signal:AbortSignal.timeout(15000),cache:'no-store',redirect:'error'});
    data=await response.json();
  } catch { throw new AppError(503,'Autenticación no disponible'); }
  if(!response.ok) {
    const raw=(data.error as {message?:unknown}|undefined)?.message;
    const code=typeof raw==='string'?raw.split(/[ :]/)[0]:'';
    if(response.status===429 || ['TOO_MANY_ATTEMPTS_TRY_LATER','QUOTA_EXCEEDED'].includes(code)) throw new AppError(429,'Demasiados intentos; inténtalo más tarde','RATE_LIMITED');
    if(response.status>=500 || ['CONFIGURATION_NOT_FOUND','INVALID_TENANT_ID','TENANT_NOT_FOUND','API_KEY_INVALID','OPERATION_NOT_ALLOWED'].includes(code)) throw new AppError(503,'Autenticación no disponible');
    if(code==='USER_DISABLED') throw new AppError(403,'Cuenta no disponible','ACCOUNT_DISABLED');
    throw new AppError(401,'Credenciales no válidas',code==='EMAIL_NOT_FOUND'?'EMAIL_NOT_FOUND':'INVALID_CREDENTIALS');
  }
  if(!data || typeof data!=='object' || Array.isArray(data)) throw new AppError(503,'Autenticación no disponible');
  return data;
}
export async function firebaseRequest(action:string,body:Record<string,unknown>):Promise<Record<string,unknown>> {
  const config=getConfig();
  if(!actions.has(action)) throw new AppError(400,'Operación no válida');
  return providerFetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config.tenantId?{...body,tenantId:config.tenantId}:body)});
}
export async function refreshIdToken(refreshToken:string):Promise<{idToken:string;refreshToken:string}> {
  const config=getConfig();
  const data=await providerFetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken})});
  if(typeof data.id_token!=='string' || !data.id_token || typeof data.refresh_token!=='string' || !data.refresh_token) throw new AppError(503,'Autenticación no disponible');
  return {idToken:data.id_token,refreshToken:data.refresh_token};
}
