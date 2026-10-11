# SDP Web1: multijugador local

**Actualizacion LAN:** ahora hay texto compartido y voz de proximidad con HTTPS. Para probar entre dos ordenadores utiliza `npm run dev:lan` y [LAN.md](LAN.md); este documento conserva las instrucciones de la base de movimiento.

Esta fase permite que hasta 25 visitantes compartan una sala local `SDPLobby` y vean sus movimientos mediante avatares sencillos. Se mantienen el entorno blanco, la escultura, el HDR, los fragmentos digitales, la introduccion y los controles originales. No se publica nada en Internet.

## Arranque sencillo

Abre una terminal en `WEB1v1 GRAFICOS CODE`. Las dependencias ya estan instaladas en esta maquina. Al preparar otra copia del proyecto, instalalas una vez:

```sh
npm run install:all
```

Para arrancar ambas partes en una sola terminal:

```sh
npm run dev:all
```

Deja esa terminal abierta. Veras dos prefijos: `SERVER` y `WEB`. El servidor anuncia `Multiplayer ready` y normalmente usa `http://127.0.0.1:2567`. Vite muestra la direccion que debes abrir en el navegador, normalmente `http://127.0.0.1:5173`. Si ese puerto de Vite esta ocupado, utiliza la direccion que aparece junto a `Local`.

Para detener ambas partes, pulsa `Ctrl+C` en esa terminal. Si una de las partes se cierra, el comando conjunto detiene tambien la otra.

## Arranque por separado

Primera terminal, desde la carpeta principal:

```sh
npm run dev:server
```

Segunda terminal, tambien desde la carpeta principal:

```sh
npm run dev
```

Tambien puedes abrir una terminal dentro de `server/` y ejecutar `npm run dev`. El comando del frontend sigue siendo el mismo de antes. Node.js debe ser 22.12 o superior; el proyecto se ha probado con Node 24.

## Prueba con dos ventanas

1. Abre la direccion de Vite en dos ventanas del navegador. Ambas deben mostrar `Connected` y `ONLINE: 2 / 25`. El contador incluye tu propio visitante.
2. Pulsa `CLICK TO ENTER` en ambas ventanas.
3. En la primera ventana, usa `W`, `A`, `S`, `D` y el raton. En la segunda debes ver moverse y orientarse una capsula gris que representa al primer visitante. Puedes girarte para encontrarla: los visitantes aparecen separados alrededor de la escultura.
4. Pulsa `Esc` para liberar el cursor y cambiar de ventana. Haz clic en `CLICK TO RESUME` para recuperar el control. El movimiento se detiene al perder el foco, igual que antes.
5. Cierra una de las ventanas. Su avatar debe desaparecer y la otra debe mostrar `ONLINE: 1 / 25`.

`Connecting` significa que se esta intentando entrar o recuperar una conexion. `Disconnected` significa que el servidor no esta disponible; la exposicion sigue funcionando de forma local y reintenta la conexion automaticamente. Una perdida breve de WebSocket puede recuperar la misma sesion durante cinco segundos. Si el servidor se reinicia o la reserva caduca, el cliente vuelve a entrar en una sala disponible y recibe un punto de aparicion nuevo.

El chat ahora se comparte por Colyseus dentro de cada sala, sin limite de distancia. La tecla `V` transmite voz por LiveKit cuando se arranca `dev:lan`; al soltarla se detienen las pistas. Para certificados, microfono, proximidad y prueba en dos dispositivos consulta [LAN.md](LAN.md).

## Si el puerto 2567 esta ocupado

Deten una instancia anterior de este servidor con `Ctrl+C`, o selecciona otro puerto, por ejemplo `2568`:

1. Crea `server/.env` con este contenido, usando `server/.env.example` como referencia:

```dotenv
PORT=2568
HOST=127.0.0.1
```

2. Crea `.env.local` en la carpeta principal con este contenido:

```dotenv
VITE_SDP_SERVER_URL=http://127.0.0.1:2568
```

3. Reinicia el servidor y Vite. Ambos archivos deben apuntar al mismo puerto. Comprueba que `http://127.0.0.1:2568/health` devuelve un resultado con `status: "ok"`.

No hace falta tocar el codigo para cambiar el puerto. Estos archivos son de configuracion local; no contienen claves ni requieren crear una cuenta.

## Archivos y responsabilidades

| Archivo o carpeta | Funcion |
| --- | --- |
| `server/package.json`, `server/package-lock.json`, `server/tsconfig.json`, `server/.env.example` | Instalacion, scripts y configuracion independientes del backend |
| `server/src/index.ts` | Servidor HTTP/WebSocket local y ruta `/health` |
| `server/src/rooms/SDPLobby.ts` | Sala, aforo, entradas, simulacion a 20 Hz, altas, bajas y reconexiones |
| `server/src/state/LobbyState.ts` | Estado sincronizado de sala y visitantes |
| `server/src/simulation/MovementSimulation.ts` | Simulacion autoritativa y adaptador para el mundo |
| `server/src/simulation/SpawnPositions.ts` | Puntos de aparicion asignados por el servidor |
| `shared/MultiplayerProtocol.ts`, `shared/Movement.ts` | Contrato de red, validacion y reglas comunes de movimiento |
| `src/network/MultiplayerConnection.ts` | Interfaz de conexion independiente del renderizado |
| `src/network/ColyseusNetworkAdapter.ts` | SDK, sesion, estados recibidos, errores y reintentos |
| `src/network/InputSynchronizer.ts` | Envio de entradas compactas, no posiciones arbitrarias |
| `src/scene/RemotePlayerManager.ts` | Avatares reutilizados e interpolacion con 100 ms de margen |
| `src/ui/ConnectionIndicator.ts` | Estado de conexion y numero real de visitantes |
| `.env.example` | Ejemplo de direccion del backend para Vite |
| `server/tests/movement.test.ts`, `tests/multiplayer.spec.ts` | Pruebas de reglas, entradas y conexiones reales |

Los archivos existentes modificados son `package.json`, `package-lock.json`, `playwright.config.ts`, `README.md`, `src/core/App.ts`, `src/player/FirstPersonController.ts`, `src/scene/SceneManager.ts`, `src/ui/UIManager.ts`, `src/ui/ControlsOverlay.ts` y `src/styles/main.css`. La documentacion de esta fase es este archivo `MULTIJUGADOR.md`.

## Validacion y limites de esta fase

```sh
npm run typecheck:all
npm run test:server
npm run build
npm test
```

`npm test` arranca los servidores de prueba si no estan abiertos y utiliza Google Chrome instalado. Las pruebas cubren dos clientes, avatares en el framebuffer, movimiento, orientacion, desconexion, reconexion, contador, limite de 25, entradas invalidas, secuencias antiguas y funcionamiento local sin backend. Tambien se conservan las pruebas anteriores de la exposicion y los graficos. La prueba de musica ambiente se omite si falta el archivo opcional `ambient.mp3`.

El servidor recibe direccion, orientacion, estado activo y una secuencia. Valida valores, descarta entradas antiguas, limita mensajes, normaliza diagonales y mueve a los visitantes a un maximo de 3 m/s. Los paquetes no eligen el tiempo de simulacion, la posicion ni el punto de aparicion. Tras 250 ms sin entradas nuevas, el movimiento remoto se detiene. El limite del pedestal existente se reutiliza mediante una interfaz sustituible para futuros obstaculos.

El movimiento de tu camara sigue siendo inmediato. En esta fase solo se aplica un punto de aparicion al entrar o reconectar; todavia no hay reconciliacion continua de la posicion local, por lo que puede existir una pequena diferencia respecto al servidor. El estado confirmado y la secuencia procesada dejan preparada esa ampliacion. Las salas llenas permiten crear otra instancia de `SDPLobby` mediante el matchmaking normal de Colyseus.

No se implementan cuentas, base de datos, Redis, LiveKit, chat de red, salto, agacharse ni combate. La direccion de escucha predeterminada es `127.0.0.1`: esta configuracion es para pruebas en tu propio ordenador.
