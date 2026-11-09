import { getConfig } from '@/lib/config';
export const dynamic='force-dynamic';
export function GET(){try{getConfig();return Response.json({configured:true},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({configured:false,error:'Falta configuración del servidor de ritnave.'},{status:503,headers:{'Cache-Control':'no-store'}});}}
