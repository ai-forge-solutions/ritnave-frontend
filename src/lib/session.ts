import { EncryptJWT, jwtDecrypt } from 'jose';
import { getConfig } from './config';
import { AppError } from './errors';
import type { User } from './firebase-auth';
export interface Session { user: User; idToken:string; refreshToken:string; tokenExpiresAt:number; expiresAt:number }
const lifetime = 7*86400;
const now = () => Math.floor(Date.now()/1000);
function options() {
  const config = getConfig(); const secure = config.appOrigin.startsWith('https:');
  return { key:Buffer.from(config.sessionSecret,'base64url'), name:secure?'__Host-ritnave_session':'ritnave_session', flags:`Path=/; HttpOnly; SameSite=Lax${secure?'; Secure':''}` };
}
export async function createSession(input:Omit<Session,'expiresAt'>, expiresAt = now()+lifetime):Promise<string> {
  const {key,name,flags} = options();
  if (!Number.isInteger(expiresAt) || expiresAt <= now() || expiresAt > now()+lifetime) throw new AppError(401,'Sesión caducada');
  const value = await new EncryptJWT({...input,expiresAt}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuer('ritnave-web').setAudience('ritnave-browser').setIssuedAt().setExpirationTime(expiresAt).encrypt(key);
  if (value.length > 3800) throw new AppError(503,'No se puede crear la sesión');
  return `${name}=${value}; ${flags}; Max-Age=${expiresAt-now()}`;
}
export async function readSession(request:Request):Promise<Session> {
  const {key,name} = options();
  try {
    const matches = (request.headers.get('cookie') || '').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
    if(matches.length !== 1) throw new Error();
    const value = matches[0].slice(name.length+1);
    if(value.length > 3800 || !/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error();
    const {payload} = await jwtDecrypt(value,key,{issuer:'ritnave-web',audience:'ritnave-browser',keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
    const s = payload as unknown as Session;
    if(!s.user || typeof s.user.id !== 'string' || !s.user.id || typeof s.user.email !== 'string' || typeof s.idToken !== 'string' || !s.idToken || typeof s.refreshToken !== 'string' || !s.refreshToken || !Number.isFinite(s.tokenExpiresAt) || !Number.isInteger(s.expiresAt) || s.expiresAt !== payload.exp || s.expiresAt <= now() || s.expiresAt > now()+lifetime) throw new Error();
    return s;
  } catch { throw new AppError(401,'Sesión no válida','UNAUTHENTICATED'); }
}
export function clearSessionCookie():string { const {name,flags} = options(); return `${name}=; ${flags}; Max-Age=0`; }
