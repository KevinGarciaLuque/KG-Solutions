import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SITE_INFO } from "../config/site.js";

/*
  Hero cinematográfico: una laptop que gira y se ensambla al hacer scroll.

  Archivos (carpeta frontend-tienda/public/hero/):
    - laptop-assemble.mp4        → el clip (colócalo aquí; ver README.md de esa carpeta)
    - laptop-ensamblada.jpg      → imagen estática de la laptop ensamblada
                                   (movimiento reducido, móvil sin video, o si falta el MP4)

  El tiempo del clip sigue el progreso del scroll: bajar arma, subir desarma,
  detener el scroll congela el fotograma.
*/
const VIDEO_SRC = "/hero/laptop-assemble.mp4";
const POSTER_SRC = "/hero/laptop-ensamblada.jpg";

const GESTOS = ["touchstart", "touchend", "pointerdown", "click"];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const prefiereMenosMovimiento = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const HeroScroll = () => {
  const sectionRef = useRef(null);
  const videoRef = useRef(null);
  const [estatico, setEstatico] = useState(prefiereMenosMovimiento);
  const [videoListo, setVideoListo] = useState(false);

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
      actual += (objetivo - actual) * 0.18;
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

    // iOS Safari (sobre todo con ahorro de batería) no descarga el video hasta que
    // hay un gesto del usuario: se fuerza un play→pause para que cargue los fotogramas.
    const despertar = () => {
      const r = video.play();
      if (r && r.then) r.then(() => video.pause()).catch(() => {});
      else video.pause();
    };
    const alGesto = () => {
      despertar();
      GESTOS.forEach((g) => window.removeEventListener(g, alGesto));
    };
    GESTOS.forEach((g) => window.addEventListener(g, alGesto, { passive: true }));
    despertar();
    alCambiar();
    window.addEventListener("scroll", alCambiar, { passive: true });
    window.addEventListener("resize", alCambiar);
    video.addEventListener("loadedmetadata", alCambiar);
    return () => {
      window.removeEventListener("scroll", alCambiar);
      window.removeEventListener("resize", alCambiar);
      video.removeEventListener("loadedmetadata", alCambiar);
      GESTOS.forEach((g) => window.removeEventListener(g, alGesto));
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
        {/* Imagen estática: es la capa de respaldo (visible hasta que el video cargue o si no existe) */}
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
          src={VIDEO_SRC}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          aria-hidden="true"
          onLoadedData={() => setVideoListo(true)}
          onCanPlay={() => setVideoListo(true)}
          onError={() => setEstatico(true)}
          style={{ opacity: videoListo ? 1 : 0 }}
        />

        {/* Pistas de circuito y pulsos jade sincronizados con el ensamblaje */}
        <svg className="hero-scroll__circuito" viewBox="0 0 400 600" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          <path className="trazo" d="M400 80 H330 L300 110 H220" />
          <path className="trazo" d="M400 210 H350 L320 240 H270 L250 260" />
          <path className="trazo" d="M400 340 H300 L270 370 H210" />
          <path className="trazo" d="M400 470 H340 L310 500 H240" />
          <path className="pulso" pathLength="1" d="M400 80 H330 L300 110 H220" />
          <path className="pulso pulso--2" pathLength="1" d="M400 340 H300 L270 370 H210" />
          <path className="pulso pulso--3" pathLength="1" d="M400 470 H340 L310 500 H240" />
        </svg>
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
