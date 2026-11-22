# Hero de la tienda (laptop que se ensambla con el scroll)

Coloca aquí:

- `laptop-assemble.mp4` — clip horizontal 16:9, 8–10 s, una sola toma.
  Para que el scroll sea fluido (hacia arriba y hacia abajo), recodifícalo con
  un fotograma clave en cada cuadro:

      ffmpeg -i original.mp4 -an -c:v libx264 -g 1 -crf 22 -pix_fmt yuv420p -movflags +faststart laptop-assemble.mp4

- `laptop-ensamblada.jpg` — fotograma final (laptop armada, pantalla verde jade).
  Se usa con movimiento reducido y mientras carga el video. Si falta el MP4,
  el hero muestra esta imagen sin romperse.
