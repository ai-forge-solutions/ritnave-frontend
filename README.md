# ritnave frontend

Next.js + React, interfaz SaaS en español: landing → registro/verificación/login → estudio → subida → estado de cola → reproducción y descarga privada de voz e instrumental (WAV/MP3).

## Ejecutar y comprobar

```sh
npm ci
cp .env.example .env.local
# Configurar valores reales: sin ellos las rutas auth devuelven 503, nunca una sesión demo.
npm run dev -- --port 3100
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

El frontend no llama a Cloud Run desde el navegador. Su servidor verifica la sesión y reenvía dos identidades separadas: IAM de su cuenta runtime en `X-Serverless-Authorization`, e ID token Firebase del usuario en `Authorization`. Nunca sustituye al usuario por una identidad compartida ni acepta un owner enviado por el cliente.

## Configuración pendiente de despliegue

Ver [docs/deployment.md](docs/deployment.md). Dos secretos: `FIREBASE_WEB_API_KEY` y `SESSION_SECRET`. Configuración no secreta: `FIREBASE_AUTH_PROJECT_ID`, `FIREBASE_AUTH_TENANT_ID`, `APP_ORIGIN`, `RITNAVE_API_URL`. Google ADC gestionado por la identidad de Cloud Run; ninguna clave JSON runtime. El backend necesita su nuevo código de verificación Firebase y los mismos proyecto/tenant.

## Límites y comportamiento

- 30 MiB por archivo en la web (límite de transporte HTTP/1 Cloud Run); máximo 10 minutos validado también por el backend.
- Voz/instrumental únicamente; sin planes, cobros ni separación de otros instrumentos ficticios.
- Email verificado y tenant específico obligatorios. Nunca se usa el pool por defecto de NutrIA.
- Sesión cifrada de hasta 7 días, cookie HttpOnly/SameSite=Lax/Secure en HTTPS; renovación del ID token en servidor sin ampliar la expiración original. Logout elimina la cookie local; no revoca todas las sesiones de Firebase. No hay tokens en localStorage.
- POST con Origin exacto; no se abre CORS. Las claves idempotentes sobreviven a reintentos manuales. No hay reenvíos automáticos de audio.
- Estado y errores reales, sin porcentajes de procesamiento ficticios. Historial de IDs/nombres local al navegador y separado por usuario; no se promete historial entre dispositivos.
- Resultados privados; limpieza de objetos asíncrona tras un día. Los reproductores reciben streams autenticados; sin URLs públicas de GCS.
- Firebase gestiona emails y sus enlaces con el handler predeterminado y vuelta a `/login`. La ruta `/actualizar-password?oobCode=…` también permite confirmar un código de recuperación válido; sin código falla sin cambiar contraseñas.

## Evidencia y límites

Los tests de UI interceptan APIs de forma explícita; no prueban Firebase/Cloud Run en vivo. Los tests de firma usan RSA real con una fuente local de clave pública. El build no necesita secretos. La validación pública de registro/email/login → GPU queda para el despliegue y su configuración. No se han creado usuarios reales, enviado emails, migrado bases ni desplegado estos cambios.

Desarrollo por PR a `develop`, sin merge a `main`.
