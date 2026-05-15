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

## Supabase Storage y modo local
En Vercel, el proyecto usa **Supabase Storage privado** para subir las imágenes desde el navegador con signed upload URLs y así evitar el límite de payload de Functions al enviar archivos grandes al backend.

En local, por defecto procesa con `multipart/form-data` directamente contra el backend y no requiere storage remoto. Si necesitas forzar un modo, usa `MEDIA_STORAGE_MODE=local` o `MEDIA_STORAGE_MODE=supabase`.

Configuración mínima:
1. En Supabase, crea un bucket privado llamado `bulk-square` o define otro nombre con `SUPABASE_STORAGE_BUCKET`. Configura el bucket para aceptar `image/*` y el límite de tamaño que quieras permitir.
2. En Vercel, agrega las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` y `MEDIA_STORAGE_MODE=supabase`.
3. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY` en el frontend. Solo debe existir como variable server-side en Vercel.
4. Para local, usa `.env.local.example` como plantilla y carga esas variables antes de ejecutar `npm run dev`.

Flujo actual:
- En Vercel, el navegador pide al backend una signed upload URL de Supabase.
- El navegador sube cada imagen directamente a Supabase Storage.
- El backend procesa leyendo el archivo privado desde Supabase Storage.
- En local sin `MEDIA_STORAGE_MODE=supabase`, el navegador envía los archivos directamente al backend sin pasar por storage remoto.
- Las descargas de Vercel se guardan temporalmente en Supabase Storage privado y se sirven con signed URLs o por proxy backend.
- Los objetos de salida se borran automáticamente después de iniciar la descarga, y los objetos de entrada se limpian al usar **Limpiar** o **Limpiar al terminar**.

## Build + Producción
```bash
npm run build
npm start
```

## Uso
1. Arrastra o selecciona múltiples imágenes o carpetas. El navegador toma los archivos de imagen compatibles en el mismo orden en que llegan.
2. Elige color de padding (HEX).
3. Elige formato de salida (png/jpg/webp).
4. Elige el nombre de salida:
   - **Procesado**: agrega orden, tamaño y margen al nombre.
   - **Original**: conserva el nombre original y cambia solo la extensión final.
5. Elige tamaño final:
   - **Auto (max lado)**: usa el lado mayor original con tope inteligente de 2400px para mantener buena calidad con menor peso.
   - **Numérico** (ej: 1080): el cuadrado final será ese tamaño (la imagen se ajusta con contain).
6. Click **Procesar** → descarga un ZIP con los resultados.

## API
`POST /api/process`

Soporta dos modos:
- `multipart/form-data` legado con `images`
- `application/json` con `items: [{ blobUrl, originalName }]`

Campos comunes:
- `color` (HEX, ej: `#ffffff`)
- `format` (`png` | `jpg` | `webp`)
- `filenameMode` (`processed` | `original`)
- `sizeMode` (`auto` | `fixed`)
- `size` (número, requerido si sizeMode=fixed)
- `margin` (número)
- `downloadMode` (`zip` | `folder`)

Límites:
- Hasta 600 archivos por lote.

Respuesta:
- `application/zip`

`POST /api/process-single`
- `multipart/form-data` legado con `image`
- o `application/json` con `blobUrl` y `originalName`

`POST /api/blob/upload`
- ruta usada para emitir signed upload URLs de Supabase Storage

`POST /api/blob/cleanup`
- borra objetos privados temporales por path

## Notas
- Sharp usa libvips (incluida/bundled en la mayoría de instalaciones).
- Vercel limita a 4.5 MB el request body y también el response body de una Function, así que para lotes pesados no conviene devolver ZIPs o imágenes finales directamente desde la API.
- Para lotes muy grandes, la subida y la descarga final ya pasan por Supabase Storage, pero el ZIP todavía se arma en la función antes de subirse al storage temporal.
