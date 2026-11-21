import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios.js";
import { extraerToken, leerSeguimientos, money } from "../utils/servicios.js";

const ETIQUETAS = {
  // pedidos
  nuevo: "Recibido", en_proceso: "Confirmado", listo: "Listo", cobrado: "Entregado / cobrado", cancelado: "Cancelado",
  // reparaciones
  recibida: "Recibida", pendiente_ingreso: "Pendiente de ingreso del equipo", equipo_recibido: "Equipo recibido",
  en_diagnostico: "En diagnóstico", cotizacion_enviada: "Cotización enviada", aprobada: "Cotización aprobada",
  cotizacion_rechazada: "Cotización rechazada", en_reparacion: "En reparación", lista_entrega: "Lista para entrega",
  entregada: "Entregada",
  // soporte
  recibido: "Recibido", asignado: "Asignado", programado: "Programado", en_atencion: "En atención",
  resuelto: "Resuelto", cerrado: "Cerrado",
};
const TIPO_TXT = { pedido: "Pedido", reparacion: "Reparación", soporte: "Soporte técnico" };
const fecha = (f) => (f ? new Date(f).toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short" }) : "");
const costo = (c) => (c === null || c === undefined ? "Por cotizar" : c > 0 ? money(c) : "Sin costo");
const baseApi = () => String(api.defaults.baseURL || "").replace(/\/$/, "");

const Fila = ({ k, v }) => (v ? <div className="d-flex gap-2 small mb-1"><span className="text-secondary" style={{ minWidth: 150 }}>{k}</span><span>{v}</span></div> : null);

const Detalle = ({ d, token }) => (
  <div className="p-4 rounded-4 bg-white shadow-sm">
    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
      <div>
        <div className="text-secondary small">{TIPO_TXT[d.tipo]}</div>
        <h1 className="h4 fw-bold mb-0">{d.folio}</h1>
      </div>
      <span className="badge bg-primary fs-6">{ETIQUETAS[d.estado] || d.estado}</span>
    </div>

    {d.tipo === "pedido" && (
      <>
        <Fila k="Entrega" v={d.entrega === "envio" ? `Domicilio: ${d.direccion || ""}` : "Retiro en tienda"} />
        <Fila k="Pago" v={`${d.estado_pago === "confirmado" ? "Confirmado" : "Pendiente"}${d.metodo_pago ? ` (${d.metodo_pago})` : ""}`} />
        <table className="table table-sm mt-3">
          <thead><tr><th>Producto</th><th className="text-end">Cant.</th><th className="text-end">Subtotal</th></tr></thead>
          <tbody>{d.items.map((i, n) => <tr key={n}><td>{i.nombre}</td><td className="text-end">{i.cantidad}</td><td className="text-end">{money(i.subtotal)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={2} className="text-end">Productos</td><td className="text-end">{money(d.total)}</td></tr>
            {d.entrega === "envio" && <tr><td colSpan={2} className="text-end">Envío</td><td className="text-end">{d.envio_cotizar ? "Por cotizar" : costo(d.costo_envio)}</td></tr>}
          </tfoot>
        </table>
      </>
    )}

    {d.tipo === "reparacion" && (
      <>
        <Fila k="Equipo" v={[d.equipo.tipo, d.equipo.marca, d.equipo.modelo].filter(Boolean).join(" · ")} />
        <Fila k="Falla reportada" v={d.falla} />
        <Fila k="Ingreso" v={d.ingreso_modo === "recoleccion" ? `Recolección a domicilio (${d.direccion_recoleccion || ""}) — ${costo(d.costo_recoleccion)}` : "En la tienda"} />
        <Fila k="Devolución" v={d.devolucion_modo === "domicilio" ? `Entrega a domicilio (${d.direccion_entrega || ""}) — ${costo(d.costo_entrega)}` : "Retiro en tienda"} />
        {d.cotizacion && (
          <div className="mt-3 p-3 rounded-3 bg-light">
            <h2 className="h6 fw-bold">Cotización ({d.cotizacion.estado})</h2>
            {d.cotizacion.diagnostico && <p className="small">{d.cotizacion.diagnostico}</p>}
            <table className="table table-sm mb-0">
              <tbody>{d.cotizacion.items.map((i, n) => <tr key={n}><td>{i.descripcion}</td><td className="text-end">{i.cantidad} × {money(i.precio_unitario)}</td><td className="text-end">{money(i.subtotal)}</td></tr>)}</tbody>
              <tfoot><tr><th colSpan={2} className="text-end">Total</th><th className="text-end">{money(d.cotizacion.total)}</th></tr></tfoot>
            </table>
            {d.estado === "cotizacion_enviada" && <p className="small text-secondary mt-2 mb-0">Para aprobarla, responde por el medio de contacto que usamos contigo o visítanos en la tienda.</p>}
          </div>
        )}
      </>
    )}

    {d.tipo === "soporte" && (
      <>
        <Fila k="Modalidad" v={d.modalidad === "domicilio" ? "Visita a domicilio" : d.modalidad === "tienda" ? "En tienda" : "Remoto"} />
        <Fila k="Problema" v={d.descripcion} />
        {d.modalidad === "domicilio" && <Fila k="Costo de visita" v={costo(d.costo_visita)} />}
        <Fila k="Cita programada" v={fecha(d.fecha_programada)} />
        <Fila k="Solución" v={d.solucion} />
      </>
    )}

    {d.fotos?.length > 0 && (
      <div className="d-flex flex-wrap gap-2 my-3">
        {d.fotos.map((id) => (
          <a key={id} href={`${baseApi()}/public/seguimiento/${token}/fotos/${id}`} target="_blank" rel="noopener noreferrer">
            <img src={`${baseApi()}/public/seguimiento/${token}/fotos/${id}`} alt="Foto de la solicitud" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8 }} />
          </a>
        ))}
      </div>
    )}

    {d.mensajes?.length > 0 && (
      <div className="mt-3">
        <h2 className="h6 fw-bold">Mensajes del taller</h2>
        {d.mensajes.map((m, i) => <div key={i} className="small border-start border-3 ps-2 mb-2"><div className="text-secondary">{fecha(m.creado_en)}</div>{m.texto}</div>)}
      </div>
    )}

    <h2 className="h6 fw-bold mt-4">Historial</h2>
    <ul className="list-unstyled small mb-0">
      {d.historial.map((h, i) => <li key={i} className="mb-1"><i className="bi bi-dot"></i>{ETIQUETAS[h.estado] || h.estado} <span className="text-secondary">— {fecha(h.creado_en)}</span></li>)}
    </ul>
  </div>
);

const TrackingPage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const guardados = leerSeguimientos();

  useEffect(() => {
    if (!token) { setData(null); return; }
    let activo = true;
    setCargando(true); setError(""); setData(null);
    api.get(`/public/seguimiento/${encodeURIComponent(token)}`)
      .then((r) => activo && setData(r.data))
      .catch((e) => activo && setError(e.response?.status === 404 ? "No encontramos una solicitud con ese enlace." : e.response?.data?.message || "No se pudo consultar."))
      .finally(() => activo && setCargando(false));
    return () => { activo = false; };
  }, [token]);

  const buscar = (e) => {
    e.preventDefault();
    const t = extraerToken(texto);
    if (!t) return setError("Pega el enlace de seguimiento completo que recibiste al enviar tu solicitud. El folio por sí solo no es suficiente.");
    setError("");
    navigate(`/seguimiento/${t}`);
  };

  return (
    <div className="container py-5" style={{ maxWidth: 760 }}>
      {!token && (
        <>
          <h1 className="h3 fw-bold mb-1">Seguimiento</h1>
          <p className="text-secondary">Consulta el estado de tu pedido, reparación o ticket de soporte con tu enlace de seguimiento.</p>
          <form onSubmit={buscar} className="input-group mb-3">
            <input className="form-control" placeholder="Pega aquí tu enlace de seguimiento" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <button className="btn btn-warning fw-semibold">Consultar</button>
          </form>
        </>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
      {cargando && <p className="text-secondary">Cargando…</p>}
      {data && <Detalle d={data} token={token} />}
      {token && <div className="mt-3"><Link to="/seguimiento">← Consultar otra solicitud</Link></div>}

      {!token && guardados.length > 0 && (
        <div className="mt-4">
          <h2 className="h6 fw-bold">Solicitudes hechas desde este navegador</h2>
          <ul className="list-group">
            {guardados.map((s) => (
              <li key={s.token} className="list-group-item d-flex justify-content-between align-items-center">
                <span>{TIPO_TXT[s.tipo]} · <strong>{s.folio}</strong></span>
                <Link to={`/seguimiento/${s.token}`}>Ver</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default TrackingPage;
