# video-audio-dl-frontend

Sitio estático independiente para preparar descargas MP4 y MP3 a través de una API Docker. Solo necesita Node.js 22 o posterior para construir o servir la interfaz; no usa archivos del backend ni herramientas de procesamiento de medios.

## Repositorio independiente

Esta carpeta, `video-audio-dl-frontend/`, es la raíz del repositorio del frontend y tiene su propio `.git`. Es hermana de `video-audio-dl-backend/` dentro de una carpeta de coordinación. Puede copiarse o trasladarse completa a otra ubicación sin modificar las rutas del proyecto. No la publiques como subcarpeta del repositorio del backend.

Los proyectos se llaman `video-audio-dl-frontend` y `video-audio-dl-backend`. Creá dos repositorios vacíos con esos nombres en tu proveedor Git, dentro de tu cuenta u organización. Desde **esta** raíz, revisá los archivos antes del primer commit:

```sh
git status
git add .
git commit -m "Create standalone frontend"
git remote add origin https://github.com/TU_USUARIO/video-audio-dl-frontend.git
git push -u origin main
```

No hay dependencia Git, submódulo ni workspace npm que enlace ambos proyectos. Cada uno se versiona, publica y revierte por separado.

## Desarrollo local

Iniciá primero la API en su propia carpeta siguiendo el README del backend. Su `FRONTEND_ORIGINS` debe incluir exactamente `http://localhost:5173`.

Desde este repositorio:

```sh
npm run dev
```

Abrí `http://localhost:5173`. El servidor de desarrollo construye el sitio con `http://localhost:3000` como API por defecto. No necesita `npm install` porque no hay dependencias externas. Usa `FRONTEND_PORT` para cambiar el puerto y actualizá el origen permitido en el backend si lo hacés. `localhost` y `127.0.0.1` son orígenes distintos.

Para otra API, establecé `API_BASE_URL` en el entorno del proceso. Los scripts no cargan automáticamente `.env`; `.env.example` sirve como referencia.

```powershell
$env:API_BASE_URL = "http://localhost:3000"
npm.cmd run dev
```

## Construcción

En PowerShell:

```powershell
$env:API_BASE_URL = "https://TU_BACKEND.onrender.com"
npm.cmd run build
```

En macOS/Linux:

```sh
API_BASE_URL=https://TU_BACKEND.onrender.com npm run build
```

El resultado es `dist/`. `dist/config.js` contiene solo el origen público de la API. La URL debe ser un origen HTTPS sin ruta, credenciales, parámetros ni fragmento. La construcción falla si falta esa variable. No ingreses `ACCESS_CREDENTIAL` ni otras claves privadas en variables de Vercel o en este repositorio.

## Desplegar en Vercel

1. Importá el repositorio Git del frontend.
2. Elegí el preset **Other**, directorio raíz `.` y Node.js 22 o posterior.
3. Usá `npm run build` como comando de construcción y `dist` como directorio de salida. Están definidos en `vercel.json`.
4. Configurá `API_BASE_URL` con el origen HTTPS del backend para **Production**. Si usás previews, configurá su API por separado; se recomienda una API de pruebas.
5. Publicá el sitio y copiá su origen exacto al `FRONTEND_ORIGINS` del backend. Si todavía no se validó el contenedor en el host, completá esa validación antes de usar descargas públicas.
6. Para previews, agregá cada origen autorizado explícitamente o usá un dominio estable de pruebas. No permitas `*.vercel.app`.

La construcción inserta una CSP en el HTML antes de los scripts: conexiones solo al origen exacto de la API y al propio sitio. Se combina por intersección con las cabeceras de `vercel.json`, que conservan la exigencia HTTPS. No hay scripts externos. Producción exige HTTPS y desarrollo admite HTTP exclusivamente en loopback. Una nueva URL de API requiere reconstruir el frontend.

Para volver al backend original desde el servicio de prueba en otra región, actualizá `API_BASE_URL` en Vercel y generá un nuevo despliegue. Editar `.env.example` o este README no cambia la variable del proyecto alojado.

## Acceso abierto y clave opcional

El backend usa `AUTH_REQUIRED=false` por defecto: no se muestra el campo, no se pide clave y no se envía `Authorization`. La interfaz descubre el modo con la misma petición `/healthz` que comprueba disponibilidad al intentar descargar; no requiere variables ni secretos adicionales en Vercel. Al confirmar el modo abierto, borra cualquier clave anterior de la sesión.

Para activar la función, configurá `AUTH_REQUIRED=true` y una `ACCESS_CREDENTIAL` válida en el backend, y reinicialo. En el siguiente intento aparece el campo. La clave permanece solo en memoria de la página: recargar, salir o confirmar modo abierto la borra. Se elimina la entrada heredada de `sessionStorage` sin leerla; no se guarda en ningún storage ni asset. Viaja en `Authorization: Bearer ...` para crear, consultar, cancelar y solicitar un permiso. Salud no recibe clave. Si una API anterior omite `authRequired`, la interfaz pide clave.

Si se configura una sesión de YouTube en el backend, el acceso protegido es obligatorio. El operador carga el archivo exclusivamente como Secret File privado en Render; la página no lee, recibe ni transmite cookies de YouTube. Nunca incluirlas en GitHub, variables de Vercel o el chat. La sesión opcional está implementada localmente; calificación y provisión reales siguen pendientes. Consultá `PRIVATE-SESSION.md` del backend para carga, rotación, revocación y rollback protegido. El proveedor y backend necesitan acceso al secreto y YouTube puede seguir rechazando la descarga.

En ambos modos, el archivo se entrega con un permiso aleatorio de un solo uso que vence por defecto a los 60 segundos; se usa una descarga normal del navegador, sin cargar todo el archivo en un `Blob`. Los límites de recursos y solicitudes siguen activos.

## Servicio dormido o interrumpido

- Cada intento de preparar una descarga hace primero `GET /healthz`, sin clave y sin crear un trabajo.
- Si no responde dentro de un segundo, aparece un mensaje sobre un fondo opaco: **“El servicio se está preparando. Volvé a intentarlo en unos minutos.”** Se conserva el enlace, formato y clave.
- La petición continúa aunque cierres el mensaje. Se permite una sola petición de despertar pendiente. No hay llamadas periódicas para mantener el backend encendido.
- La espera tiene un máximo de **dos minutos** desde el inicio de la petición, incluida la lectura de la respuesta.
- Si se confirma disponibilidad después de mostrar la espera, se informa **“Ya podés volver a intentar la descarga.”** Hace falta un nuevo clic; no se envía automáticamente una descarga.
- Una respuesta inmediata válida permite continuar el intento original una sola vez.
- Ante un error, respuesta inválida o vencimiento: **“No pudimos conectar con el servicio. Intentá nuevamente en unos minutos.”** El formulario se conserva.
- Si se pierde la respuesta al crear un trabajo, no se repite ese envío automáticamente, porque el backend podría haberlo recibido.
- Un trabajo o archivo perdido por un reinicio se informa como interrumpido/no disponible. Despertar el servicio no restaura esa descarga; el usuario puede preparar otra.

## Actualizar y revertir

Publicá cambios del frontend desde este repositorio; el backend conserva su despliegue. Para revertir, elegí una publicación anterior en Vercel. Conservá el mismo contrato de API entre versiones compatibles y coordiná cambios de contrato con el backend. Rotar la clave del backend solo requiere volver a ingresarla en el sitio.

Referencias: [configuración de proyectos en Vercel](https://vercel.com/docs/project-configuration), [variables por entorno](https://vercel.com/docs/environment-variables).
