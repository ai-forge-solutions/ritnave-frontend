import { AppError } from './errors';
export function getConfig() {
  const unavailable = () => new AppError(503, 'Autenticación no configurada', 'AUTH_UNAVAILABLE');
  const required = (key: string) => { const value = process.env[key]; if (!value || value.trim() !== value) throw unavailable(); return value; };
  const projectId = required('FIREBASE_AUTH_PROJECT_ID');
  const tenantId = required('FIREBASE_AUTH_TENANT_ID');
  const apiKey = required('FIREBASE_WEB_API_KEY');
  const sessionSecret = required('SESSION_SECRET');
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionSecret) || Buffer.from(sessionSecret,'base64url').length !== 32 || Buffer.from(sessionSecret,'base64url').toString('base64url') !== sessionSecret) throw unavailable();
  const origin = (key:string, local:boolean) => {
    const raw = required(key);
    try {
      const url = new URL(raw);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && ['development','test'].includes(process.env.NODE_ENV || '') && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw unavailable();
      if (raw !== url.origin && raw !== url.origin + '/') throw unavailable();
      return url.origin;
    } catch { throw unavailable(); }
  };
  return { projectId, tenantId, apiKey, sessionSecret, appOrigin: origin('APP_ORIGIN',true), apiUrl: origin('RITNAVE_API_URL',false) };
}
