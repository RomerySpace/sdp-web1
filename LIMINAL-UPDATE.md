# Actualización liminal · 14 octubre 2026

## Jugabilidad e interfaz

- Aviso de baja mayor en la zona central superior: nombres, +100 puntos por baja y progreso de racha. El marcador deriva de las bajas autoritativas y se reinicia con la ronda; no concede ventajas jugables.
- Rachas 3, 7 y 12, sin recompensas todavía. Se reinician al morir. El aviso no reproduce el historial al entrar tarde.
- Temporizador centrado, conexión verde más visible y HUD legible sobre escenas oscuras.
- Q/E desplaza la vista hasta 48 cm hacia cada lado y añade inclinación corporal. La cabeza y el torso visibles, las zonas de impacto y el origen del disparo siguen el desplazamiento autorizado. Un barrido de cabeza limita la inclinación junto a paredes; el disparo vuelve a comprobarla si se gira entre dos pasos de física. Mirar arriba/abajo pivota desde los ojos.
- Lobby con salto, agacharse, cámara corporal y sprint de 6.75 m/s (antes 4.5). El sprint del shooter sigue a 6 m/s.
- Los saltos y agachamientos del lobby se reflejan en los visitantes remotos. También hay controles táctiles.
- Escaleras: se detecta la superficie plana del peldaño con una sonda adelantada, evitando confundir la esquina redondeada de la cápsula con una pendiente imposible. Se conserva el límite de 0.38 m y se barre la cápsula completa arriba y adelante antes de elevarla. Cliente y servidor comparten la corrección.
- Chat colocado por encima de la altura real de instrucciones; estas se ocultan al escribir.
- Lobby sin cabecera superior izquierda ni leyenda inferior derecha. Inspección con JOIN SHOOTER a la izquierda y JOIN SUBASTA deshabilitado a la derecha.

## Ambiente

Suelo y césped blancos, con niebla progresivamente más oscura hacia el horizonte. Dos campos instanciados de 128 000 y 64 000 hojas se recentran alrededor de la cámara fuera de la zona visible, con densidad menor en la distancia. Se conservan el viento y el sombreado de las hojas; ya no hay un sendero de hierba baja en el spawn.

El monolito tiene una base blanca satinada de perfil curvo, un pie ensanchado ligeramente enterrado y una sombra de contacto discreta. La hierba llega hasta su borde. Se mantiene la altura de 1.2 m y toda la geometría queda dentro de la huella de colisión existente. El arma conserva su altura, rotación e inspección. La columna de niebla superior mantiene sus 300 m y el hueco del arma, con sección suavizada, movimiento lento y el mismo color de horizonte que el resto del lobby.

Cada ronda de shooter recibe día o noche desde el servidor, incluidos los usuarios que entran tarde. La selección permanece estable durante la partida. Ambos perfiles son más oscuros que antes. La pantalla nocturna de cámara y el flash/linterna quedan para una futura actualización.

## Música y publicidad

El reproductor de música es único para ambas salas, transmite solo la pista actual y usa una referencia temporal compartida. Título/artista aparecen en la parte derecha cuando hay reproducción. Consulta `public/audio/README.md`: los archivos y metadatos reales aún deben añadirse. La sincronización es aproximada (tolerancia 0.6 s), sujeta al búfer y la autorización de reproducción del navegador.

`public/ads/slots.json` contiene 29 emplazamientos candidatos, incluidos 15 carteles con imágenes locales en `public/ads/carteles-por-zonas`. Solo se dibujan las superficies con pared suficiente detrás. Hay carpetas por zona/pared, carga opcional de imagen/vídeo, un mapa en `public/ads/map.svg` y una guía en `docs/carteles/guia-visual.html`. Los vídeos de TV son mudos y se pausan al detener el juego.

## Publicación

El frontend y el servidor deben publicarse desde el mismo commit: los saltos/agachamientos del lobby, la inclinación del shooter y la iluminación por ronda utilizan estado sincronizado nuevo. Se conservan el proyecto de Vercel, el servicio de Render, la voz de LiveKit y sus configuraciones existentes. No hace falta contratar otro plan ni añadir nuevas credenciales.

Para verificar los cambios de Work desde la carpeta original, iniciar `npm run dev:unified` y ejecutar `SDP_LIMINAL_TEST_URL=http://localhost:5373 npx playwright test --config playwright.liminal.config.ts`. La música continúa sin pistas reales en el catálogo; las pruebas usan una pista temporal que no se publica.

## Comprobación

- Comprobación de tipos de cliente y servidor y compilación de producción.
- 43 pruebas de servidor: combate, respawns, matchmaking, validación, colisiones, peldaños cortos, música, rachas y acuerdo de día/noche entre clientes.
- Navegador: entrada, salto, chat, inspección, cambio de sala, Q/E, sombreadores sin errores y superficies publicitarias.
- Dos sesiones: desplazamiento físico Q/E y posición de la cabeza remota, además de título/artista y música sincronizada antes y después de entrar al shooter, con una pista de prueba que no se incorpora al catálogo.
- Pruebas existentes: entrada sin descarga del shooter, sprint del lobby y transición repetida entre salas, con liberación de recursos.

Las pruebas de escaleras recorren cuatro rutas del mapa original (subida corta de A, túnel, escalones laterales y peldaños altos), en ambos sentidos y con tres modos de movimiento: 24 recorridos sin salto. También comprueban juntas, paredes y techos bajos; no equivalen a recorrer cada rincón del mapa. La voz no se reconfigura: la vista previa aislada se ejecutó sin servidor de voz local. Los modelos originales y archivos de despliegue permanecen intactos.
