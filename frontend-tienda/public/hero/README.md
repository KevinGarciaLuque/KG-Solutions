# Hero de la tienda (laptop que se ensambla con el scroll)

Archivos que usa `src/components/HeroScroll.jsx`:

- `laptop-assemble.webm` — clip 16:9 de 10 s con **fondo transparente** (VP9 + alfa).
  Lo leen Chrome, Edge y Firefox; los circuitos se dibujan detrás de la laptop.
- `laptop-assemble.mp4` — el mismo clip con fondo liso (#101211) para Safari/iOS,
  que no leen alfa en WebM.
- `laptop-ensamblada.webp` — fotograma final con transparencia: movimiento reducido,
  carga del video o videos ausentes.

Para el scroll fluido en ambos sentidos los videos llevan un fotograma clave cada 2 cuadros
(`-g 2`). Si reemplazas el clip, recodifícalo igual:

    ffmpeg -i original.mp4 -an -c:v libx264 -g 2 -keyint_min 2 -sc_threshold 0 -crf 26 -pix_fmt yuv420p -movflags +faststart laptop-assemble.mp4

El WebM con transparencia necesita además un matte (silueta) por fotograma; ver el commit
del hero para el método usado.
