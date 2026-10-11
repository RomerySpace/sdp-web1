# SDP Web1: prueba online

Se conservan el entorno blanco, la atmosfera, el pedestal y los controles originales. Cada ordenador abre la misma URL HTTPS de Vercel; no hace falta estar en la misma Wi-Fi ni instalar certificados locales.

## Servicios

- Vercel sirve la web y los archivos HDR e imagenes.
- Render ejecuta Colyseus: movimiento, salas, chat y autorizacion de voz.
- LiveKit Cloud transmite audio WebRTC. El servidor local de voz no se publica en Render.

No se necesitan Redis, bases de datos ni cuentas para los visitantes. Usa una sola instancia de Render en esta prueba: las salas estan en memoria y se pierden al reiniciar o desplegar el backend.

## Direcciones de esta prueba

- Web para ambos ordenadores: https://sdp-web1.vercel.app
- Estado del backend: https://sdp-web1-multiplayer.onrender.com/health
- Panel de Render: https://dashboard.render.com/web/srv-db5qnavlk1mc73atptjg
- Servidor publico de voz: `wss://sdp-web1-a9j8gglz.livekit.cloud`.

Las credenciales de este proyecto de LiveKit estan configuradas exclusivamente en las variables privadas del backend de Render. No hacen falta claves en el navegador ni certificados locales para esta prueba online.

Entra en la exposicion, manten V y autoriza el microfono cuando Chrome lo solicite. Al soltar V se detienen las pistas del microfono. Usa auriculares y acerca los dos jugadores a menos de 15 metros.

Se ha comprobado la conexion real con LiveKit Cloud utilizando navegadores automatizados y microfonos simulados: recepcion de audio WebRTC, apagado al soltar V e identidades y salas ligadas a Colyseus. Esta comprobacion no sustituye una prueba con dos ordenadores y microfonos fisicos.

La escultura es `public/SDP/SDPv1.glb`, con material negro mate, luz lateral discreta y rotacion continua sobre el pedestal. Su altura es 0.95m para que encaje sobre el altar. Acercate hasta ver E / INSPECT y pulsa E para inspeccionarla: arrastra con el raton para girarla y usa la rueda para acercar mucho mas o alejar dentro de los limites. Durante la inspeccion sigue girando lentamente y recibe iluminacion suave para revelar los detalles. Pulsa E otra vez para volver. La inspeccion no desplaza a tu jugador en la sala; puedes seguir hablando con V. En movil, INSPECT abre la inspeccion y RETURN la cierra.

## 1. GitHub

Repositorio previsto: https://github.com/RomerySpace/sdp-web1

Publica el codigo, `public/`, `shared/`, `server/` y los archivos de configuracion. Nunca publiques `.local/`, `.env`, certificados, claves privadas, credenciales de LiveKit ni la carpeta `.vercel/`. Los archivos `.env.example` son ejemplos sin secretos.

## 2. Crear el frontend en Vercel

Importa el repositorio. Root Directory: raiz del repositorio. Framework: Vite. `vercel.json` ya configura `npm ci`, `npm run build` y salida `dist`.

El primer despliegue proporciona una URL estable de produccion. La escena se puede abrir, pero multijugador y voz no funcionaran hasta configurar Render. Usa la URL de produccion, no una URL temporal de preview.

## 3. Preparar LiveKit Cloud

En https://cloud.livekit.io crea o selecciona un proyecto para esta prueba y obtiene su URL, API key y API secret. Revisa los limites y posibles costes de tu cuenta antes de contratar nada.

Las credenciales solo se introducen en Render. No las pegues en el chat, no las subas a GitHub y no crees variables `VITE_LIVEKIT_API_SECRET`.

## 4. Crear el backend en Render

Importa el repositorio como Blueprint y utiliza `render.yaml`. Selecciona una sola instancia; el archivo propone el plan gratuito para pruebas. No necesitas abrir puertos locales ni certificados mkcert.

Introduce estas variables en Render con tus valores reales:

| Variable | Valor |
| --- | --- |
| `ALLOWED_ORIGINS` | URL HTTPS exacta de produccion de Vercel, sin rutas; varias URLs separadas por comas |
| `LIVEKIT_URL` | `https://TU-PROYECTO.livekit.cloud` (tambien acepta `wss://`) |
| `LIVEKIT_PUBLIC_URL` | `wss://TU-PROYECTO.livekit.cloud` |
| `LIVEKIT_API_KEY` | API key del proyecto de LiveKit |
| `LIVEKIT_API_SECRET` | API secret del mismo proyecto |

El Blueprint ya establece `NODE_ENV=production` y `HOST=0.0.0.0`. Render proporciona `PORT`; no lo fijes a 2567. No establezcas Root Directory a `server`: el backend importa `shared/` desde la raiz.

Si creas un Web Service manualmente:

- Runtime: Node; Node version: 22.
- Root Directory: vacio (raiz del repositorio).
- Build Command: `npm ci --prefix server --include=dev && npm --prefix server run typecheck`.
- Start Command: `npm --prefix server start`.
- Health Check Path: `/health`.

Abre `https://TU-BACKEND.onrender.com/health`. Debe responder con `status: "ok"`. `voice: "configured"` confirma que existen credenciales, NO que la conexion WebRTC se haya probado.

El plan gratuito de Render puede dormirse tras inactividad; la primera conexion puede tardar alrededor de un minuto. Abre `/health`, espera y recarga la web. Los reinicios desconectan a los usuarios y recrean las salas.

## 5. Conectar Vercel con Render

En Vercel, Settings > Environment Variables, establece para Production:

```text
VITE_SDP_SERVER_URL=https://TU-BACKEND.onrender.com
```

Tambien acepta `wss://TU-BACKEND.onrender.com`. No anadas `/multiplayer`: ese prefijo solo pertenece al proxy local de Vite. Haz un nuevo despliegue de Vercel: las variables `VITE_` se incorporan durante el build.

El navegador conecta directamente con Render por HTTPS/WSS y con LiveKit por WSS/WebRTC. El proxy de desarrollo de Vite no existe en el despliegue de Vercel.

## 6. Prueba con dos ordenadores

1. Abre la misma URL de produccion de Vercel en Chrome en ambos ordenadores.
2. Comprueba `CONNECTED` y `ONLINE: 2 / 25`; si hay otros visitantes, el contador sera mayor. Si hay mas de 25, se abre otra sala.
3. Entra en la exposicion y mueve un jugador. El otro debe ver su avatar.
4. Pulsa ENTER, escribe y pulsa ENTER de nuevo. Ambos deben recibir el mensaje. ESC cierra el chat.
5. Usa auriculares. Mantiene V para hablar y permite el microfono cuando el navegador lo solicite. Comprueba `VOICE CONNECTED` y `TRANSMITTING`; al soltar V debe parar.
6. Acerca ambos avatares: sus posiciones iniciales pueden estar separadas mas de 15 metros. Voz completa hasta 3 metros, disminucion hasta 15 metros y silencio mas lejos. Gira la camara para probar izquierda/derecha.
7. Cierra una ventana: el avatar debe desaparecer. El otro deja de recibir su voz.

## Diagnostico

- `Disconnected`: comprueba que Render esta iniciado, que `/health` responde y que `VITE_SDP_SERVER_URL` contiene la URL real antes de volver a desplegar Vercel.
- Error CORS/403: `ALLOWED_ORIGINS` debe coincidir exactamente con el dominio abierto. No autorices todos los dominios `*.vercel.app`.
- `VOICE DISCONNECTED`: revisa las cuatro variables de LiveKit en Render; URL, key y secret deben pertenecer al mismo proyecto.
- `MICROPHONE BLOCKED`: habilita el microfono en los permisos del sitio. Se solicita al pulsar V, no al cargar la pagina.
- Voz conectada pero silencio: manten V, no escribas en el chat, comprueba el dispositivo de entrada, acerca los jugadores a menos de 15 metros y prueba auriculares.
- No incluyas tokens de voz en capturas de Network ni en logs compartidos.

Este prototipo usa sesiones anonimas y tokens de voz de 60 segundos ligados a la sala de Colyseus. La lista de origenes protege el acceso desde navegadores ajenos, pero no equivale a autenticacion de cuentas ni evita clientes automatizados. No es una plataforma de produccion endurecida para acceso masivo.

## Documentacion oficial

- Vite en Vercel: https://vercel.com/docs/frameworks/frontend/vite
- WebSockets en Render: https://render.com/docs/websocket
- Limitaciones del plan gratuito de Render: https://render.com/docs/free
- Tokens de LiveKit: https://docs.livekit.io/home/server/generating-tokens

El desarrollo local sigue disponible con `npm run dev:lan`; la configuracion online no sustituye las credenciales ni los certificados locales.
