import { requireSession } from './auth';
import { getConfig } from './config';
import { makeProxy } from './proxy';
export const processingProxy=makeProxy({session:requireSession,config:getConfig,fetch:(input,init)=>fetch(input,init)});
