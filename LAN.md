# SDP Web1: prueba por Wi-Fi, HTTPS, texto y voz

No se ha desplegado nada en Internet. La escena, el HDR, la escultura, los gráficos y los controles se mantienen. Colyseus sincroniza movimiento y texto. LiveKit local transmite el micrófono mediante WebRTC; el navegador reproduce las voces con audio 3D.

## Arranque

Abre en VS Code la carpeta **WEB1v1 GRAFICOS CODE**. En su terminal:

```bash
npm run dev:lan
```

Deja la terminal abierta. `Ctrl+C` detiene todos los servicios. No ejecutes a la vez `dev:all` o un servidor SDP anterior en esos mismos puertos. La terminal muestra la IP actual; puede cambiar al cambiar de Wi-Fi.

- Ordenador principal: `https://localhost:5173/`.
- Segundo ordenador: la URL **NETWORK** de la terminal, por ejemplo `https://10.200.14.37:5173/`.
- Nunca abras `localhost` en el segundo ordenador: apuntaría a ese ordenador, no al anfitrión.

El arranque detecta la IPv4 de la red privada, genera certificados para ella, inicia Colyseus en `0.0.0.0:2567`, LiveKit y Vite en `0.0.0.0:5173`. El navegador usa el mismo origen HTTPS: `/multiplayer` para Colyseus y `/voice` para LiveKit, con upgrades WSS. El tráfico WebRTC es cifrado (DTLS/SRTP) y usa directamente los puertos ICE del anfitrión, no el proxy HTTP.

## Certificado: obligatorio en ambos ordenadores

La CA solo sirve para este entorno de desarrollo. Instalarla añade una autoridad de confianza al dispositivo: hazlo exclusivamente en tus dispositivos de prueba y retírala cuando ya no la necesites. **No continúes ignorando advertencias de certificado. No desactives la seguridad del navegador.**

En el anfitrión:

```bash
npm run trust:lan
```

En macOS se instala en el llavero personal; el sistema puede pedir autorización. Cierra y vuelve a abrir el navegador. Si no lo permite, abre **Acceso a Llaveros**, importa `.local/rootCA.pem` en el llavero de inicio de sesión y configura ese certificado de desarrollo como de confianza para SSL.

Transfiere al segundo ordenador **solo** este archivo público, mediante AirDrop, USB u otro medio privado:

```text
.local/rootCA.pem
```

Nunca compartas `.local/ca/rootCA-key.pem`, `.local/https-key.pem`, `.local/livekit-credentials.json` ni `.local/livekit.yaml`. La clave de la CA permitiría suplantar certificados en los dispositivos que confían en ella. Estos archivos están fuera de `public`, excluidos de Git y bloqueados por Vite.

Instala el certificado público también en el segundo dispositivo:

1. **Mac:** Acceso a Llaveros, importar en el llavero de inicio de sesión, abrir el certificado mkcert de SDP, sección Confianza, confiar para SSL. Puede pedir la contraseña local.
2. **Windows:** renombra la copia pública a `SDP-rootCA.cer` si el importador lo necesita. Abre `certmgr.msc`, Autoridades de certificación raíz de confianza, Certificados, Todas las tareas, Importar; selecciona ese archivo en el almacén del usuario actual. Revisa que es tu CA local, no un certificado desconocido.
3. **Linux:** instala mkcert y las herramientas NSS según su documentación. Coloca únicamente `rootCA.pem` en una carpeta propia y ejecuta `CAROOT=/ruta/a/esa/carpeta mkcert -install` en ese ordenador. Puede solicitar permisos administrativos para el almacén del sistema.
4. **Firefox:** si no usa el almacén del sistema, importa también `rootCA.pem` en Ajustes, Privacidad y seguridad, Certificados, Ver certificados, Autoridades. Confía en ella para identificar sitios web. Reinicia Firefox.

En ambos navegadores, la URL debe abrirse sin aviso de certificado. Si el Wi-Fi o la IP del anfitrión cambian, reinicia `dev:lan`: renueva el certificado del sitio con la misma CA; no necesitas compartir una nueva raíz salvo que borres `.local/ca`.

Documentación oficial de confianza y precauciones: [mkcert](https://github.com/FiloSottile/mkcert).

## LiveKit y credenciales

No necesitas una cuenta, claves de LiveKit Cloud, Redis ni Docker. En este Mac, `setup:lan` descarga mkcert oficial y el binario standalone de LiveKit de la fórmula oficial de Homebrew, verificando SHA-256 para el paquete LiveKit. No instala Homebrew globalmente. Las herramientas quedan en `.local/tools`.

`dev:lan` crea un par aleatorio de claves **reales para este servidor local** y configura LiveKit con ellas. Colyseus recibe las claves por variables de entorno del proceso; nunca se envían al frontend. No son claves ficticias de un servicio externo. En otro sistema, instala LiveKit Server y configura `LIVEKIT_BIN` con la ruta del ejecutable; `MKCERT_BIN` permite reutilizar mkcert instalado.

Los tokens de voz se solicitan por la conexión Colyseus ya establecida. El backend fija la identidad al `sessionId` del jugador y la sala a `sdp-<roomId>`. Duran 60 segundos, solo permiten publicar micrófono, no cámara ni datos, y no incluyen privilegios administrativos. Al desconectarse un jugador se elimina su participante de voz y se detiene la captura local. Como limitación de un servidor autohospedado, un token robado podría reutilizarse hasta expirar: no compartas tokens. No se han añadido cuentas; la identidad sigue siendo la sesión anónima del prototipo.

Documentación oficial: [LiveKit local](https://docs.livekit.io/transport/self-hosting/local/), [tokens y permisos](https://docs.livekit.io/frontends/reference/tokens-grants/), [puertos WebRTC](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

## Prueba en dos ordenadores

1. Conecta ambos al mismo Wi-Fi normal, no a una red de invitados con aislamiento entre clientes.
2. Abre las URLs correspondientes, pulsa `CLICK TO ENTER` y comprueba `Connected`, `ONLINE: 2 / 25` y `VOICE CONNECTED`. Si hay más pestañas abiertas, ONLINE contará también esas sesiones.
3. Muévete con WASD. La otra persona debe ver tu avatar, como en la fase anterior.
4. Pulsa **Enter**, escribe y vuelve a pulsar **Enter**. Ambos deben ver el mensaje; tú apareces como `YOU` y el otro ve tu identificador `VISITOR XX`. El texto llega a toda la sala, sin límite de distancia. Texto vacío no se envía; **Esc** cierra el chat.
5. Mantén **V**. La primera vez, acepta el permiso del micrófono en el navegador. Si la ventana de permisos libera el cursor, vuelve a `CLICK TO RESUME` y mantén V de nuevo. El indicador debe cambiar a `TRANSMITTING`. Al soltarla, pasa a `MIC READY`: la pista se deshabilita y LiveKit aplica mute, por lo que no se transmite audio del micrófono. Se conserva la captura preparada para evitar cambios de ruta que interrumpan la música. El navegador puede seguir mostrando su indicador de dispositivo; ocultar la página o salir del lobby detiene y despublica la captura.
6. No tienes que pulsar un botón de micrófono cada vez. V no activa la voz mientras escribes; al perder el foco, pausar, ocultar o cerrar la pestaña se corta la transmisión. Tu propia voz no se reproduce en tus altavoces.
7. Usa auriculares. Colocaos a lados distintos y gira la cámara para comprobar izquierda/derecha. A 0–3 metros el volumen es completo; entre 3–15 disminuye suavemente; más allá de 15 es inaudible. Acercaos de nuevo para recuperarlo.
8. Cierra una pestaña: el avatar y su voz deben desaparecer y ONLINE bajar. Las salas distintas están aisladas tanto para texto como para voz. La atenuación por distancia es de reproducción local, no una política de privacidad del servidor.

## Ajustes opcionales

Crea `.env.local` a partir de `.env.example` solo si necesitas cambiar valores:

```dotenv
# IP concreta si se detecta otra interfaz, por ejemplo una VPN:
# SDP_LAN_IP=192.168.1.20
SDP_WEB_PORT=5173
PORT=2567
LIVEKIT_PORT=7880
LIVEKIT_RTC_TCP_PORT=7881
LIVEKIT_RTC_UDP_PORT=7882
VITE_VOICE_FULL_DISTANCE=3
VITE_VOICE_MAX_DISTANCE=15
```

No establezcas `VITE_SDP_SERVER_URL=http://localhost:2567` ni `ws://...` para la prueba LAN HTTPS. Por defecto se usa el proxy seguro y el hostname de la página abierta. Los únicos valores `VITE_*` son públicos: **nunca pongas secretos en ellos**.

Si 2567 está ocupado, detén el servidor SDP antiguo o cambia `PORT=2568` en `.env.local` y reinicia `dev:lan`; el proxy se ajusta automáticamente. Para otros conflictos, cambia los puertos correspondientes. El arranque no mata servicios desconocidos ni elige silenciosamente una URL diferente.

## Diagnóstico

- **No abre desde el segundo ordenador:** comprueba IP, misma Wi-Fi, aislamiento de clientes, VPN y firewall. Permite conexiones entrantes locales para Node/LiveKit: TCP **5173** (web), TCP **7881** y UDP **7882** (audio). No abras ni redirijas puertos del router a Internet. Los puertos 2567 y 7880 no son necesarios directamente en el navegador; se accede por HTTPS/WSS en 5173.
- **Advertencia HTTPS:** falta confiar en `rootCA.pem` en ese dispositivo, la IP cambió o estás usando un hostname no incluido. Reinicia `dev:lan` y verifica la CA. No saltes el aviso.
- **Disconnected:** revisa la terminal. Comprueba `https://<IP>:5173/multiplayer/health`: debe mostrar `status: ok`. Si un servicio termina, el arranque detiene los demás para no dejar una web que aparente estar operativa.
- **VOICE UNAVAILABLE:** comprueba que usas `dev:lan`, que se imprimió `VOICE SERVER READY`, que LiveKit sigue activo y que el firewall deja pasar los puertos de audio. Movimiento y texto siguen siendo independientes de la voz.
- **MICROPHONE BLOCKED:** en permisos del sitio, autoriza el micrófono; también revisa los permisos del sistema para Chrome/Firefox/Safari, el dispositivo de entrada y si otra aplicación lo está usando. Reanuda y vuelve a mantener V.
- **Voz conectada pero silencio:** ambos deben pulsar Enter/Click para desbloquear el audio del navegador, tener auriculares/altavoces activos, estar a menos de 15 metros y pertenecer a la misma sala. El control AMBIENCE solo afecta al sonido ambiental, no a las voces.

## Validación automatizada

```bash
npm run typecheck:all
npm run build
npm run test:server
npm test
```

Las pruebas WebRTC completas requieren `dev:lan` y una CA confiable. Con los servicios LAN ya arrancados, en Mac/Linux:

```bash
SDP_TEST_LAN=1 NODE_EXTRA_CA_CERTS="$PWD/.local/rootCA.pem" npm test
```

`NODE_EXTRA_CA_CERTS` añade la CA al proceso Node que ejecuta Playwright; no desactiva la validación TLS. Chrome usa la confianza del dispositivo. Las pruebas utilizan una señal de micrófono sintética y verifican paquetes WebRTC recibidos, energía de audio, paneo medido en ambos canales, atenuación, silencio fuera de radio, aislamiento de salas, liberación de V y foco, texto y movimiento. **Eso no equivale a probar físicamente dos ordenadores ni sus micrófonos: realiza también la prueba anterior.**
