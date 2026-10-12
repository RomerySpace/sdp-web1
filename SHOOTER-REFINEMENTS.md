# Shooter: suelo, arma remota y sincronizacion

## Cambios

- gameConfig.ts: entrada por defecto a nivel de calle y diez zonas de suelo. La busqueda solo admite su franja vertical, nunca azoteas; revisa espacio, soporte y ocupacion. Inicialmente se separan hasta 25 visitantes; reaparecer prioriza puntos alejados de jugadores vivos. Si no hay sitio, el servidor reintenta, sin colocar a alguien en una pared o un tejado.
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

gameConfig.player: spawn, spawnZones, spawnSearch.radius y floorTolerance.
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
Comprobar entrada y reaparicion a nivel de calle, apuntado del arma de otro visitante, carrera, cambio de direccion, paredes y dos impactos/respawn. Revisar FPS, PING, JITTER, BUFFER y CORRECTIONS/TELEPORTS en desarrollo. Ninguno de estos diagnosticos aparece en produccion.

Al regenerar las colisiones hay que reiniciar el backend para que descarte el archivo cacheado. El build de Render ya ejecuta prepare:shooter; publicacion de fuentes sin desplegar el backend no actualiza sus colisiones.
Las correcciones no cambian planes ni aseguran 40-60 ms entre continentes. El rendimiento publico debe comprobarse despues de un despliegue coordinado de Vercel y Render.
