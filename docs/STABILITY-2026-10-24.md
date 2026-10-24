# Bloque 2: comprobacion local de estabilidad

Referencia previa a la optimizacion. Resultado posterior y modo diurno:
[SHOOTER-OPTIMIZATION-2026-10-24.md](SHOOTER-OPTIMIZATION-2026-10-24.md).

## Alcance

Base comprobada: commit `812a814`. No se ha cambiado el gameplay ni desplegado
esta herramienta en produccion. No se ha enviado carga sintetica a Render ni
a LiveKit. La prueba publica sigue usando su configuracion existente.

Se incorpora `npm run test:stability`: genera clientes SDK reales contra un
backend Colyseus de prueba en otro proceso, exclusivamente en loopback y con
puerto efimero. Usa las clases reales de salas, admision y fisica Rapier de Dust 2.
Cada etapa arranca un backend nuevo; no representa un ensayo prolongado de fugas.
No ejecuta el entrypoint de produccion, TLS ni conexiones geograficamente distribuidas.

Carga: aproximadamente 5 visitantes Limbo por cada 3 Shooter, salas de hasta
25/15, movimiento continuo con giros, sprint, crouch y saltos, disparos hasta
4 intentos/s por Shooter, recarga y chat por sala. Es una carga sintetica activa,
no una prediccion del comportamiento de visitantes reales.

Durante cada etapa se corta y recupera una conexion de cada modo, comprobando
misma sala e identidad. Se verifica entrega e aislamiento del chat, eventos
autoritativos de disparo/recarga y retirada de jugadores y sockets al terminar.

CPU se expresa como porcentaje de UN nucleo, no del equipo completo. ACK es
tiempo hasta el estado sincronizado que confirma un input, no ping de Internet.
Los maximos pueden incluir el corte deliberado de conexion. La memoria RSS no
incluye el proceso de clientes sinteticos.

## Resultados sin perfilador

Apple M4, 10 CPU logicas, 24 GiB RAM, Node v24.13.1, macOS ARM64.
Medicion final de 20 segundos por etapa tras incorporacion y 3 s de calentamiento.
Sin otras baterias de tests ejecutandose simultaneamente en la medicion final.

| Clientes | Salas | Limbo Hz | Shooter Hz | ACK p95 Limbo / Shooter | CPU media | RSS maxima |
| --- | --- | --- | --- | --- | --- | --- |
| 40 | 25 Limbo + 15 Shooter | 19.94 | 58.22 | 161 / 55 ms | 73.94% | 371.81 MiB |
| 80 | 2 x 25 Limbo + 2 x 15 Shooter | 18.32 | 44.25-44.30 | 466 / 180 ms | 96.83% | 456.19 MiB |

40 clientes completaron el criterio de simulacion >=90% del objetivo (20/60 Hz).
Esto NO significa que sus picos o latencias ya sean optimos. Con 80 clientes el
criterio falla: el proceso se acerca a saturar un nucleo y el Shooter pierde ritmo.
No hubo desconexiones inesperadas; el chat y las reconexiones de prueba funcionaron.
Ambas etapas acabaron con cero sockets y cero jugadores de prueba restantes.
Los intentos posteriores de 160/300 se detienen ante el primer fallo: no estan validados.

Una primera pasada de 30 s tambien paso con 40 y fallo con 80. El perfil CPU
posterior concentra el coste en `CharacterController.beforeStep`, especialmente
`computeColliderMovement`; el coste del chat/invitaciones no domina ese perfil.
El perfilado es diagnostico: no se usan sus tiempos como medicion final de capacidad.

Datos completos locales:

- `.local/stability-baseline-2026-10-24.json`
- `.local/stability-mixed-2026-10-24.json`
- `.local/stability-profile-2026-10-24.json` y el `.cpuprofile` de esa pasada.

## Regresiones verificadas

- 85 tests de backend correctos: combate, posiciones, asientos, instrumento,
  admision, reservas, nombres e invitaciones, inactividad y rondas.
- 5 tests de navegador correctos: cortes en ambos modos, cola y reserva tras
  recarga, instrumento con historial de prediccion perdido, recuperacion de
  posiciones divergentes/asientos, y cuenta atras con reinicio real de ronda.
- Las pruebas funcionales anteriores no se han ejecutado como 300 navegadores.
- La voz y los FPS del cliente no forman parte de esta carga SDK.

## Repetir

Desde WEBSDPv1:

```sh
npm run test:stability -- --clients 40,80 --duration 20 --output .local/stability-repeat.json
npm run test:stability -- --clients 80 --duration 20 --profile --output .local/stability-profile.json
node --test scripts/load-multiplayer.test.mjs scripts/stability-multiplayer.test.mjs
npm run test:server
npm run typecheck:all
npm run build
```

La herramienta no acepta URL remota. El maximo configurable es 300 clientes;
se detiene al fallar, ante paradas de estado >3 s, retrasos de metricas, backlog
de inputs o RSS de servidor >1536 MiB. Este presupuesto es local, NO el limite
del plan de Render. Se comprueba memoria tambien durante la creacion de salas.
La duracion configurable esta limitada a 10-600 s por etapa. Los procesos y
sockets de prueba se cierran al terminar; cancelar interrumpe las etapas siguientes.

## Conclusion y siguiente trabajo

No se puede certificar el objetivo de 250-300 usuarios con este resultado, ni
extrapolarlo al hardware gratuito de Render. Aumentar un limite de jugadores
no soluciona el coste medido. Antes de una prueba mayor:

1. Optimizar las consultas del controlador/collider del Shooter conservando
   colisiones, escaleras, crouch y paridad entre cliente y servidor.
2. Repetir este mismo escenario y una prueba mas larga, sin ocultar el fallo
   bajando el criterio ni eliminando la fisica de los bots.
3. Dimensionar y repartir salas entre procesos en el hardware de lanzamiento.
   El directorio social y la admision actuales son por proceso; no basta con
   aumentar replicas sin coordinar nombres, invitaciones y plazas dentro de la region.
4. Probar posteriormente voz, clientes Safari/movil y red entre regiones.

No se ha modificado ningun plan ni aprovisionado servidores.
