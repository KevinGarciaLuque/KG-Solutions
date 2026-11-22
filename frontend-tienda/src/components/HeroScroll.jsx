import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SITE_INFO } from "../config/site.js";

/*
  Hero cinematográfico: una laptop que gira y se ensambla al hacer scroll.

  Archivos (carpeta frontend-tienda/public/hero/):
    - laptop-assemble.webm   → clip con transparencia (VP9 + alfa): la laptop va POR ENCIMA
                                de los circuitos. Chrome, Edge y Firefox.
    - laptop-assemble.mp4    → mismo clip con fondo liso (Safari / iOS, que no leen alfa en WebM).
    - laptop-ensamblada.jpg  → imagen fija de la laptop armada (movimiento reducido, mientras
                                carga el video, o si faltan los videos).

  El tiempo del clip sigue el progreso del scroll: bajar arma, subir desarma, detener el scroll
  congela el fotograma. Al terminar, el scroll continúa hacia el catálogo.
*/
const VIDEO_WEBM = "/hero/laptop-assemble.webm";
const VIDEO_MP4 = "/hero/laptop-assemble.mp4";
const POSTER_SRC = "/hero/laptop-ensamblada.webp";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const prefiereMenosMovimiento = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Safari / iOS no reproducen WebM con canal alfa: usan el MP4 de fondo liso
const soportaAlfaWebm = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return false;
  if (/^((?!chrome|chromium|android|edg).)*safari/i.test(ua)) return false;
  const v = document.createElement("video");
  return !!v.canPlayType?.('video/webm; codecs="vp9"');
};

// Pistas de circuito: salen de los bordes y convergen DETRÁS de la laptop (centro ≈ 1088,450)
const PISTAS = [
  "M0 150 H260 L330 220 H640 L720 300 H900",
  "M0 330 H180 L250 400 H560 L650 450 H880",
  "M0 560 H300 L380 480 H620 L700 450 H880",
  "M260 1000 V760 L330 690 V560 L430 480 H700",
  "M700 0 V120 L780 200 H960 L1010 250 V330",
  "M1760 120 H1380 L1300 200 H1180 L1130 250 V330",
  "M1760 340 H1420 L1350 410 H1260 L1230 440",
  "M1760 560 H1400 L1330 490 H1240 L1210 460",
  "M1760 790 H1330 L1260 720 H1130 L1090 680 V560",
  "M1060 1000 V790 L1030 760 V640 L1060 610 V560",
  "M900 0 V80 L960 140 H1180 L1250 70 H1600",
  "M0 40 H420 L480 100 H760",
];

const HeroScroll = () => {
  const sectionRef = useRef(null);
  const videoRef = useRef(null);
  const [estatico, setEstatico] = useState(prefiereMenosMovimiento);
  const [videoListo, setVideoListo] = useState(false);
  const [usaAlfa] = useState(soportaAlfaWebm);

  // Respeta el cambio de preferencia en caliente
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    const onChange = () => setEstatico(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Scroll → currentTime del video (con suavizado y sin trabajo en reposo)
  useEffect(() => {
    if (estatico) return undefined;
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video) return undefined;

    let objetivo = 0; // progreso real del scroll (0–1)
    let actual = 0; // progreso suavizado que se pinta
    let raf = 0;

    const leerProgreso = () => {
      const rect = section.getBoundingClientRect();
      const recorrido = rect.height - window.innerHeight;
      objetivo = recorrido > 0 ? clamp(-rect.top / recorrido, 0, 1) : 0;
    };

    const pintar = () => {
      raf = 0;
      actual += (objetivo - actual) * 0.2;
      if (Math.abs(objetivo - actual) < 0.0005) actual = objetivo;

      section.style.setProperty("--p", actual.toFixed(4));
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) {
        // Se evita el último instante exacto para no saltar al primer fotograma
        const t = clamp(actual, 0, 0.9995) * dur;
        if (Math.abs(video.currentTime - t) > 0.001) video.currentTime = t;
      }
      if (actual !== objetivo) raf = requestAnimationFrame(pintar);
    };

    const alCambiar = () => {
      leerProgreso();
      if (!raf) raf = requestAnimationFrame(pintar);
    };

    video.pause();
    alCambiar();
    window.addEventListener("scroll", alCambiar, { passive: true });
    window.addEventListener("resize", alCambiar);
    video.addEventListener("loadedmetadata", alCambiar);
    return () => {
      window.removeEventListener("scroll", alCambiar);
      window.removeEventListener("resize", alCambiar);
      video.removeEventListener("loadedmetadata", alCambiar);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [estatico]);

  const contenido = (
    <div className="hero-scroll__texto">
      <p className="hero-scroll__eyebrow">Tienda · Taller · Soporte</p>
      <h1 className="hero-scroll__titulo">{SITE_INFO.nombre}</h1>
      <p className="hero-scroll__descripcion">
        Tecnología nueva, reparación de equipos y soporte técnico. Arma tu equipo con nosotros
        o déjanos el tuyo en buenas manos.
      </p>
      <div className="hero-scroll__acciones">
        <Link to="/productos" className="btn btn-warning btn-lg fw-semibold">
          Ver tienda
        </Link>
        <Link to="/reparaciones" className="btn btn-outline-light btn-lg fw-semibold">
          Solicitar reparación
        </Link>
      </div>
    </div>
  );

  // Movimiento reducido: imagen estática, sin sticky ni scroll vinculado
  if (estatico) {
    return (
      <section className="hero-scroll hero-scroll--estatico" aria-label="Inicio">
        <div className="hero-scroll__escena">
          <div className="hero-scroll__visor">
            <img
              className="hero-scroll__media"
              src={POSTER_SRC}
              alt="Laptop grafito con la pantalla encendida en verde jade"
            />
          </div>
          <div className="hero-scroll__sombra-izq" />
          {contenido}
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="hero-scroll" aria-label="Inicio" style={{ "--p": 0 }}>
      <div className="hero-scroll__escena">
        <div className="hero-scroll__visor">
          {/* Circuitos: van DETRÁS de la laptop (el video tiene fondo transparente) */}
          <svg
            className="hero-scroll__circuito"
            viewBox="0 0 1600 900"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <g transform="translate(-90 -80)">
            <g className="hero-scroll__pistas">
              {PISTAS.map((d, i) => (
                <path key={`t${i}`} className="trazo" d={d} />
              ))}
            </g>
            <g className="hero-scroll__pulsos">
              {PISTAS.map((d, i) => (
                <path
                  key={`p${i}`}
                  className="pulso"
                  pathLength="1"
                  d={d}
                  style={{ "--v": 1.6 + (i % 5) * 0.45, "--o": (i * 0.17) % 1 }}
                />
              ))}
            </g>
            <g className="hero-scroll__nodos">
              {[
                [900, 300], [880, 450], [880, 450], [700, 480], [1010, 330], [1130, 330],
                [1230, 440], [1210, 460], [1090, 560], [1060, 560], [760, 150], [430, 480],
              ].map(([x, y], i) => (
                <circle
                  key={`n${i}`}
                  cx={x}
                  cy={y}
                  r="5"
                  style={{ animationDelay: `${(i * 0.37) % 2.4}s` }}
                />
              ))}
            </g>
            </g>
          </svg>

          {/* Sombra suave bajo la laptop: aparece al terminar el ensamblaje */}
          <div className="hero-scroll__piso" aria-hidden="true" />

          {/* Imagen estática: respaldo mientras carga el video */}
          <img
            className="hero-scroll__media hero-scroll__poster"
            src={POSTER_SRC}
            alt=""
            aria-hidden="true"
            style={{ opacity: videoListo ? 0 : 1 }}
          />
          <video
            ref={videoRef}
            className="hero-scroll__media"
            muted
            playsInline
            preload="auto"
            tabIndex={-1}
            aria-hidden="true"
            onLoadedData={() => setVideoListo(true)}
            onError={() => setEstatico(true)}
            style={{ opacity: videoListo ? 1 : 0 }}
          >
            {usaAlfa && <source src={VIDEO_WEBM} type="video/webm" />}
            <source src={VIDEO_MP4} type="video/mp4" />
          </video>
        </div>

        <div className="hero-scroll__sombra-izq" />
        {contenido}
        <div className="hero-scroll__scroll-hint" aria-hidden="true">
          <span>Desliza</span>
          <i />
        </div>
      </div>
    </section>
  );
};

export default HeroScroll;
