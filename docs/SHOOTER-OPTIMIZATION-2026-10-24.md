# Shooter: consultas de movimiento y modo diurno

## Cambios

`CharacterController` sigue siendo compartido por el cliente y el servidor.
Mantiene Rapier, timestep de 60 Hz, velocidades, gravedad, salto, crouch y limites
de pendiente. No cambia los GLB, los materiales ni los colliders del mapa.

- Un barrido horizontal de la capsula interior comprueba espacio libre antes de
  ejecutar el controlador recursivo. El solver dinamico sigue resolviendo gravedad
  y contactos; no se teletransporta al personaje ni se omiten las paredes.
- Cerca de obstaculos se conserva el motor de Rapier para deslizar y resolver
  movimiento. La busqueda recursiva de peldanos y su componente descendente se
  activan solamente si la sonda detecta un peldano ascendente delante.
- Se mantiene la comprobacion acotada de peldano, techo y espacio superior.
- Lean exactamente nulo no realiza una consulta de forma con desplazamiento cero.

Una variante intermedia sin autostep fallo en los peldanos altos de Dust 2.
Se descarto esa variante: la version final conserva autostep condicionado y pasa
las cuatro rutas reales, en ambos sentidos y caminando/corriendo/agachado.

El Shooter ya no tiene modo noche, seleccion aleatoria por ronda, spotlights
de linterna, tecla Z, boton tactil ni indicacion LIGHT. Se conserva exactamente
la iluminacion diurna anterior, HDR, niebla, sombras, flashes de disparo y trazas.
La iluminacion nocturna de proximidad del arbol de Limbo no se modifica.

Para despliegues escalonados se conserva el campo de esquema `flashlight` siempre
falso, en su posicion de protocolo, y `lighting` siempre `day`. La entrada antigua
`t` se valida como booleano y se descarta: un cliente en cache no puede encender
luces ni provocar rechazo de todo su movimiento por enviar ese campo retirado.
El cliente nuevo nunca envia ese campo y no crea el sistema de luces.

## Confirmacion de baja

Se restaura un aviso breve `TARGET DESYNCHRONIZED` con el nombre del objetivo.
Solo lo dispara un evento `death` del servidor cuyo atacante es el jugador local;
no se activa por disparar o causar daño parcial. Se deduplican los ultimos ocho
eventos, desaparece con transicion suave en 1.8 s y se limpia al reaparecer o salir.
Duracion configurable en `gameplayConfig.combat.eliminationNoticeDuration`.
No recupera rachas, ataques aereos ni ventanas de recompensas.

## Comparacion local

Mismo banco SDK, equipo Apple M4 y parametros que la referencia del
[bloque 2](STABILITY-2026-10-24.md): 20 s medidos por etapa, clientes y servidor
en procesos separados, movimiento continuo, chat, disparos, recargas y un corte
de conexion de cada modo. Sin perfilador ni otras baterias pesadas durante las
mediciones. No mide Render, WAN, voz o FPS del navegador.

| Clientes | Shooter antes / despues | CPU media antes / despues | ACK p95 Shooter antes / despues |
| --- | --- | --- | --- |
| 40: 25 Limbo + 15 Shooter | 58.22 / 59.96 Hz | 73.94 / 53.52% de un nucleo | 55 / 48 ms |
| 80: 50 Limbo + 30 Shooter | 44.25-44.30 / 57.37-57.41 Hz | 96.83 / 82.64% | 180 / 110 ms |

Con 80 clientes pasa ahora el criterio minimo de simulacion >=90% del objetivo.
No implica ausencia de picos: el ACK p95 de Limbo aun fue 299 ms bajo esa carga.

Se aumento a 160 clientes: 100 Limbo y 60 Shooter en ocho salas. Falla el criterio:
Shooter 37.01-37.20 Hz, Limbo 16.82 Hz, CPU media 99.76% de un nucleo y RSS maxima
691.19 MiB. No se siguio a 300 ni se certifica esa capacidad. En todas las etapas
la limpieza final confirmo cero sockets y cero jugadores de prueba restantes.

La RSS maxima con 40/80 fue 362.38/455.03 MiB; no hay una reduccion importante de
memoria. El beneficio medido es de CPU/ritmo de simulacion y no cambia el coste
por mundo Rapier. Repartir carga entre procesos sigue siendo trabajo necesario
para dimensionar el lanzamiento, junto con ensayos largos en hardware objetivo.

Resultados completos: `.local/stability-baseline-2026-10-24.json` y
`.local/stability-optimized-2026-10-24.json`. Las variantes intermedias no deben
usarse como resultado final.

## Validacion

- 87 tests de backend correctos, incluidos dos nuevos que comprueban que el suelo
  libre no usa el motor recursivo y que una pared fina bloquea sprint/crouch.
- Rutas reales de escaleras, salto/duck jump, techo bajo, lean, daño, reaparicion,
  rondas diurnas y compatibilidad del input antiguo de linterna.
- TypeScript de cliente/servidor y build de produccion correctos.
- Cuatro pruebas Playwright correctas: HUD tactil sin solapamientos en siete
  viewports, joystick/HUD WebKit movil vertical y horizontal, dos clientes en
  Shooter diurno con recarga/trazas/flash comprobados por pixeles, y renderizado
  escritorio con assets diferidos y transiciones repetidas de ida/vuelta.
- Capturas de escritorio y movil inspeccionadas. La vista previa existente en
  `http://localhost:5393/` sirve esta version. No se prueba voz Cloud ni iPhone fisico.
- Una prueba adicional con dos navegadores conectados verifica daño parcial sin
  aviso, baja confirmada con nombre solo para el atacante, desvanecimiento,
  deduplicacion, reset y ajuste a movil vertical/horizontal.

```sh
npm run test:stability -- --clients 40,80,160 --duration 20 --output .local/stability-repeat.json
npm run test:server
npm run typecheck:all
npm run build
npm run test:unified -- --grep 'day-only Shooter|clean mobile HUD|WebKit mobile joystick|actual requests stay lazy'
```

Estos cambios se preparan en local. No cambian planes de hosting ni la capacidad
de admision publica; requieren despliegue coordinado de backend y frontend para
publicarlos y una recarga inicial para sustituir el controlador anterior.
