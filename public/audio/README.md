# Música compartida SDP

No hay canciones incluidas en esta versión. Añade los archivos a esta carpeta o a un almacenamiento con CDN, y completa `playlist.json`:

```json
[
  {
    "id": "track-001",
    "title": "Título real",
    "artist": "Artista real",
    "url": "/audio/track-001.mp3",
    "duration": 240.125
  }
]
```

`duration` debe ser la duración real en segundos. Los IDs deben ser únicos. Todos los clientes deben usar la misma lista, orden y duraciones. La interfaz solo muestra título/artista cuando se está reproduciendo audio; la lista vacía no muestra metadatos inventados.

Un único reproductor transmite la canción actual y continúa entre Limbo y Shooter. El servidor aporta una referencia de tiempo UTC; una época común selecciona canción y posición. Un usuario que llega tarde se incorpora al mismo punto del programa; se corrigen desviaciones superiores a 0.6 s. Es sincronización aproximada de radio, no audio de precisión de estudio. La reproducción requiere interacción inicial y depende del búfer del navegador. Una actualización de la lista requiere recargar los clientes.

Para probar pocas canciones, los MP3 locales son sencillos. Para un catálogo creciente, recomiendo almacenamiento de objetos + CDN (por ejemplo R2 con dominio propio). El navegador solo carga la pista actual; no se empaqueta toda la biblioteca dentro de JavaScript. A 192 kb/s, cuatro minutos son aproximadamente 5.76 MB, tanto si se alojan aquí como fuera; cambia el lugar de almacenamiento y entrega, no el tamaño del audio.

No usaría enlaces de compartir de Drive como servidor de música de producción: son un flujo de compartición/descarga y no una configuración de distribución pública controlada para este reproductor. Un CDN permite configurar URLs estables, caché y CORS. Para audio remoto, permite el origen de la web en CORS y usa Content-Type de audio y solicitudes de rango.

Referencias:
- https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
