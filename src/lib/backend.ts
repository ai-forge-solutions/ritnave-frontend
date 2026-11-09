import { GoogleAuth, type IdTokenClient } from 'google-auth-library';
import { requireSession } from './auth';
import { getConfig } from './config';
import { makeProxy } from './proxy';
const clients = new Map<string, Promise<IdTokenClient>>();
export async function processingIamHeader(audience: string): Promise<string> {
 let client=clients.get(audience);
 if(!client){client=new GoogleAuth().getIdTokenClient(audience);clients.set(audience,client);}
 try {
  const headers=await (await client).getRequestHeaders(audience);
  const value=headers.get('authorization');
  if(!value?.startsWith('Bearer '))throw new Error('Missing server identity');
  return value;
 }catch(error){clients.delete(audience);throw error;}
}
export const processingProxy=makeProxy({session:requireSession,config:getConfig,iam:processingIamHeader,fetch:(input,init)=>fetch(input,init)});
