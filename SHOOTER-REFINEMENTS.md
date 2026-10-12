# Shooter: suelo, arma remota y sincronizacion

## Cambios

- SpawnNavigation.ts: el build analiza suelo, espacio de capsula, conexiones fisicas y cielo abierto en el mapa real. Valida 66 puntos en la zona exterior conectada principal, excluyendo azoteas e interiores/patios cerrados. ShooterWorld comprueba ocupacion antes de elegir; reaparecer prioriza distancia respecto a jugadores vivos. Si no hay sitio, reintenta sin colocar a alguien en una pared o tejado. Cambiar spawn/spawnZones requiere regenerar la navegacion.
- RemoteShooterPlayers.ts: el arma tiene un soporte de apuntado independiente de la rotacion del GLB, como la camara local. El canon y el fogonazo siguen el mismo yaw/pitch; el agachado sigue bajando el soporte.
- PredictionHistory.ts: la correccion compara entradas confirmadas con su historia de prediccion, no posiciones separadas por el retraso de red. El cuerpo sigue siendo validado por el servidor y la camara absorbe correcciones menores suavemente. No es un replay completo competitivo.
- SnapshotInterpolation.ts: fechas de simulacion del servidor, buffer de jitter limitado y extrapolacion breve. Se reinicia al cambiar de sala/vida para evitar desplazamientos desde el spawn anterior.
- Entradas: 30 Hz con cambios y disparos inmediatos. Fisica: 60 Hz. Se recuperan pasos acotados tras un fotograma lento; el Limbo no cambia de ritmo.
- Colisiones: agrupacion por celdas de 24 metros, sin reducir ni modificar la geometria. 1.277 colliders pasan a 76. Paredes, escaleras, coches y obstaculos se conservan.

## Mediciones del 12 de octubre de 2026

Microbenchmark local de 600 pasos por caso, sobre el mismo mapa y puntos de suelo:

| Jugadores | Mediana anterior | Mediana agrupada | p95 anterior | p95 agrupado |
| --- | --- | --- | --- | --- |
| 2 | 1.103 ms | 0.174 ms | 1.244 ms | 0.252 ms |
| 25 | 3.374 ms | 1.968 ms | 3.883 ms | 2.087 ms |

El hash del conjunto de triangulos orientados antes/despues coincide:
`fa4632494fc092a78c69cbc6e88dcc76b1852915e02a9966a4634b49329335ea`.
Ambos archivos contienen 847.353 triangulos y proceden del mismo GLB.

Son tiempos de ejecucion local, no ping ni capacidad garantizada de Render. No incluyen 25 navegadores, renderizado, voz o carga sostenida. No validan 300 visitantes.

Una medicion exploratoria de la version publica anterior, con una conexion por modo y 12 segundos de observacion tras crear las salas, dio para Shooter: ping mediano 64 ms, p95 88 ms; intervalo mediano entre estados 200.59 ms, p95 288.12 ms y simulacion observada 47.68 Hz. Puede incluir calentamiento/creacion de salas; no atribuye por si sola la causa a CPU, red o plan. No mide estos cambios nuevos en Render. El informe de carga anterior del Limbo esta separado en LOAD-TEST.md.

## Ajustar y probar

Las salas Shooter son partidas FFA de 5 minutos desde el primer jugador. Los visitantes que llegan despues comparten el tiempo restante. El servidor bloquea movimiento, disparos, recarga, dano y respawns al terminar; conserva el ranking final, incluso de participantes que salieron durante la ronda. Gana quien logra mas bajas, con menos muertes como desempate; si ambos valores coinciden, hay empate. Los resultados duran 8 segundos y la siguiente ronda reinicia puntuaciones, salud, municion y posiciones validadas. Pulsa RESUME para recuperar el raton tras el ranking: el navegador exige un gesto para pointer lock. Se mantiene la sala y no se recargan los modelos. Ajustar `gameplayConfig.match.duration` y `resultsDuration` en `shared/GameplayConfig.ts` (segundos).

`server/tests/shooter-match.test.ts` valida limites temporales y dos clientes WebSocket reales, incluyendo una baja validada, congelacion, entrada tardia, ranking, reinicio y rechazo de acciones de vidas anteriores. La prueba avanza el reloj desde el proceso de test para evitar esperar cinco minutos; no existe una orden de cliente para cambiar la duracion.

P abre el menu de ajustes en Limbo y el tablero/ajustes en Shooter. Pantalla completa y sonido estan dentro del menu, sin controles flotantes. F alterna pantalla completa en toda la web y se ignora al escribir el nombre o chat. MUSIC VOLUME guarda un nivel independiente de GAME VOLUME; controla la pista ambiental opcional cuando se anada (actualmente no existe ninguna). El mute afecta a musica y efectos, no a LiveKit. Abrir ajustes durante la inspeccion conserva su encuadre y no descarga recursos del Shooter.

gameConfig.player: spawn y spawnZones orientan la seleccion de puntos en el build; spawnSearch se conserva para la inicializacion local. SpawnNavigation define la resolucion conservadora de .8 metros.
shared/ShooterProtocol.ts: shooterNetworkConfig (frecuencia de entradas, timeout, buffer, extrapolacion, tolerancia de correccion y respuesta de camara).

```sh
npm run prepare:shooter
npm run typecheck:all
npm run test:server
npm run build
npm run test:unified
npm run dev:unified
```

Abrir http://localhost:5373/ en dos ventanas. Para desarrollo directo, ?debugMode=shooter.
Comprobar entrada y reaparicion en exteriores transitables, apuntado del arma de otro visitante, carrera, cambio de direccion, paredes y dos impactos al torso/respawn. Elegir nombres diferentes y revisar el historial de bajas y STRIKE. B cambia modo; AUTO dispara mientras se mantiene el boton y sube la mira. Tras un impacto no mortal, esperar 7 segundos para verificar la regeneracion progresiva; otro impacto debe reiniciar la espera. Revisar FPS, PING, JITTER, BUFFER y CORRECTIONS/TELEPORTS en desarrollo. Ninguno de estos diagnosticos aparece en produccion.

Parametros de esta actualizacion en shared/GameplayConfig.ts: dano por region (25/50/100/12), regeneracion (7 segundos, 10 HP/s), cadencia AUTO (.1 segundos), recoil acumulativo y duracion/limite del killfeed (8 segundos, 6 entradas). Los nombres se validan antes de admitir la conexion; no equivalen a cuentas ni estadisticas persistentes.

Al regenerar las colisiones hay que reiniciar el backend para que descarte el archivo cacheado. El build de Render ya ejecuta prepare:shooter; publicacion de fuentes sin desplegar el backend no actualiza sus colisiones.
Las correcciones no cambian planes ni aseguran 40-60 ms entre continentes. El rendimiento publico debe comprobarse despues de un despliegue coordinado de Vercel y Render.
