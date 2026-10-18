# SDP Field Instrument

Zona del Limbo en `x: -34, z: -26`, al lado opuesto del monolito respecto al arbol. Mesa sobre la hierba y seis bancos rodeandola, tres a cada lado, con dos plazas cada uno (12 plazas). No hay plataforma ni cambio de mapa.

## Uso

- Acercarse, mirar la mesa y pulsar E; en movil, tocar PLAY.
- Una sola persona controla el instrumento. Los demas ven OCCUPIED y su nombre.
- Teclado cromatico: A S D F G H J K L para blancas; W E T Y U O para negras. Z/X bajan/suben la octava. Tambien se puede tocar el piano con raton o varios dedos.
- Seleccionar una de las cuatro pistas. Cada pista permite PAD, GLASS, GRAIN o DRONE.
- El circulo arma la grabacion de la pista seleccionada. Tocar notas y desarmarlo para conservar el loop. Los loops tienen cuatro compases de 4/4 y una rejilla de semicorcheas.
- Play/Stop controlan la reproduccion compartida; Espacio la alterna. Cambiar el tempo con el transporte parado (50-110 BPM).
- LEVEL, FILTER, SPACE y ECHO afectan a la pista seleccionada. Cada pista tiene silencio y borrado independientes.
- Esc o X cierra la mesa y libera el control. Los loops grabados siguen sonando. V sigue disponible para voz cuando no se esta editando un campo.

## Escucha y exclusividad

La mesa usa el volumen **Game volume**, no Music volume. El audio procede de la mesa: nivel completo hasta 5 m y atenuacion suave hasta 30 m. No sustituye la musica ni LiveKit. Los usuarios cercanos de la misma sala escuchan notas y loops compartidos; las salas Shooter no reciben estos mensajes.

Colyseus valida distancia, propietario, estructura de los mensajes, notas, parametros, numero de notas simultaneas y limites de los patrones. No admite posiciones, sonidos externos ni listas de notas arbitrarias enviadas por el cliente. La reserva se libera al desconectar, salir de la sala, cerrar la mesa, alejarse o permanecer dos minutos sin tocar/modificar nada. Un heartbeat evita reservas fantasma; si desaparece durante 20 segundos, la mesa se libera.

Los patrones viven solo en la memoria de su sala. No son archivos guardados ni sobreviven al reinicio del servidor. Esta version usa el teclado del ordenador, no dispositivos MIDI USB ni plugins VST/Ableton.

## Audio y rendimiento

Tone.js se importa dinamicamente cuando hay actividad musical cercana o se abre la mesa. Usa el mismo AudioContext de musica y voz, sintesis polifonica limitada, un buffer de textura generado de forma determinista, GrainPlayer para granular real, filtro, delay y una reverberacion compartida. No se transmiten archivos ni audio por Colyseus.

El servidor proporciona reloj, transporte y eventos fechados. Los clientes programan el sonido con un pequeno margen de red de 180 ms. La incorporacion tardia conserva la fase del loop. Esto no es sincronizacion sample-accurate entre equipos: la red, el sistema y la salida de audio de cada dispositivo anaden diferencias. Para esta prueba se prioriza estabilidad del ambient, no monitorizacion profesional de latencia ultrabaja.

Configuracion compartida: `shared/AmbientStation.ts`. Sesion: `server/src/communication/AmbientStationSession.ts`. Sonido: `src/audio/AmbientSynth.ts`. Interfaz: `src/ui/AmbientInstrument.ts`.

## Pruebas locales

```sh
npm run dev:unified
```

Por defecto abre `http://localhost:5373/`; usa siempre la URL que imprima el terminal. El servidor de pruebas que esta activo ahora usa `http://localhost:5383/`. Abrir esa URL en dos ventanas. Una persona ocupa la mesa y graba una pista; la otra se acerca para escucharla. Intentar cambiar el transporte desde el otro cliente debe ser rechazado. Cerrar la mesa permite que otra persona la use. Los bancos comparten el sistema de sentarse existente.

```sh
npm run typecheck:all
npm run build
npm run test:unified -- --grep 'ambient instrument:'
npm --prefix server test
```

La primera importacion de una dependencia nueva puede hacer que Vite reinicie el cliente al optimizarla. Las pruebas deben ejecutarse con el servidor estabilizado. No hacen falta nuevas credenciales ni servicios externos. Para publicar este cambio haran falta frontend y backend actualizados juntos; no se ha cambiado ningun plan de alojamiento.
