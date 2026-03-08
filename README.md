# bulk-square-beta

Proyecto beta para edición en bulk de imágenes: convierte a formato cuadrado (contain, sin crop) con padding color y exporta en PNG/JPG/WebP, devolviendo un ZIP.

## Requisitos
- Node.js 18+ (recomendado 20+)

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
`POST /api/process` (multipart/form-data)

Campos:
- `images` (múltiples archivos)
- `color` (HEX, ej: `#ffffff`)
- `format` (`png` | `jpg` | `webp`)
- `sizeMode` (`auto` | `fixed`)
- `size` (número, requerido si sizeMode=fixed)

Respuesta:
- `application/zip`

## Notas
- Sharp usa libvips (incluida/bundled en la mayoría de instalaciones).
- Para lotes muy grandes, se recomienda subir límites/procesar por chunks (este beta usa buffers en memoria).
