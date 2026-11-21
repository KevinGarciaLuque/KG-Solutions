import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/axios.js";
import PhotoPicker from "../components/PhotoPicker.jsx";
import SolicitudExito from "../components/SolicitudExito.jsx";
import { guardarSeguimiento, money, nuevaClave } from "../utils/servicios.js";

const PROBLEMAS = [
  "Configuración de impresora", "Problemas de conexión / internet", "Instalación de software",
  "Asistencia con mi computadora", "Correo / cuentas", "Otro",
];
const MODALIDADES = [
  ["remoto", "Remoto", "Te atendemos por conexión remota o videollamada."],
  ["tienda", "En la tienda", "Visítanos con tu equipo o dispositivo."],
  ["domicilio", "Visita a domicilio", "Un técnico va a tu domicilio."],
];

const SupportRequestPage = () => {
  const claveRef = useRef(nuevaClave());
  const [costos, setCostos] = useState(null);
  const [f, setF] = useState({
    cliente_nombre: "", cliente_telefono: "", cliente_correo: "", tipo_problema: PROBLEMAS[0],
    descripcion: "", modalidad: "remoto", disponibilidad: "", direccion: "", referencia: "",
  });
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
    if (!f.descripcion.trim()) return setError("Describe el problema.");
    if (f.modalidad === "domicilio" && !f.direccion.trim()) return setError("Indica la dirección de la visita.");

    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    fd.append("idempotency_key", claveRef.current);
    fotos.forEach((file) => fd.append("fotos", file));

    setEnviando(true);
    try {
      const { data } = await api.post("/public/soporte", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 });
      guardarSeguimiento({ tipo: "soporte", folio: data.folio, token: data.seguimiento_token });
      setOk(data);
    } catch (err) {
      setError(err.response?.data?.message || "No se pudo enviar la solicitud. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  if (ok) {
    return (
      <SolicitudExito titulo="Ticket de soporte registrado" folio={ok.folio} token={ok.seguimiento_token}>
        <p className="text-secondary">
          Un técnico revisará tu caso y te contactará para atenderlo o programar la cita.
          {f.modalidad === "domicilio" && (
            <> Costo de la visita: <strong>{ok.costo_visita === null ? "pendiente de cotización" : ok.costo_visita > 0 ? money(ok.costo_visita) : "sin costo"}</strong>.</>
          )}
        </p>
        <p className="small">
          ¿Crees que tu equipo debe ingresar al taller? <Link to="/reparaciones">Solicita una reparación</Link>.
        </p>
      </SolicitudExito>
    );
  }

  return (
    <div className="container py-5" style={{ maxWidth: 760 }}>
      <h1 className="h3 fw-bold mb-1">Solicitar soporte técnico</h1>
      <p className="text-secondary mb-4">Para consultas e incidencias que se resuelven sin dejar tu equipo en el taller.</p>
      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={enviar} className="p-4 rounded-4 bg-white shadow-sm">
        <div className="row g-3 mb-3">
          <div className="col-12">
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
          <div className="col-md-6">
            <label className="form-label">Tipo de problema</label>
            <select className="form-select" value={f.tipo_problema} onChange={set("tipo_problema")}>
              {PROBLEMAS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Describe el problema *</label>
            <textarea className="form-control" rows={4} value={f.descripcion} onChange={set("descripcion")} maxLength={3000} />
          </div>
          <div className="col-12">
            <PhotoPicker value={fotos} onChange={setFotos} onError={setError} label="Fotos o capturas de pantalla (opcional)" />
          </div>
        </div>

        <h2 className="h6 fw-bold text-uppercase text-secondary">Modalidad de atención</h2>
        <div className="mb-3">
          {MODALIDADES.map(([v, t, d]) => (
            <div className="form-check mb-1" key={v}>
              <input className="form-check-input" type="radio" name="modalidad" id={`mod-${v}`} checked={f.modalidad === v}
                onChange={() => setF((p) => ({ ...p, modalidad: v }))} />
              <label className="form-check-label" htmlFor={`mod-${v}`}>
                {t} <span className="text-secondary small">— {d}
                  {v === "domicilio" && costos && ` Costo: ${costos.visita_soporte === null ? "por cotizar" : costos.visita_soporte > 0 ? money(costos.visita_soporte) : "sin costo"}.`}
                </span>
              </label>
            </div>
          ))}
        </div>
        <div className="mb-3">
          <label className="form-label">Disponibilidad (días y horarios)</label>
          <input className="form-control" value={f.disponibilidad} onChange={set("disponibilidad")} maxLength={255} placeholder="Ej. lunes a viernes después de las 2 pm" />
          <div className="form-text">Sujeto a confirmación.</div>
        </div>
        {f.modalidad === "domicilio" && (
          <div className="row g-3 mb-3 p-3 rounded-3 bg-light">
            <div className="col-12">
              <label className="form-label">Dirección de la visita *</label>
              <input className="form-control" value={f.direccion} onChange={set("direccion")} maxLength={255} />
            </div>
            <div className="col-12">
              <label className="form-label">Referencias</label>
              <input className="form-control" value={f.referencia} onChange={set("referencia")} maxLength={255} />
            </div>
          </div>
        )}

        <button className="btn btn-warning btn-lg fw-semibold w-100" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar solicitud de soporte"}
        </button>
      </form>
    </div>
  );
};

export default SupportRequestPage;
