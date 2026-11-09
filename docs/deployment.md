# Despliegue y configuración — sin cambios cloud ejecutados por este PR

## 1. Firebase aislado

Proyecto previsto: `nutria-9c71e`. Usar **un tenant nuevo de Identity Platform para ritnave**, con email/contraseña permitido (`allowPasswordSignup=true`), no el directorio de usuarios por defecto de NutrIA. No reutilizar, importar, enumerar ni editar sus cuentas.

Si el proyecto no tiene habilitados Identity Platform y multitenancy, su activación es un paso de infraestructura sujeto a aprobación y revisión de precios/impacto. No se activa desde este código. Crear el tenant desde Identity Platform → Tenants y guardar su ID exacto. No hay más código por implementar: esta es configuración del proveedor.

Configurar una API key dedicada limitada a Identity Toolkit y Secure Token, y el dominio público exacto como dominio autorizado. Usar los emails/handler predeterminados Firebase con `continueUrl=APP_ORIGIN/login`; no cambiar las plantillas globales de NutrIA para adaptar el diseño. Pruebas de aceptación tras despliegue: registro nuevo, email de confirmación recibido, login bloqueado antes de verificar, login posterior y recuperación real.

## 2. Variables

| Variable | Dónde | Tipo |
|---|---|---|
| FIREBASE_AUTH_PROJECT_ID | Frontend y API | No secreto; `nutria-9c71e` |
| FIREBASE_AUTH_TENANT_ID | Frontend y API | No secreto; tenant nuevo obligatorio |
| FIREBASE_WEB_API_KEY | Solo servidor frontend | Variable secreta de Netlify; no NEXT_PUBLIC |
| SESSION_SECRET | Solo servidor frontend | 32 bytes aleatorios en base64url canónico; variable secreta de Netlify |
| APP_ORIGIN | Solo servidor frontend | Origen HTTPS exacto que abrirán los usuarios, sin ruta |
| RITNAVE_API_URL | Solo servidor frontend | URL raíz de la API en Cloud Run (sin IAM; protegida por token Firebase) |

Generar SESSION_SECRET con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` en un entorno privado. No pegar secretos en chat, Git, Docker ARG ni variables NEXT_PUBLIC. Rotar SESSION_SECRET invalida las cookies existentes.

Guardar `SESSION_SECRET` y `FIREBASE_WEB_API_KEY` como variables secretas de Netlify (ver sección 4).

## 3. Backend necesario

La API anterior solo aceptaba tokens Google de cuentas de servicio. Debe desplegarse el cambio de `ritnave/identity.py` y `ritnave/cloud.py` del repositorio backend: verifica firma Firebase, issuer, audience, tenant y email verificado, y deriva owner como `firebase:<tenant>:<uid>`. Mantiene compatibilidad con los clientes de máquina anteriores. No cambia documentos existentes, colecciones, reglas de almacenamiento, cola ni worker GPU.

Usar `scripts/deploy-api.sh --apply` del backend con FIREBASE_AUTH_PROJECT_ID y FIREBASE_AUTH_TENANT_ID. Construye/despliega solo la API CPU. No ejecutar la antigua construcción completa de GPU para un cambio de autenticación.

## 4. Frontend en Netlify

Netlify despliega con su integración Git: conectar `ai-forge-solutions/ritnave-frontend`, rama de producción **`develop`**, comando `npm run build` (ya en `netlify.toml`). Next.js se ejecuta con el adaptador OpenNext automático; las rutas `/api/**` corren como Netlify Functions (límite fijo de 60 s y 6 MB por petición). El audio nunca pasa por ellas: va directo a GCS con URLs firmadas. El puente corta las llamadas a la API a los 55 s y devuelve un 503 reintentable con la misma clave.

Variables de entorno en Netlify (Site configuration → Environment variables), con alcance **Functions** y marcadas como secretas las dos sensibles:

| Variable | Valor |
|---|---|
| FIREBASE_AUTH_PROJECT_ID | `nutria-9c71e` |
| FIREBASE_AUTH_TENANT_ID | tenant dedicado de ritnave |
| FIREBASE_WEB_API_KEY | secreta |
| SESSION_SECRET | secreta, 32 bytes base64url |
| APP_ORIGIN | origen público exacto (el dominio propio) |
| RITNAVE_API_URL | URL de `ritnave-api` en Cloud Run |

No hay ninguna credencial de Google en Netlify: el servidor reenvía solo el ID token Firebase del usuario y la API lo verifica. Añadir `APP_ORIGIN` (y el dominio de previews si se quieren usar con login) a `APP_ORIGINS` del backend para el CORS del bucket, y como dominio autorizado del tenant en Identity Platform.

Abrir exactamente APP_ORIGIN: un alias distinto debe configurarse como origen público antes de usar login, no desactivar CSRF. El dominio propio se añade en Netlify (Domain management) y en el DNS de Namecheap; Netlify emite el certificado.

## 5. Smoke de aceptación tras configurar/desplegar

1. `/api/health` 200 solo acredita arranque; `/api/ready` acredita presencia/formato de configuración, no acceso real a Firebase.
2. Registrar/verificar dos cuentas dedicadas en el tenant de ritnave, sin tocar usuarios de NutrIA. Verificar recuperación y logout.
3. Cuenta A: subir un audio de prueba, ver queued/running/succeeded, reproducir y descargar cuatro resultados. Reintentar mismo key no crea otro trabajo.
4. Cuenta B: solicitar el ID/archivos de A debe devolver 404. Un token de otro tenant/proyecto y correo sin verificar deben rechazarse.
5. Navegación móvil/escritorio sin errores JS; sin secretos/tokens legibles en HTML, localStorage o respuestas JSON.
6. Confirmar caps GPU existentes y escalado a cero aparte: una configuración min0 no prueba apagado inmediato.

No dar por probados los proveedores reales a partir de tests con dobles. La imagen Docker y los scripts están preparados; su ejecución contra GCP forma parte del despliegue pendiente, no se afirma que esta nueva imagen ya esté publicada.
