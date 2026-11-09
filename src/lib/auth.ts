import { AppError } from './errors';
import { verifyIdToken, refreshIdToken, type User } from './firebase-auth';
import { createSession, readSession } from './session';
export async function requireSession(request:Request):Promise<{user:User;idToken:string;cookie?:string}> {
  const session=await readSession(request);
  if(session.tokenExpiresAt<=Math.floor(Date.now()/1000)) {
    const tokens=await refreshIdToken(session.refreshToken);
    const verified=await verifyIdToken(tokens.idToken);
    if(verified.user.id!==session.user.id) throw new AppError(401,'Sesión no válida','UNAUTHENTICATED');
    const cookie=await createSession({user:verified.user,...tokens,tokenExpiresAt:verified.expiresAt},session.expiresAt);
    return {user:verified.user,idToken:tokens.idToken,cookie};
  }
  const verified=await verifyIdToken(session.idToken);
  if(verified.user.id!==session.user.id) throw new AppError(401,'Sesión no válida','UNAUTHENTICATED');
  return {user:verified.user,idToken:session.idToken};
}
