import { useEffect, useRef, useState } from "react";
import api from "../api/axios.js";
import PhotoPicker from "../components/PhotoPicker.jsx";
import SolicitudExito from "../components/SolicitudExito.jsx";
import { guardarSeguimiento, money, nuevaClave } from "../utils/servicios.js";

const TIPOS = ["Laptop", "Computadora de escritorio", "Impresora", "Monitor", "Celular / Tablet", "Router / Red", "Otro"];

const costoTexto = (c) => (c === null || c === undefined ? "por cotizar" : c > 0 ? money(c) : "sin costo");

const RepairRequestPage = () => {
  const claveRef = useRef(nuevaClave());
  const [costos, setCostos] = useState(null);
  const [f, setF] = useState({
    cliente_nombre: "", cliente_telefono: "", cliente_correo: "",
    tipo_equipo: TIPOS[0], marca: "", modelo: "", numero_serie: "", falla: "",
    ingreso_modo: "tienda", devolucion_modo: "tienda",
    direccion_recoleccion: "", referencia_recoleccion: "", horario_recoleccion: "",
    direccion_entrega: "", referencia_entrega: "", horario_entrega: "",
  });
  const [mismaDir, setMismaDir] = useState(true);
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(null);

  useEffect(() => {
    api.get("/public/costos").then((r) => setCostos(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const enviar = async (e) => {
    e.preventDefault();
    setError("");
    if (!f.cliente_nombre.trim()) return setError("Escribe tu nombre.");
    if (!f.cliente_telefono.trim() && !f.cliente_correo.trim()) return setError("Indica un teléfono/WhatsApp o un correo.");
    if (!f.falla.trim()) return setError("Describe la falla del equipo.");
    if (f.ingreso_modo === "recoleccion" && !f.direccion_recoleccion.trim()) return setError("Indica la dirección de recolección.");
    if (f.devolucion_modo === "domicilio" && !(mismaDir && f.ingreso_modo === "recoleccion" ? f.direccion_recoleccion : f.direccion_entrega).trim())
      return setError("Indica la dirección de entrega.");

    const datos = { ...f };
    if (f.devolucion_modo === "domicilio" && mismaDir && f.ingreso_modo === "recoleccion") {
      datos.direccion_entrega = f.direccion_recoleccion;
      datos.referencia_entrega = f.referencia_recoleccion;
    }
    const fd = new FormData();
    Object.entries(datos).forEach(([k, v]) => fd.append(k, v));
    fd.append("idempotency_key", claveRef.current);
    fotos.forEach((file) => fd.append("fotos", file));

    setEnviando(true);
    try {
      const { data } = await api.post("/public/reparaciones", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      guardarSeguimiento({ tipo: "reparacion", folio: data.folio, token: data.seguimiento_token });
      setOk(data);
    } catch (err) {
      setError(err.response?.data?.message || "No se pudo enviar la solicitud. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  if (ok) {
    return (
      <SolicitudExito titulo="Solicitud de reparación registrada" folio={ok.folio} token={ok.seguimiento_token}>
        <p className="text-secondary">
          Recibimos tu solicitud{ok.fotos ? ` con ${ok.fotos} foto(s)` : ""}. Nuestro equipo la revisará y te contactará
          para coordinar el ingreso del equipo. Los horarios que indicaste están sujetos a confirmación.
        </p>
      </SolicitudExito>
    );
  }

  return (
    <div className="container py-5" style={{ maxWidth: 760 }}>
      <h1 className="h3 fw-bold mb-1">Solicitar reparación</h1>
      <p className="text-secondary mb-4">Cuéntanos qué le pasa a tu equipo. Te enviaremos una cotización antes de reparar.</p>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={enviar} className="p-4 rounded-4 bg-white shadow-sm">
        <h2 className="h6 fw-bold text-uppercase text-secondary">Tus datos</h2>
        <div className="row g-3 mb-4">
          <div className="col-md-12">
            <label className="form-label">Nombre completo *</label>
            <input className="form-control" value={f.cliente_nombre} onChange={set("cliente_nombre")} maxLength={150} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Teléfono / WhatsApp</label>
            <input className="form-control" inputMode="tel" value={f.cliente_telefono} onChange={set("cliente_telefono")} maxLength={40} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Correo electrónico</label>
            <input type="email" className="form-control" value={f.cliente_correo} onChange={set("cliente_correo")} maxLength={150} />
          </div>
          <div className="form-text mt-0">Indica al menos uno de los dos para poder contactarte.</div>
        </div>

        <h2 className="h6 fw-bold text-uppercase text-secondary">El equipo</h2>
        <div className="row g-3 mb-4">
          <div className="col-md-6">
            <label className="form-label">Tipo de equipo *</label>
            <select className="form-select" value={f.tipo_equipo} onChange={set("tipo_equipo")}>
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">Marca</label>
            <input className="form-control" value={f.marca} onChange={set("marca")} maxLength={80} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Modelo</label>
            <input className="form-control" value={f.modelo} onChange={set("modelo")} maxLength={120} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Número de serie (opcional)</label>
            <input className="form-control" value={f.numero_serie} onChange={set("numero_serie")} maxLength={120} />
          </div>
          <div className="col-12">
            <label className="form-label">Descripción de la falla *</label>
            <textarea className="form-control" rows={4} value={f.falla} onChange={set("falla")} maxLength={3000}
              placeholder="¿Qué sucede? ¿Desde cuándo? ¿Se mojó o se cayó?" />
          </div>
          <div className="col-12">
            <PhotoPicker value={fotos} onChange={setFotos} onError={setError} />
          </div>
        </div>

        <h2 className="h6 fw-bold text-uppercase text-secondary">¿Cómo nos entregas el equipo?</h2>
        <div className="mb-3">
          {[["tienda", "Lo llevo a la tienda", "sin costo"], ["recoleccion", "Quiero que lo recojan en mi domicilio", costos ? costoTexto(costos.recoleccion_reparacion) : ""]].map(([v, t, c]) => (
            <div className="form-check" key={v}>
              <input className="form-check-input" type="radio" name="ingreso" id={`ing-${v}`} checked={f.ingreso_modo === v}
                onChange={() => setF((p) => ({ ...p, ingreso_modo: v }))} />
              <label className="form-check-label" htmlFor={`ing-${v}`}>{t} <span className="text-secondary small">({c})</span></label>
            </div>
          ))}
        </div>
        {f.ingreso_modo === "recoleccion" && (
          <div className="row g-3 mb-4 p-3 rounded-3 bg-light">
            <div className="col-12">
              <label className="form-label">Dirección de recolección *</label>
              <input className="form-control" value={f.direccion_recoleccion} onChange={set("direccion_recoleccion")} maxLength={255} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Referencias</label>
              <input className="form-control" value={f.referencia_recoleccion} onChange={set("referencia_recoleccion")} maxLength={255} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Horario preferido</label>
              <input className="form-control" value={f.horario_recoleccion} onChange={set("horario_recoleccion")} maxLength={120} placeholder="Ej. mañana por la tarde" />
              <div className="form-text">Sujeto a confirmación.</div>
            </div>
          </div>
        )}

        <h2 className="h6 fw-bold text-uppercase text-secondary">¿Cómo recibes el equipo reparado?</h2>
        <div className="mb-3">
          {[["tienda", "Lo retiro en la tienda", "sin costo"], ["domicilio", "Quiero entrega a domicilio", costos ? costoTexto(costos.entrega_reparacion) : ""]].map(([v, t, c]) => (
            <div className="form-check" key={v}>
              <input className="form-check-input" type="radio" name="devolucion" id={`dev-${v}`} checked={f.devolucion_modo === v}
                onChange={() => setF((p) => ({ ...p, devolucion_modo: v }))} />
              <label className="form-check-label" htmlFor={`dev-${v}`}>{t} <span className="text-secondary small">({c})</span></label>
            </div>
          ))}
        </div>
        {f.devolucion_modo === "domicilio" && (
          <div className="row g-3 mb-4 p-3 rounded-3 bg-light">
            {f.ingreso_modo === "recoleccion" && (
              <div className="col-12 form-check ms-2">
                <input className="form-check-input" type="checkbox" id="misma" checked={mismaDir} onChange={(e) => setMismaDir(e.target.checked)} />
                <label className="form-check-label" htmlFor="misma">Usar la misma dirección de recolección</label>
              </div>
            )}
            {!(mismaDir && f.ingreso_modo === "recoleccion") && (
              <>
                <div className="col-12">
                  <label className="form-label">Dirección de entrega *</label>
                  <input className="form-control" value={f.direccion_entrega} onChange={set("direccion_entrega")} maxLength={255} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Referencias</label>
                  <input className="form-control" value={f.referencia_entrega} onChange={set("referencia_entrega")} maxLength={255} />
                </div>
              </>
            )}
            <div className="col-md-6">
              <label className="form-label">Horario preferido</label>
              <input className="form-control" value={f.horario_entrega} onChange={set("horario_entrega")} maxLength={120} />
              <div className="form-text">Sujeto a confirmación.</div>
            </div>
          </div>
        )}

        <button className="btn btn-warning btn-lg fw-semibold w-100" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar solicitud de reparación"}
        </button>
        <p className="text-secondary small mt-3 mb-0">
          Los costos de traslado se registran por separado y se incluyen en la cotización. Si aparece «por cotizar», te lo confirmaremos.
        </p>
      </form>
    </div>
  );
};

export default RepairRequestPage;
