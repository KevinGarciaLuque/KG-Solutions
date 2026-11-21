import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import api from "../../api/axios";
import { BADGE, ETIQUETAS, FotoPrivada, errMsg, fmtFecha, money } from "./servicioUtils";

const ESTADOS = ["todos", "recibido", "asignado", "programado", "en_atencion", "resuelto", "cerrado"];
const MOD = { remoto: "Remoto", tienda: "En tienda", domicilio: "A domicilio" };
// <input type="datetime-local"> usa hora local sin zona
const aLocalInput = (f) => {
  if (!f) return "";
  const d = new Date(f);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function SoportePage() {
  const [filtros, setFiltros] = useState({ estado: "todos", desde: "", hasta: "", responsable_id: "", modalidad: "", q: "", pendiente_visita: "" });
  const [lista, setLista] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [tecnicos, setTecnicos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [detalleId, setDetalleId] = useState(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      const [l, r] = await Promise.all([api.get("/soporte", { params }), api.get("/soporte/resumen")]);
      setLista(l.data); setResumen(r.data);
    } catch (e) {
      setError(errMsg(e, "No se pudieron cargar los tickets"));
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api.get("/reparaciones/tecnicos").then((r) => setTecnicos(r.data)).catch(() => {}); }, []);
  const set = (k) => (e) => setFiltros((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h4 mb-0">Soporte técnico</h2>
        <Button variant="outline-secondary" size="sm" onClick={cargar}>Actualizar</Button>
      </div>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {resumen && (
        <Button size="sm" className="mb-3" variant={filtros.pendiente_visita ? "warning" : "outline-warning"}
          onClick={() => setFiltros((f) => ({ ...f, pendiente_visita: f.pendiente_visita ? "" : "1" }))}>
          Visitas por programar <Badge bg="dark">{resumen.visitas_sin_programar}</Badge>
        </Button>
      )}
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-2"><Form.Select size="sm" value={filtros.estado} onChange={set("estado")}>{ESTADOS.map((e) => <option key={e} value={e}>{e === "todos" ? "Todos los estados" : ETIQUETAS[e]}</option>)}</Form.Select></div>
        <div className="col-6 col-md-2"><Form.Control size="sm" type="date" value={filtros.desde} onChange={set("desde")} /></div>
        <div className="col-6 col-md-2"><Form.Control size="sm" type="date" value={filtros.hasta} onChange={set("hasta")} /></div>
        <div className="col-6 col-md-2"><Form.Select size="sm" value={filtros.modalidad} onChange={set("modalidad")}><option value="">Toda modalidad</option>{Object.entries(MOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Form.Select></div>
        <div className="col-6 col-md-2"><Form.Select size="sm" value={filtros.responsable_id} onChange={set("responsable_id")}><option value="">Todo responsable</option>{tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</Form.Select></div>
        <div className="col-6 col-md-2"><Form.Control size="sm" placeholder="Folio, cliente…" value={filtros.q} onChange={set("q")} /></div>
      </div>

      <div className="table-responsive bg-white rounded shadow-sm">
        <Table hover size="sm" className="mb-0 align-middle">
          <thead><tr><th>Folio</th><th>Cliente</th><th>Problema</th><th>Modalidad</th><th>Estado</th><th>Responsable</th><th>Programado</th><th>Creado</th></tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={8} className="text-center py-3"><Spinner size="sm" /></td></tr>}
            {!cargando && lista.length === 0 && <tr><td colSpan={8} className="text-center text-secondary py-3">Sin resultados</td></tr>}
            {lista.map((t) => (
              <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setDetalleId(t.id)}>
                <td className="fw-semibold">{t.folio}</td>
                <td>{t.cliente_nombre}<div className="small text-secondary">{t.cliente_telefono}</div></td>
                <td>{t.tipo_problema}</td>
                <td>{MOD[t.modalidad]}{t.modalidad === "domicilio" && !t.fecha_programada && ["recibido", "asignado"].includes(t.estado) && <Badge bg="warning" text="dark" className="ms-1">por programar</Badge>}</td>
                <td><Badge bg={BADGE[t.estado]}>{ETIQUETAS[t.estado]}</Badge></td>
                <td>{t.responsable_nombre || "—"}</td>
                <td className="small">{fmtFecha(t.fecha_programada)}</td>
                <td className="small">{fmtFecha(t.creado_en)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {detalleId && <DetalleTicket id={detalleId} tecnicos={tecnicos} onClose={() => { setDetalleId(null); cargar(); }} />}
    </div>
  );
}

function DetalleTicket({ id, tecnicos, onClose }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [solucion, setSolucion] = useState("");
  const [fecha, setFecha] = useState("");
  const [coment, setComent] = useState({ texto: "", visibilidad: "interno" });
  const [repId, setRepId] = useState("");
  const [reps, setReps] = useState([]);

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get(`/soporte/${id}`);
      setD(data); setSolucion(data.solucion || ""); setFecha(aLocalInput(data.fecha_programada));
    } catch (e) { setMsg({ tipo: "danger", texto: errMsg(e) }); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  // reparaciones recientes para vincular (requiere permiso de reparaciones; si no, queda vacío)
  useEffect(() => { api.get("/reparaciones").then((r) => setReps(r.data)).catch(() => {}); }, []);

  const run = async (fn, ok) => {
    setOcupado(true); setMsg(null);
    try { const r = await fn(); setMsg({ tipo: "success", texto: r?.data?.message || ok || "Listo" }); await cargar(); return true; }
    catch (e) { setMsg({ tipo: "danger", texto: errMsg(e) }); return false; }
    finally { setOcupado(false); }
  };

  if (!d) return <Modal show onHide={onClose} centered><Modal.Body className="text-center py-5"><Spinner /></Modal.Body></Modal>;

  return (
    <Modal show onHide={onClose} size="lg" scrollable>
      <Modal.Header closeButton><Modal.Title>{d.folio} <Badge bg={BADGE[d.estado]}>{ETIQUETAS[d.estado]}</Badge></Modal.Title></Modal.Header>
      <Modal.Body>
        {msg && <div className={`alert alert-${msg.tipo} py-2`}>{msg.texto}</div>}
        <div className="row g-3">
          <div className="col-md-6">
            <h6 className="fw-bold">Cliente</h6>
            <div>{d.cliente_nombre}</div>
            <div className="small text-secondary">{d.cliente_telefono} {d.cliente_correo && `· ${d.cliente_correo}`}</div>
            <h6 className="fw-bold mt-3">Problema ({d.tipo_problema})</h6>
            <div style={{ whiteSpace: "pre-wrap" }}>{d.descripcion}</div>
            <div className="small mt-2"><strong>Modalidad:</strong> {MOD[d.modalidad]}</div>
            <div className="small"><strong>Disponibilidad (a confirmar):</strong> {d.disponibilidad || "—"}</div>
            {d.modalidad === "domicilio" && (
              <div className="small">
                <div><strong>Dirección:</strong> {d.direccion} {d.referencia && `(${d.referencia})`}</div>
                <div className="d-flex align-items-center gap-2 mt-1">Costo visita:
                  <Form.Control size="sm" style={{ maxWidth: 120 }} type="number" min="0" step="0.01" placeholder="Por cotizar" defaultValue={d.costo_visita ?? ""}
                    onBlur={(e) => e.target.value !== String(d.costo_visita ?? "") && run(() => api.patch(`/soporte/${id}`, { costo_visita: e.target.value }))} />
                  {d.costo_visita !== null && <span>{money(d.costo_visita)}</span>}
                </div>
              </div>
            )}
            <h6 className="fw-bold mt-3">Fotos / capturas</h6>
            <div className="d-flex flex-wrap gap-2">
              {d.fotos.length === 0 && <span className="text-secondary small">Sin archivos</span>}
              {d.fotos.map((f) => <FotoPrivada key={f.id} url={`/soporte/${id}/fotos/${f.id}`} />)}
            </div>
          </div>

          <div className="col-md-6">
            <h6 className="fw-bold">Responsable</h6>
            <Form.Select size="sm" value={d.responsable_id || ""} disabled={ocupado || d.estado === "cerrado"}
              onChange={(e) => run(() => api.patch(`/soporte/${id}`, { responsable_id: e.target.value || null }), "Responsable asignado")}>
              <option value="">Sin asignar</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Form.Select>

            <h6 className="fw-bold mt-3">Fecha programada</h6>
            <div className="d-flex gap-2">
              <Form.Control size="sm" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={d.estado === "cerrado"} />
              <Button size="sm" disabled={ocupado || d.estado === "cerrado"} onClick={() => run(() => api.patch(`/soporte/${id}`, { fecha_programada: fecha ? new Date(fecha).toISOString() : null }), "Fecha guardada")}>Guardar</Button>
            </div>

            <h6 className="fw-bold mt-3">Solución aplicada</h6>
            <Form.Control as="textarea" rows={3} value={solucion} onChange={(e) => setSolucion(e.target.value)} disabled={d.estado === "cerrado"} />
            <Button size="sm" className="mt-1" disabled={ocupado || d.estado === "cerrado"} onClick={() => run(() => api.patch(`/soporte/${id}`, { solucion }), "Solución guardada")}>Guardar solución</Button>

            <h6 className="fw-bold mt-3">Orden de reparación vinculada</h6>
            {d.reparacion_folio ? <div className="small">{d.reparacion_folio}</div> : (
              <div className="d-flex gap-2">
                <Form.Select size="sm" value={repId} onChange={(e) => setRepId(e.target.value)}>
                  <option value="">Seleccionar reparación…</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.folio} · {r.cliente_nombre}</option>)}
                </Form.Select>
                <Button size="sm" disabled={!repId || ocupado} onClick={() => run(() => api.post(`/soporte/${id}/vincular-reparacion`, { reparacion_id: repId }))}>Vincular</Button>
              </div>
            )}
          </div>
        </div>

        <hr />
        <h6 className="fw-bold">Cambiar estado</h6>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {d.transiciones.length === 0 && <span className="text-secondary small">Estado final</span>}
          {d.transiciones.map((t) => (
            <Button key={t} size="sm" variant="outline-primary" disabled={ocupado} onClick={() => run(() => api.patch(`/soporte/${id}/estado`, { estado: t }))}>→ {ETIQUETAS[t]}</Button>
          ))}
        </div>

        <div className="row g-3">
          <div className="col-md-6">
            <h6 className="fw-bold">Comentarios</h6>
            {d.comentarios.map((c) => (
              <div key={c.id} className={`small border-start border-3 ps-2 mb-2 ${c.visibilidad === "cliente" ? "border-primary" : "border-secondary"}`}>
                <Badge bg={c.visibilidad === "cliente" ? "primary" : "secondary"}>{c.visibilidad === "cliente" ? "visible al cliente" : "interno"}</Badge> {c.usuario_nombre} · {fmtFecha(c.creado_en)}<div>{c.texto}</div>
              </div>
            ))}
            <Form.Control as="textarea" rows={2} value={coment.texto} onChange={(e) => setComent({ ...coment, texto: e.target.value })} />
            <div className="d-flex gap-3 align-items-center mt-1">
              <Form.Check inline type="radio" label="Interno" checked={coment.visibilidad === "interno"} onChange={() => setComent({ ...coment, visibilidad: "interno" })} />
              <Form.Check inline type="radio" label="Visible al cliente" checked={coment.visibilidad === "cliente"} onChange={() => setComent({ ...coment, visibilidad: "cliente" })} />
              <Button size="sm" disabled={ocupado || !coment.texto.trim()} onClick={async () => { if (await run(() => api.post(`/soporte/${id}/comentarios`, coment))) setComent({ ...coment, texto: "" }); }}>Guardar</Button>
            </div>
          </div>
          <div className="col-md-6">
            <h6 className="fw-bold">Historial</h6>
            <ul className="list-unstyled small mb-0">
              {d.historial.map((h) => (
                <li key={h.id} className="mb-1">{fmtFecha(h.creado_en)} · <strong>{ETIQUETAS[h.estado_nuevo] || h.estado_nuevo}</strong> · {h.usuario_nombre || "cliente/web"} {h.nota && <span className="text-secondary">— {h.nota}</span>}</li>
              ))}
            </ul>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
