'use client';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from './shell';
type Mode='login'|'signup'|'reset'|'update-password';
const titles:Record<Mode,string>={login:'Bienvenido de nuevo',signup:'Crea tu cuenta',reset:'Recupera tu acceso','update-password':'Tu nueva contraseña'};
const actions:Record<Mode,string>={login:'Entrar',signup:'Crear cuenta',reset:'Enviar enlace','update-password':'Guardar contraseña'};
const subscribe=()=>()=>{};
export function AuthForm({mode}:{mode:Mode}) {
 const router=useRouter();const formRef=useRef<HTMLFormElement>(null);
 const hydrated=useSyncExternalStore(subscribe,()=>true,()=>false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [verification,setVerification]=useState(false);
 async function request(action:string,body:Record<string,string>){
  const response=await fetch('/api/auth/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){setVerification(data.code==='EMAIL_NOT_VERIFIED');throw new Error(typeof data.error==='string'?data.error:'No se pudo completar la solicitud. Inténtalo de nuevo.');}
  return data;
 }
 async function resend(){
  if(!formRef.current?.reportValidity())return;
  const form=new FormData(formRef.current);setBusy(true);setError('');setMessage('');
  try{await request('resend-verification',{email:String(form.get('email')||'').trim(),password:String(form.get('password')||'')});setMessage('Revisa tu correo y confirma tu cuenta antes de entrar.');setVerification(false);}catch(err){setError(err instanceof Error?err.message:'No se pudo conectar.');}finally{setBusy(false);}
 }
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');setMessage('');setVerification(false);
  const form=new FormData(e.currentTarget);const email=String(form.get('email')||'').trim();const password=String(form.get('password')||'');const name=String(form.get('name')||'').trim();
  if(mode!=='reset'&&password.length<8){setError('La contraseña debe tener al menos 8 caracteres.');return;}
  const body:Record<string,string>=mode==='reset'?{email}:mode==='signup'?{email,password,name}:{email,password};
  if(mode==='update-password'){
   const oobCode=new URLSearchParams(window.location.search).get('oobCode');
   if(!oobCode){setError('Abre el enlace que recibiste por correo o solicita uno nuevo.');return;}
   body.oobCode=oobCode;delete body.email;
  }
  setBusy(true);
  try{
   const data=await request(mode,body);
   if(mode==='reset')setMessage('Si existe una cuenta con ese correo, recibirás un enlace para recuperar tu acceso.');
   else if(mode==='signup'&&data.requiresEmailConfirmation)setMessage('Revisa tu correo y confirma tu cuenta antes de entrar.');
   else if(mode==='update-password'){setMessage('Contraseña actualizada. Ya puedes entrar con tu nueva contraseña.');window.history.replaceState(null,'','/actualizar-password');}
   else{const next=new URLSearchParams(window.location.search).get('next');router.replace(next==='/estudio'?next:'/estudio');}
  }catch(err){setError(err instanceof Error?err.message:'No se pudo conectar. Inténtalo de nuevo.');}finally{setBusy(false);}
 }
 return <><Header/><main className="auth card"><p className="eyebrow">TU ESPACIO DE AUDIO</p><h1>{titles[mode]}</h1><p>{mode==='reset'?'Te enviaremos un enlace para recuperar tu cuenta.':mode==='update-password'?'Elige una contraseña de al menos 8 caracteres.':'Separa voz e instrumental y guarda tus ideas.'}</p>
 <form method="post" ref={formRef} onSubmit={submit}>
 {mode==='signup'&&<label>Nombre<input name="name" autoComplete="name" required maxLength={100}/></label>}
 {mode!=='update-password'&&<label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
 {mode!=='reset'&&<label>Contraseña<input name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={8} maxLength={128}/></label>}
 {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
 <button className="primary" disabled={busy||!hydrated}>{busy?'Un momento…':actions[mode]}</button>
 {verification&&<button type="button" className="secondary" disabled={busy} onClick={resend}>Reenviar verificación</button>}
 </form><noscript>Activa JavaScript para entrar de forma segura.</noscript><div className="auth-links">{mode==='login'?<><Link href="/recuperar">Olvidé mi contraseña</Link><Link href="/registro">Crear cuenta</Link></>:<Link href="/login">Volver a entrar</Link>}{mode==='update-password'&&<Link href="/recuperar">Solicitar un enlace nuevo</Link>}</div></main></>;
}
