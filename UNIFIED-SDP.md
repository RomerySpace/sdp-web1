# SDP unificado: Limbo y Shooter

## Copia y seguridad

La carpeta de trabajo es `/Users/alvarometzker/Documents/alvarometzker/SDP/WEBSDPv1`.
Se creo con `git worktree add -b feature/unified-sdp`, partiendo de WEB1, y se trasladaron tambien sus cambios locales sin confirmar.
El remoto sigue siendo `https://github.com/RomerySpace/sdp-web1.git`.
La copia inicial no publico cambios. Las actualizaciones publicas posteriores se realizan solo con autorizacion del usuario, en el mismo repositorio y sin cambiar planes. El worktree comparte metadatos Git, pero los archivos de los dos originales no se modificaron.

Originales:

- WEB1: `../WEB1v1/WEB1v1 GRAFICOS CODE`.
- WEB2: `../WEB2v1/WEB2v1 CODE`.

No se trasladaron node_modules, dist, caches, certificados, conexiones privadas de Vercel/Render ni archivos .env con credenciales.
Las plantillas .env.example y las configuraciones de despliegue se conservaron.

## Arrancar

Requiere Node 22.12 o posterior. Desde esta carpeta:

```sh
npm run install:all
npm run prepare:shooter
npm run dev:unified
```

Abrir `http://localhost:5373/`. Backend: 2587. LiveKit local: 7980, WebRTC TCP 7981 y UDP 7982.
Los puertos nuevos permiten conservar los servicios de WEB1. Ctrl+C detiene solo los servicios iniciados por este comando.
El comando inicia frontend, backend y, cuando hay un ejecutable compatible, LiveKit local con credenciales aleatorias guardadas en .local, fuera de Git.
Si la sesion de entrega ya dejo la aplicacion en segundo plano, no arrancar otra copia en los mismos puertos. Desde WEBSDPv1 puede detenerse con `kill $(cat .local/unified-dev.pid)` y volver a ejecutar npm run dev:unified.
Vite actualiza el frontend durante el desarrollo y Node observa el backend. Un reinicio del backend reinicia sus salas: los clientes deben reconectar.
Si faltan ejecutables intenta instalarlos mediante el instalador local ya existente. No contrata LiveKit Cloud ni instala certificados en el sistema.
Si la voz no puede arrancar, imprime el motivo y mantiene frontend/backend disponibles. `SDP_LOCAL_VOICE=0 npm run dev:unified` permite probar sin voz.
Si ya se han configurado credenciales y URLs de LiveKit en server/.env, reutiliza esa infraestructura.

Para cambiar puertos en macOS:

```sh
SDP_WEB_PORT=5375 PORT=2589 LIVEKIT_PORT=7984 LIVEKIT_RTC_TCP_PORT=7985 LIVEKIT_RTC_UDP_PORT=7986 npm run dev:unified
```

`npm run dev`, `dev:server`, `dev:all` y `dev:lan` siguen disponibles. Para probar microfonos por Wi-Fi, usar el flujo HTTPS de LAN.md y confiar el certificado en ambos dispositivos. HTTP en localhost permite microfono; HTTP con la IP de otro ordenador no equivale a un contexto seguro.

## Entrar y cambiar de modo

1. Pulsar CLICK TO ENTER y elegir USERNAME (2-20 caracteres). ENTER inicia la sesion y abre la niebla. Antes de elegir nombre, el fondo y el totem permanecen completamente blancos. El nombre se conserva localmente y al cambiar de modo; no es una cuenta autenticada.
2. Acercarse a unos 3 metros de la escultura y mirarla. Aparece E / INTERACT.
3. Pulsar E abre directamente la inspeccion original, sin menu. E o ESC cierran la inspeccion.
4. Solo aparece JOIN SHOOTER TEST, centrado abajo. Al pulsarlo se carga la simulacion y se cambia de sala. Inspeccionar no descarga mapa, fisica ni codigo exclusivo del Shooter.
5. ENTER SIMULATION obtiene el control del raton mediante un gesto nuevo, necesario cuando la carga ha agotado la autorizacion del navegador.
6. En Shooter: WASD, raton, SPACE, SHIFT, CTRL, R, boton izquierdo y boton derecho conservan su comportamiento original. B alterna SEMI-AUTO / AUTO; mantener boton izquierdo en AUTO dispara una rafaga con elevacion progresiva de mira, compensable con el raton.
7. P abre/cierra el menu de sesion; su indicacion esta siempre visible durante la partida. ESC sigue abriendo la pausa. El mismo menu contiene clasificacion, sensibilidad, volumen, silenciar y RETURN TO LIMBO. RESUME o P recuperan el control; volver a Limbo no recarga la pagina.

La clasificacion muestra puesto, nombre, kills y deaths de los jugadores conectados de la sala actual. Ordena por kills descendentes y deaths ascendentes; los empates restantes son estables por identificador. Los datos vienen del servidor, no son contadores locales inventados. La partida sigue para los demas mientras el menu libera el raton y detiene tus controles.
La sensibilidad (0.25x-2.50x, valor inicial 1x), volumen y silencio se guardan localmente. La sensibilidad se comparte con Limbo; el volumen controla los efectos del Shooter y la ambientacion de Limbo, sin cambiar el sistema de voz. B / CHANGE junto al modo de disparo indica la tecla para alternar AUTO y SEMI-AUTO.

Un fallo de carga ofrece RETRY o regreso a Limbo. Tambien puede cancelarse durante la carga.
La inspeccion tactil sigue disponible. El FPS requiere escritorio, raton y pointer lock, como WEB2.

## Probar dos navegadores

Abrir dos ventanas en la misma URL. ONLINE muestra la poblacion real de la sala.
En Limbo comprobar desplazamiento y ENTER para texto. Autorizar el microfono al mantener V; soltar V deshabilita inmediatamente la pista y silencia LiveKit, no solo el indicador. La voz se atenua con la distancia.
Entrar al Shooter en ambas ventanas. CTRL baja cabeza, torso y arma de los avatares; SHIFT corre. El servidor determina la region alcanzada: cabeza 100, torso 50, brazos/piernas 25 y pies 12 HP. Dos impactos al torso eliminan a un jugador con 100 HP; uno en la cabeza tambien. Los danos activan bordes digitales blancos y una reaccion discreta de camara.
Tras 7 segundos sin dano, se recuperan 10 HP por segundo hasta 100. Cualquier nuevo impacto interrumpe la recuperacion y reinicia los 7 segundos. K/D muestra el total de esta sesion de sala. El historial superior izquierdo muestra los nombres de atacante y victima durante 8 segundos, con un maximo de 6 entradas.
El historial confirma la baja; el otro avatar pierde geometria, emite fragmentos blancos/azules y se disuelve en 1.35 segundos. El eliminado ve DESYNCHRONIZED y no puede moverse, apuntar, disparar ni recargar.
El servidor lo reconstruye aproximadamente a los 3 segundos en otro punto seguro, con 100 HP, municion y retroceso reiniciados. La proteccion inicial dura 1.25 segundos y termina si dispara. Las paredes reales bloquean los impactos.
En Limbo, mantener SHIFT al moverse aumenta la velocidad a 1.5 veces, con aceleracion suave y solo 2 grados de FOV adicionales. El servidor utiliza la misma simulacion limitada.
Mantener una tercera ventana en Limbo permite comprobar que no recibe chat ni voz del Shooter.
Cerrar una ventana elimina su avatar. Volver a Limbo reconecta su voz correspondiente.

## Shooter sin recompensas

El Shooter no incluye rachas, mapa tactico, ataques aereos ni atajos 1/2/3.
Se conservan el combate autoritativo, K/D, puntos por baja, historial, ranking y
rondas de siete minutos. Las antiguas solicitudes de misil no tienen manejador
en el servidor. No se crean aviones, misiles, marcadores ni efectos de explosion,
y no se prepara una proyeccion del mapa durante la carga.

Regresion: `server/tests/shooter-clean.test.ts` comprueba doce bajas sin premios;
`tests/shooter-clean.spec.ts` comprueba interfaz, teclas, disparo y regreso al lobby.

## Desarrollo directo

- `http://localhost:5373/?debugMode=limbo`: diagnosticos de modo, sala, poblacion, FPS, ping, fisica y cache.
- `http://localhost:5373/?debugMode=shooter`: entrada directa al Shooter para desarrollo.

Estos accesos no existen en el build de produccion. No son mecanismos de administracion ni autenticacion.

## Modulos reutilizados de WEB2

Se importaron y adaptaron en src/modes/shooter:

- physics/PhysicsWorld.ts y CharacterController.ts: Rapier, capsula, gravedad, escaleras, salto y agachado.
- player/InputManager.ts y FirstPersonCamera.ts: controles e inercia Bodycam.
- weapon/Weapon.ts y ShootingSystem.ts: SDP, ADS, muelles, retroceso, recarga, impactos y obstruccion.
- world/MapLoader.ts, MapColliders.ts, MarbleMaterial.ts, Environment.ts y ContactShading.ts: Dust 2 real, marmol, niebla, HDR, sombras y contacto.
- config/gameConfig.ts, core/Spring.ts y audio/AudioManager.ts: parametros y efectos originales.

El arranque Game, el bucle GameLoop y el menu de entrada de WEB2 se reemplazaron por el ciclo de vida comun. No hay una segunda web ni un segundo renderer.
public/shooter contiene el mapa y Draco originales. El arma y el EXR utilizan los mismos public/SDP/SDPv1.glb y public/hdr/puresky.exr que Limbo: los hashes de ambos originales coinciden. No hay copias duplicadas de esos recursos; sus datos se mantienen en cache.

## Arquitectura y carga diferida

App conserva el unico requestAnimationFrame y WebGLRenderer. La inspeccion sigue siendo un estado del Limbo; GameModeManager controla la carga, Shooter y el regreso. No se abre el antiguo panel de interaccion.
ShooterMode solo se importa dinamicamente al entrar al Shooter. Rapier tiene un chunk separado. Sus shaders y CSS tampoco se agrupan con los complementos iniciales de Limbo.
AssetCache conserva buffers de modelos para repetir transiciones sin otra descarga. Cada modo posee y libera sus geometrias/materiales; no comparte recursos GPU que pueda destruir el otro.
La escena ligera de Limbo permanece en memoria, pero no actualiza ni renderiza durante Shooter. Al volver se liberan mundo, colisiones, HUD, listeners, sombras y entidades exclusivas del Shooter.
Los dos mundos y LiveKit utilizan AudioContextHub. El SDK puede crear y cerrar sondas breves de silencio; el mezclador de reproduccion es compartido.
ModeConfig.ts permite ajustar alcance y direccion de la interaccion.

## Backend y limites actuales

- SDPLimboRoom: sincronizacion original a 20 Hz, chat de sala y LiveKit de proximidad; 25 plazas.
- SDPShooterRoom: simulacion a 60 Hz, estados a 30 Hz, Rapier con colisiones reales del mapa, entradas validadas, estados de movimiento y acciones de arma; 25 plazas.
- SDPLobby sigue registrado como alias de compatibilidad. Sus salas no se mezclan con las nuevas.

La conexion Colyseus es una sola por visitante. Al cambiar, se espera la salida de la anterior; callbacks tardios no deben introducir entidades de otra sala.
Las posiciones de Shooter se calculan en el servidor, no se aceptan posiciones arbitrarias. Municion, cadencia y duracion de recarga se controlan tambien en el servidor.
El build genera una navegacion a partir del mismo GLB: soporte completo, espacio de capsula y conexiones transitables entre celdas. Selecciona la zona exterior conectada principal y 66 puntos separados a nivel de suelo, sin techo encima. Descarta azoteas, interiores y patios cerrados desconectados; no elige un tejado como alternativa. Cada entrada/reaparicion comprueba de nuevo la ocupacion y prioriza distancia respecto a jugadores vivos.
Los impactos y animaciones locales siguen siendo inmediatos, pero no deciden salud ni bajas. CombatSimulation usa esfera de cabeza, capsulas separadas para torso y extremidades, y cajas de pies. AvatarLayout comparte la pose geometrica con el renderer remoto, incluyendo agachado, apuntado y recarga. El rayo parte del jugador del servidor y usa su orientacion validada; el collider fijo mas cercano del mapa limita el alcance. No se aceptan victimas, regiones, origenes, posiciones ni danos enviados por el cliente.
El historial de objetivos compensa hasta 200 ms. La demora se calcula con sondas RTT emitidas por el servidor y los 70 ms de interpolacion, no con una fecha elegida por el cliente. No rebobina paredes estaticas ni permite golpear vidas anteriores.
Salud, DEAD, vida, fecha de muerte/reconstruccion y proteccion se sincronizan por estado y eventos de sala. El numero de vida impide que entradas o acciones antiguas afecten a una reaparicion. El servidor retira el cuerpo muerto de la fisica y elige puntos con suelo, espacio de capsula y separacion respecto a jugadores activos.
DigitalAvatarEffect reutiliza un lote de 48 fragmentos instanciados por avatar y materiales con disolucion por celdas y scanlines. Los recursos se liberan al salir. CombatFeedback genera una textura de borde una sola vez, dejando limpio el centro; el dano activa muelles suaves de camara. No hay sangre, rojo ni ragdolls.

La correccion local compara la posicion autoritativa con la prediccion historica de esa entrada confirmada, conservando el movimiento posterior. Las correcciones pequenas se absorben visualmente de forma suave; los saltos grandes siguen restableciendo la posicion segura del servidor. Las entradas viajan a 30 Hz, con cambios de control y disparos enviados inmediatamente; la fisica sigue a 60 Hz. Los avatares usan fechas del servidor, un buffer adaptable de 70-140 ms y extrapolacion limitada a 100 ms para interrupciones breves. El Shooter recupera pasos acotados cuando el renderizado baja de 20 FPS. El Limbo conserva su ritmo anterior.
El montaje del arma remota separa la orientacion importada del giro de apuntado. El canon sigue yaw/pitch y el fogonazo pertenece al mismo soporte. Al reaparecer no se interpola desde la ubicacion de la vida anterior.
El generador del servidor agrupa la misma geometria en trimeshes por zonas, reduciendo 1.277 colliders a 76 sin alterar los 847.353 triangulos. Ejecutar npm run prepare:shooter y reiniciar el backend tras cambiar este generador; un proceso ya arrancado conserva sus colisiones en memoria.

**Limites del prototipo:** el historial permite correccion con prediccion, pero no replay completo de entradas/fisica pendientes. La compensacion es un rebobinado limitado de objetivos sobre el mapa estatico, no un sistema competitivo completo con validacion historica de puertas moviles. No hay equipos, rondas, anticheat avanzado ni estadisticas persistentes; match sigue siendo practice.
Las animaciones procedimentales no se transmiten fotograma a fotograma.
No se han implementado Redis, seleccion regional, matchmaking competitivo ni limite global/cola de 300. No se ha validado capacidad para 300 ni latencia intercontinental de 40-60 ms.

## Voz solo en Limbo

La captura y la publicacion se reutilizan mientras se permanece en el lobby. Soltar V deshabilita la pista y aplica mute; no hay audio de microfono transmitido. El navegador puede seguir mostrando su indicador de dispositivo preparado. Ocultar la pagina, cambiar de sala, perder conexion o cerrar la experiencia detiene la captura y elimina la publicacion. Esto evita renegociar continuamente la ruta de sonido del dispositivo y cortar la musica en cada pulsacion.

La musica pasa por una sala estereo de 8.5 segundos con predelay de 65 ms; el control de volumen y mute se aplica despues de toda la mezcla, incluida la cola. Pequeños desfases del programa compartido se corrigen con velocidad limitada al 2.5 %, conservando el tono. Solo la entrada, el retorno de segundo plano, un cambio de tema o un desfase superior a 8 segundos provocan una busqueda directa. Algunos dispositivos pueden cambiar de ruta/calidad al autorizar el microfono por primera vez; comprobar tambien con auriculares y el telefono real.

El chat conserva los ultimos 30 mensajes por sala. Abierto permite scroll de raton o gesto tactil y no baja forzosamente cuando se leen mensajes antiguos. ENTER con el campo vacio o solo espacios lo cierra sin enviar. Las trazadoras de otros visitantes nacen en el cañon de su avatar interpolado y terminan en el impacto autoritativo; el origen de validacion del servidor no cambia.

Al salir se paran microfono, publicaciones, pistas remotas y conexion LiveKit. SDPShooterRoom no entrega tokens de voz.
Al regresar, el token se vincula a la nueva sesion y sala Limbo. El chat del Shooter reutiliza Colyseus y queda aislado del de Limbo.
Para produccion se necesitan las credenciales del backend y la cuota adecuada del servicio de voz; nunca se incluyen secretos en el bundle.

## Parametros y acceso temporal

`shared/GameplayConfig.ts` centraliza salud, regionDamage, regenerationDelay/Rate, cadencia semi/automatica, recoil, duracion/limite de killfeed, alcance, cargador, recarga, reaparicion, proteccion, compensacion, fragmentos, disolucion/reconstruccion, impulso/vineta y sprint/FOV de Limbo.
Los graficos de Limbo se reconstruyen completamente y tienen mas opacidad a distancia; el comportamiento cercano de desvanecimiento y transparencia se mantiene.
`ENABLE_SHOOTER_TEST = false` desactiva el acceso tanto en navegador como servidor. Reconstruir y desplegar ambos para una publicacion coherente; el codigo y los assets no se borran.
El backend admite ademas `ENABLE_SHOOTER_TEST=false` en su entorno para restringir rapidamente todos los joins: comunica la restriccion a Limbo y rechaza crear o entrar en salas Shooter, incluso con un SDK externo. Reiniciar el backend tambien desconecta las salas existentes. No basta con editar un boton del frontend.
Los shortcuts debug solo existen en desarrollo y respetan la restriccion. En produccion no se expone sdpUnified ni se interpreta debugMode.

## Construir y verificar

```sh
npm run typecheck:all
npm run test:server
npm run build
npm run test:unified
npm run test:regression
npm run test:shooter-disabled
```

La suite unificada comprueba solicitudes reales, renderizado con pixeles/capturas, dos clientes, impactos/DEAD/reaparicion/agachado, sprint, aislamiento, controles, transiciones y audio WebRTC con una senal sintetica. Las pruebas usan puertos separados 5383/2597/7990 para no mezclar visitantes de desarrollo. No equivale a una prueba entre dos ordenadores fisicos ni a una prueba de carga masiva.
Incluye dos navegadores con 80 ms de retraso en cada direccion y jitter adicional: comprueba que el arma remota apunta correctamente, que los spawns estan en el suelo, que no hay teleports y que la posicion local converge. Los mensajes se copian antes de retrasarlos porque el SDK reutiliza buffers. Los diagnosticos exclusivos de desarrollo muestran FPS real, ping, jitter, buffer y numero de correcciones/teleports.

Para comprobar el build compilado contra el backend aislado que inicia Playwright, abrir otra terminal:

```sh
SDP_BACKEND_PORT=2597 SDP_LIVEKIT_PORT=7990 npm run preview -- --port 5384 --strictPort
```

Y en una tercera:

```sh
SDP_PRODUCTION_URL=http://127.0.0.1:5384 npm run test:unified
```

## Vercel y Render

Pantalla completa movil: los menus de Limbo y Shooter usan la API estandar o la variante WebKit, siempre desde el toque original. Si el navegador la bloquea, el boton responde con un estado legible, no queda desactivado sin explicacion. `public/manifest.webmanifest` y los metadatos Apple permiten abrir SDP como web app desde la pantalla de inicio. En Safari: Compartir > Anadir a pantalla de inicio > abrir el icono SDP. No se instala un service worker ni se guardan modelos o versiones antiguas en una cache offline. Sigue haciendo falta conexion para el multijugador.

La parte superior del monolito refleja el perfil organico de la base y comparte su acabado blanco satinado. Comienza a 2.85m para mantener libre el hueco de la escultura; no cambia el collider del pedestal.

Audio: disparo, pasos, recarga, vuelo y explosion mantienen sus efectos sintetizados. Las rampas de volumen sustituyen la automatizacion anterior y alcanzan cero real, tanto en efectos como en musica. El siguiente gesto reactiva el contexto compartido tras una interrupcion del navegador. Ocultar Shooter detiene sus fuentes sin suspender el contexto de musica/voz; salir libera tambien los sonidos cortos pendientes. La musica de prueba del lobby esta en public/audio/music y se registra en public/audio/playlist.json; la fuente se situa sobre el monolito y se atenua al alejarse.

Personajes Shooter: AnonymousFigure genera una figura blanca sin rostro, con geometria compartida, acabado mate y extremidades continuas deformadas por SkinnedMesh. El servidor avanza gaitPhase/gaitX/gaitZ segun el desplazamiento real. AvatarLayout calcula rodillas, tobillos y pies para el render y los impactos historicos del servidor; los pasos se detienen al quedarse quieto y se amplian y aceleran al correr. Los esqueletos liberan sus recursos al salir. FirstPersonHands vive bajo el pivote de retroceso, acompana ADS, carrera y ocultacion del arma, y mueve la mano de apoyo durante la recarga. Solo se carga con el modulo Shooter.

Pruebas especificas: `npm run test:unified -- --grep 'fullscreen|WebKit|actual mobile menus|upper monolith|white lobby ground'`. Miden audio real con AnalyserNode, prueban los menus tactiles de ambos modos, volumen/silencio, recuperacion y un unico AudioContext. La compatibilidad WebKit y el bloqueo de API se simulan; las pruebas de Chrome movil emulado no sustituyen un iPhone/Android fisico.

Vercel conserva npm run build y dist. El endpoint de Colyseus sigue configurado mediante VITE_SDP_SERVER_URL, con HTTPS/WSS en publico.
Render conserva su estructura y variables privadas. El build instala las dependencias de raiz y servidor porque la fisica se reutiliza desde el mismo modulo de WEB2, y genera el archivo de colisiones antes de arrancar.
Shooter admite 15 jugadores por sala; Limbo conserva 25. La capacidad total de visitantes sigue siendo independiente y no se aumenta automaticamente.
`npm run prepare:shooter` genera `server/assets/dust2-colliders-v4.bin.gz` (ignorado por Git) y una copia identica en `public/shooter/physics/dust2-colliders-v4.bin.gz` (se incluye en Git para Vercel). Ambos modos de fisica Shooter usan esa misma superficie. Al modificar el mapa, regenerar e incluir tambien el recurso publico derivado. El modelo visual original no se simplifica.
El navegador descarga la fisica solo despues de JOIN SHOOTER y la reutiliza en siguientes entradas. La simplificacion conserva bordes, tiene un error geometrico configurado de 5 mm y valida superficies mediante rayos; ante diferencias conserva el bloque original. Ver `docs/SHOOTER-PHYSICS.md` para resultados y limites de las mediciones.
Cada publicacion debe coordinar frontend y backend: los cambios en esquemas, dano, regeneracion y navegacion necesitan ambos despliegues. Autorizar expresamente cualquier push/merge/cambio de produccion.
