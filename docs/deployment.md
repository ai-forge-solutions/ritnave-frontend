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
| FIREBASE_WEB_API_KEY | Solo servidor frontend | Secret Manager; no NEXT_PUBLIC |
| SESSION_SECRET | Solo servidor frontend | 32 bytes aleatorios en base64url canónico; Secret Manager |
| APP_ORIGIN | Solo servidor frontend | Origen HTTPS exacto que abrirán los usuarios, sin ruta |
| RITNAVE_API_URL | Solo servidor frontend | URL raíz de la API en Cloud Run (sin IAM; protegida por token Firebase) |

Generar SESSION_SECRET con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` en un entorno privado. No pegar secretos en chat, Git, Docker ARG ni variables NEXT_PUBLIC. Rotar SESSION_SECRET invalida las cookies existentes.

Crear los secretos `ritnave-web-session-secret` y `ritnave-web-firebase-api-key` en Secret Manager. Se puede elegir otro nombre mediante SESSION_SECRET_NAME/FIREBASE_KEY_SECRET_NAME en el script. Conceder secretAccessor **solo sobre esos dos secretos** a `ritnave-frontend@nutria-9c71e.iam.gserviceaccount.com`.

## 3. Backend necesario

La API anterior solo aceptaba tokens Google de cuentas de servicio. Debe desplegarse el cambio de `ritnave/identity.py` y `ritnave/cloud.py` del repositorio backend: verifica firma Firebase, issuer, audience, tenant y email verificado, y deriva owner como `firebase:<tenant>:<uid>`. Mantiene compatibilidad con los clientes de máquina anteriores. No cambia documentos existentes, colecciones, reglas de almacenamiento, cola ni worker GPU.

Usar `scripts/deploy-api.sh --apply` del backend con FIREBASE_AUTH_PROJECT_ID y FIREBASE_AUTH_TENANT_ID. Construye/despliega solo la API CPU. No ejecutar la antigua construcción completa de GPU para un cambio de autenticación.

## 4. Frontend

`scripts/deploy.sh` sin argumentos muestra el plan y no llama a GCP. Para aplicar explícitamente, usar una identidad de despliegue autorizada, una configuración gcloud aislada y los secretos ya creados:

```sh
export GCLOUD=/ruta/al/google-cloud-sdk/bin/gcloud
export CLOUDSDK_CONFIG=/ruta/privada/config-gcloud
export FIREBASE_AUTH_PROJECT_ID=nutria-9c71e
export FIREBASE_AUTH_TENANT_ID='<tenant-de-ritnave>'
# Opcional: APP_ORIGIN=https://dominio-propio; de otro modo se usa el origen numérico de Cloud Run.
bash scripts/deploy.sh --apply
```

Recursos nuevos: servicio público `ritnave-frontend` (CPU 1, 512 MiB, min0/max2) y su cuenta runtime. Usa el repositorio Artifact Registry `ritnave`, build SA `ritnave-build` y staging dedicados existentes. La build puede facturar CPU/almacenamiento; no enciende la GPU. Runtime necesita únicamente secretAccessor sobre sus dos secretos y run.invoker sobre `ritnave-api`. No necesita acceso directo a Firestore/GCS ni Firebase Admin. El frontend es público; **API y worker continúan privados**.

La identidad de despliegue requiere las capacidades correspondientes para construir, crear/actualizar su servicio y cuenta runtime, conceder invoker en la API y acceso a sus secretos. No usar la cuenta administrativa del agente como identidad runtime.

Abrir exactamente APP_ORIGIN: un alias distinto debe configurarse como origen público antes de usar login, no desactivar CSRF. Un dominio propio requerirá su configuración DNS por separado y autorización; no se ha tocado DNS.

## 5. Smoke de aceptación tras configurar/desplegar

1. `/api/health` 200 solo acredita arranque; `/api/ready` acredita presencia/formato de configuración, no acceso real a Firebase.
2. Registrar/verificar dos cuentas dedicadas en el tenant de ritnave, sin tocar usuarios de NutrIA. Verificar recuperación y logout.
3. Cuenta A: subir un audio de prueba, ver queued/running/succeeded, reproducir y descargar cuatro resultados. Reintentar mismo key no crea otro trabajo.
4. Cuenta B: solicitar el ID/archivos de A debe devolver 404. Un token de otro tenant/proyecto y correo sin verificar deben rechazarse.
5. Navegación móvil/escritorio sin errores JS; sin secretos/tokens legibles en HTML, localStorage o respuestas JSON.
6. Confirmar caps GPU existentes y escalado a cero aparte: una configuración min0 no prueba apagado inmediato.

No dar por probados los proveedores reales a partir de tests con dobles. La imagen Docker y los scripts están preparados; su ejecución contra GCP forma parte del despliegue pendiente, no se afirma que esta nueva imagen ya esté publicada.
