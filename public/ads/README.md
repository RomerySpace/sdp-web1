# SDP · Media map

El sistema carga `/ads/slots.json` al entrar al shooter. Cada zona tiene cuatro paredes (`north`, `east`, `south`, `west`); cada pared tiene su carpeta. Las etiquetas son referencias editoriales, no nombres oficiales de Dust 2.

| Zona | Punto de referencia X/Y/Z | Uso |
|---|---|---|
| east-court | 50 / 2.4 / -40 | Carteles verticales y TV horizontal |
| west-court | 10 / 2.4 / -40 | Carteles verticales y TV horizontal |
| south-court | 40 / 2.4 / 0 | Carteles verticales y TV horizontal |
| north-street | 10 / 2.4 / 30 | Carteles verticales y TV horizontal |

Cada dirección busca la primera pared a un máximo de 24 m. Solo se monta si toda la superficie tiene pared detrás; un hueco, puerta o superficie oblicua invalida el emplazamiento. Las posiciones reales están disponibles en `window.sdpUnified.modes.shooter.snapshot.media` en desarrollo con `?debugMode=shooter`.

Para añadir un cartel NYC/KOREA, guarda la imagen en la carpeta y añade al slot:

```json
"image": "/ads/east-court/north/poster.webp"
```

Para una TV, usa `kind: "tv"`, proporción 16:9 y:

```json
"video": "/ads/east-court/east/screen.mp4"
```

Imágenes y vídeos son opcionales. Sin contenido aparece un identificador discreto. Puedes modificar `anchor`, `direction` y `size`; las coordenadas son metros del mapa importado. La TV está hecha con geometría simple, se apoya en una pared existente y no requiere GLB. Los vídeos son mudos, en bucle, y se detienen al pausar o salir. Las imágenes y vídeos remotos requieren HTTPS y CORS. Conviene usar vídeos pequeños y cortos; no activar 16 vídeos de alta resolución a la vez.
