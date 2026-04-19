# bulk-square-beta

Proyecto beta para edición en bulk de imágenes: convierte a formato cuadrado (contain, sin crop) con padding color y exporta en PNG/JPG/WebP, devolviendo un ZIP.

## Requisitos
- Node.js 20+

## Instalación
```bash
npm install
```

## Desarrollo (localhost)
```bash
npm run dev
```

Abrir:
- http://localhost:3000

## Vercel Blob
Este proyecto ahora usa **Vercel Blob privado** para subir las imágenes desde el navegador directamente al storage y así evitar el límite de payload de funciones al enviar archivos grandes al backend.

Configuración mínima:
1. En tu proyecto de Vercel, ve a **Storage** y crea un store de tipo **Blob** con acceso **Private**.
2. Verifica que el proyecto tenga la variable de entorno `BLOB_READ_WRITE_TOKEN`.
3. Si quieres probar localmente con las mismas credenciales, trae el env con `vercel env pull`.

Flujo actual:
- El navegador sube cada imagen a Vercel Blob mediante `client uploads`.
- El backend procesa leyendo el archivo privado desde Blob.
- Las descargas grandes ya no salen como body de la Function: el backend sube el resultado final a un blob temporal y el navegador lo descarga desde ahí.
- Los blobs de salida se borran automáticamente después de iniciar la descarga, y los blobs de entrada se limpian al usar **Limpiar** o **Limpiar al terminar**.

## Build + Producción
```bash
npm run build
npm start
```

## Uso
1. Arrastra o selecciona múltiples imágenes.
2. Elige color de padding (HEX).
3. Elige formato de salida (png/jpg/webp).
4. Elige tamaño final:
   - **Auto (max lado)**: usa el lado mayor original con tope inteligente de 2400px para mantener buena calidad con menor peso.
   - **Numérico** (ej: 1080): el cuadrado final será ese tamaño (la imagen se ajusta con contain).
5. Click **Procesar** → descarga un ZIP con los resultados.

## API
`POST /api/process`

Soporta dos modos:
- `multipart/form-data` legado con `images`
- `application/json` con `items: [{ blobUrl, originalName }]`

Campos comunes:
- `color` (HEX, ej: `#ffffff`)
- `format` (`png` | `jpg` | `webp`)
- `sizeMode` (`auto` | `fixed`)
- `size` (número, requerido si sizeMode=fixed)
- `margin` (número)
- `downloadMode` (`zip` | `folder`)

Respuesta:
- `application/zip`

`POST /api/process-single`
- `multipart/form-data` legado con `image`
- o `application/json` con `blobUrl` y `originalName`

`POST /api/blob/upload`
- ruta usada por Vercel Blob para emitir tokens de client upload

`POST /api/blob/cleanup`
- borra blobs privados temporales por URL

## Notas
- Sharp usa libvips (incluida/bundled en la mayoría de instalaciones).
- Vercel limita a 4.5 MB el request body y también el response body de una Function, así que para lotes pesados no conviene devolver ZIPs o imágenes finales directamente desde la API.
- Para lotes muy grandes, la subida y la descarga final ya pasan por Blob, pero el ZIP todavía se arma en la función antes de subirse al storage temporal.
