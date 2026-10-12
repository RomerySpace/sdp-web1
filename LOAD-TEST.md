# SDP: prueba de carga del multijugador

La herramienta `scripts/load-multiplayer.mjs` simula visitantes con el SDK de Colyseus que ya utiliza la web. No modifica la aplicacion ni requiere instalar otro sistema de red.

## Resultado del 11 de octubre de 2026

Prueba autorizada contra el backend publico de Render, con dos minutos de medicion por fase, 15 segundos de calentamiento y 15 segundos de descanso entre fases. Todos los clientes enviaron movimiento continuo. Los datos finales de recursos se volvieron a consultar despues de esperar la ingestion de metricas de Render.

| Clientes | Salas | CPU media / maxima | Memoria media | Confirmacion de movimiento p95 | Desconexiones |
| --- | --- | --- | --- | --- | --- |
| 25 | 1 | 27.86 % / 42.16 % | 108.91 MiB | 139.59 ms | 0 |
| 50 | 2 | 48.00 % / 88.54 % | 109.77 MiB | 164.18 ms | 0 |
| 100 | 4 | 74.83 % / 100.00 % | 112.98 MiB | 180.95 ms | 0 |

Las salas contenian exactamente 25 clientes cada una. Los 25, 50 y 100 clientes se movieron; la simulacion se mantuvo en aproximadamente 20 Hz. Se recibieron 200/200, 400/400 y 800/800 entregas de chat respectivamente, sin mensajes cruzados entre las salas de prueba. La retirada de los clientes se confirmo en las tres fases y no quedaron sockets de prueba abiertos. El backend respondio HTTP 200 y `status: ok` al terminar.

Con 100 clientes, la confirmacion mas lenta fue de 464.37 ms y el mayor intervalo entre estados observado fue de 412.48 ms. La CPU alcanzo su limite en las muestras de Render, aunque no hubo desconexiones. Por tanto, 100 clientes completaron esta prueba corta, pero no deben presentarse como capacidad garantizada para un evento real con la instancia actual. Los resultados tampoco prueban la capacidad de LiveKit ni los FPS del navegador.

La API de Render devolvio un limite de 0.15 CPU y 512 MiB durante esta ejecucion. Los porcentajes se calcularon contra ese limite observado, no contra la descripcion comercial del plan. Son cinco muestras por fase con resolucion de 30 segundos; la maxima no es un pico instantaneo. El generador mantuvo aproximadamente 19.7 entradas por cliente y segundo, frente al objetivo de 20.

El informe detallado, incluyendo muestras originales de Render, esta en `.local/load-test-render-2026-10-11.json`. No contiene claves ni tokens. El trafico de aplicacion recibido por el generador sumo 245.31 MiB; el trafico facturable puede ser mayor. No se desplegaron cambios, no se cambiaron planes y no se generaron sesiones de voz para esta prueba.

## Alcance

- Fases sucesivas de 25, 50 y 100 clientes, repartidos en 1, 2 y 4 salas de hasta 25.
- Cada cliente envia entradas de movimiento a 20 Hz. El servidor sigue validando y simulando el movimiento.
- Cada sala envia un mensaje de chat cada 15 segundos; se comprueban destinatarios, remitente y aislamiento entre salas.
- Se miden ping WebSocket, confirmacion de entradas, frecuencia de simulacion, intervalos entre estados, conexiones y trafico recibido.
- El generador tambien mide su propio retraso de ejecucion para detectar si esta limitando la prueba.
- Los clientes crean salas nuevas y entran por su ID; no se incorporan a salas existentes de visitantes.
- Si un visitante entra durante la preparacion, se interrumpe la prueba. Las salas de prueba no son privadas durante ese breve intervalo.
- Se detiene ante desconexiones, entradas sin confirmar, estados bloqueados, fallo de salud, entrega incorrecta del chat o memoria por encima del 85 % del limite, cuando hay metricas de Render.
- Se cierran las conexiones simuladas al terminar cada fase, incluso si la prueba falla. Antes de cerrar el ultimo cliente de cada sala se comprueba que los demas hayan desaparecido.

No mide renderizado Three.js, FPS, voz de LiveKit, clientes desde multiples ubicaciones ni estabilidad durante horas. La capacidad de una sala sigue siendo 25 aunque el servidor maneje varias.

## Ejecutar en local

Instala las dependencias con `npm run install:all` y arranca el backend con `npm run dev:server`. En otra terminal, desde la raiz del proyecto:

```sh
npm run test:load
```

Por defecto conecta a `http://127.0.0.1:2567`, calienta 15 segundos, mide dos minutos por fase y descansa 15 segundos entre fases. Guarda un informe JSON en `.local/`, que no se publica en GitHub.

Para una comprobacion breve:

```sh
npm run test:load -- --clients 25,50,100 --duration 5 --warmup 2 --cooldown 1
```

## Ejecutar contra Render

Solo con autorizacion del propietario y durante una ventana de prueba: puede afectar a visitantes y consume trafico del plan. No solicita acceso de voz, no conecta microfonos y no contrata ni amplifica servicios.

```sh
npm run test:load -- --url https://sdp-web1-multiplayer.onrender.com --allow-remote --clients 25,50,100 --duration 120
```

Los destinos remotos requieren `--allow-remote` para evitar lanzar carga accidentalmente sobre produccion. El limite de la herramienta es 100 clientes. Ctrl+C solicita una parada y limpieza.

Para recoger CPU y memoria, tambien acepta `--render-service srv-db5qnavlk1mc73atptjg` si `RENDER_API_KEY` esta disponible en el entorno del proceso. Esa credencial solo se utiliza contra la API oficial de Render; nunca pertenece al frontend ni al informe. No publiques la clave ni la introduzcas en el chat. Tambien puedes revisar las graficas del panel de Render sin proporcionar ninguna clave a la herramienta.

## Interpretacion

- `inputAcknowledgementMs`: desde el envio de una entrada hasta recibir el estado que confirma su procesamiento. Incluye red, simulacion y sincronizacion; no es el ping puro.
- `websocketPingMs`: viaje de ida y vuelta por WebSocket con la funcion del SDK.
- `p95`: el 95 % de las muestras queda en ese valor o por debajo.
- `observedSimulationHz`: avance del contador de pasos del servidor respecto al tiempo del generador. Objetivo: 20 Hz.
- CPU y memoria se consultan con resolucion de 30 segundos; no son picos instantaneos. Los porcentajes usan los limites que devuelve Render, no valores supuestos del plan.
- `receivedApplicationMiB` cuenta los mensajes WebSocket recibidos por los clientes de prueba; no incluye TLS ni todo el trafico facturable de la plataforma.
- `cleanup.confirmed` confirma la retirada observada de los clientes y el cierre de sus sockets.

Las pruebas cortas ayudan a detectar limites, pero no garantizan que el mismo numero de personas con voz y graficos mantenga ese rendimiento durante un evento completo.

## Validar la herramienta

Desde `server/`:

```sh
node --import tsx --test ../scripts/load-multiplayer.test.mjs
```
