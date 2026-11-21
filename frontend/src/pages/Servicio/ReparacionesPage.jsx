import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import api from "../../api/axios";
import { BADGE, ETIQUETAS, FotoPrivada, errMsg, fmtFecha, money, nuevaClave } from "./servicioUtils";

const ESTADOS = ["todos", "recibida", "pendiente_ingreso", "equipo_recibido", "en_diagnostico", "cotizacion_enviada", "aprobada",
  "cotizacion_rechazada", "en_reparacion", "lista_entrega", "entregada", "cancelada"];
const costoTxt = (c) => (c === null || c === undefined ? "Por cotizar" : money(c));

export default function ReparacionesPage() {
  const [filtros, setFiltros] = useState({ estado: "todos", desde: "", hasta: "", tecnico_id: "", q: "", traslado: "" });
  const [lista, setLista] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [tecnicos, setTecnicos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [detalleId, setDetalleId] = useState(null);
  const [aviso, setAviso] = useState(null);

  const mostrar = (tipo, texto) => {
    setAviso({ tipo, texto });
    window.setTimeout(() => setAviso(null), 4000);
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
      const [l, r] = await Promise.all([api.get("/reparaciones", { params }), api.get("/reparaciones/resumen")]);
      setLista(l.data);
      setResumen(r.data);
    } catch (e) {
      mostrar("danger", errMsg(e, "No se pudieron cargar las reparaciones"));
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api.get("/reparaciones/tecnicos").then((r) => setTecnicos(r.data)).catch(() => {}); }, []);

  const set = (k) => (e) => setFiltros((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="container-fluid py-3">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <h2 className="h4 mb-0">Reparaciones</h2>
        <Button variant="outline-secondary" size="sm" onClick={cargar}>Actualizar</Button>
      </div>

      {aviso && <div className={`alert alert-${aviso.tipo} py-2`}>{aviso.texto}</div>}

      {resumen && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          <Button size="sm" variant={filtros.traslado === "recoleccion" ? "warning" : "outline-warning"}
            onClick={() => setFiltros((f) => ({ ...f, traslado: f.traslado === "recoleccion" ? "" : "recoleccion" }))}>
            Recolecciones por coordinar <Badge bg="dark">{resumen.recolecciones_pendientes}</Badge>
          </Button>
          <Button size="sm" variant={filtros.traslado === "devolucion" ? "warning" : "outline-warning"}
            onClick={() => setFiltros((f) => ({ ...f, traslado: f.traslado === "devolucion" ? "" : "devolucion" }))}>
            Devoluciones por coordinar <Badge bg="dark">{resumen.devoluciones_pendientes}</Badge>
          </Button>
        </div>
      )}

      <div className="row g-2 mb-3">
        <div className="col-6 col-md-2">
          <Form.Select size="sm" value={filtros.estado} onChange={set("estado")}>
            {ESTADOS.map((e) => <option key={e} value={e}>{e === "todos" ? "Todos los estados" : ETIQUETAS[e]}</option>)}
          </Form.Select>
        </div>
        <div className="col-6 col-md-2"><Form.Control size="sm" type="date" value={filtros.desde} onChange={set("desde")} /></div>
        <div className="col-6 col-md-2"><Form.Control size="sm" type="date" value={filtros.hasta} onChange={set("hasta")} /></div>
        <div className="col-6 col-md-2">
          <Form.Select size="sm" value={filtros.tecnico_id} onChange={set("tecnico_id")}>
            <option value="">Todos los técnicos</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Form.Select>
        </div>
        <div className="col-12 col-md-4"><Form.Control size="sm" placeholder="Buscar folio, cliente, teléfono, marca, serie…" value={filtros.q} onChange={set("q")} /></div>
      </div>

      <div className="table-responsive bg-white rounded shadow-sm">
        <Table hover size="sm" className="mb-0 align-middle">
          <thead><tr><th>Folio</th><th>Cliente</th><th>Equipo</th><th>Traslado</th><th>Estado</th><th>Técnico</th><th>Fotos</th><th>Fecha</th></tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={8} className="text-center py-3"><Spinner size="sm" /></td></tr>}
            {!cargando && lista.length === 0 && <tr><td colSpan={8} className="text-center text-secondary py-3">Sin resultados</td></tr>}
            {lista.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setDetalleId(r.id)}>
                <td className="fw-semibold">{r.folio}</td>
                <td>{r.cliente_nombre}<div className="small text-secondary">{r.cliente_telefono}</div></td>
                <td>{[r.tipo_equipo, r.marca, r.modelo].filter(Boolean).join(" · ")}</td>
                <td className="small">
                  {r.ingreso_modo === "recoleccion" && <div>↓ Recolección {r.traslado_ingreso_coordinado ? "✔" : "⏳"}</div>}
                  {r.devolucion_modo === "domicilio" && <div>↑ Entrega {r.traslado_devolucion_coordinado ? "✔" : "⏳"}</div>}
                </td>
                <td><Badge bg={BADGE[r.estado] || "secondary"}>{ETIQUETAS[r.estado]}</Badge></td>
                <td>{r.tecnico_nombre || <span className="text-secondary">—</span>}</td>
                <td>{r.total_fotos}</td>
                <td className="small">{fmtFecha(r.creado_en)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {detalleId && <DetalleReparacion id={detalleId} tecnicos={tecnicos} onClose={() => { setDetalleId(null); cargar(); }} />}
    </div>
  );
}

function DetalleReparacion({ id, tecnicos, onClose }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [productos, setProductos] = useState([]);
  const [diag, setDiag] = useState("");
  const [item, setItem] = useState({ tipo: "mano_obra", descripcion: "", cantidad: 1, precio_unitario: "", producto_id: "", buscar: "" });
  const [pago, setPago] = useState({ monto: "", metodo: "efectivo", referencia: "" });
  const claveCobro = useRef(nuevaClave());
  const [coment, setComent] = useState({ texto: "", visibilidad: "interno" });
  const [paso, setPaso] = useState(null); // { estado, nota, medio, condicion }

  const cargar = useCallback(async () => {
    try {
      const { data } = await api.get(`/reparaciones/${id}`);
      setD(data);
      setDiag(data.diagnostico || "");
    } catch (e) {
      setMsg({ tipo: "danger", texto: errMsg(e, "No se pudo cargar") });
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api.get("/productos").then((r) => setProductos(Array.isArray(r.data) ? r.data : r.data?.productos || [])).catch(() => {}); }, []);

  const run = async (fn, ok) => {
    setOcupado(true); setMsg(null);
    try {
      const r = await fn();
      setMsg({ tipo: "success", texto: r?.data?.message || ok || "Listo" });
      await cargar();
      return true;
    } catch (e) {
      setMsg({ tipo: "danger", texto: errMsg(e) });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const sugeridos = useMemo(() => {
    const q = item.buscar.trim().toLowerCase();
    if (item.tipo !== "repuesto" || q.length < 2) return [];
    return productos.filter((p) => `${p.nombre} ${p.codigo}`.toLowerCase().includes(q)).slice(0, 6);
  }, [productos, item.buscar, item.tipo]);

  if (!d) return <Modal show onHide={onClose} centered><Modal.Body className="text-center py-5"><Spinner /></Modal.Body></Modal>;

  const editable = ["equipo_recibido", "en_diagnostico"].includes(d.estado) && ["ninguna", "borrador"].includes(d.cotizacion_estado);
  const saldo = Number(d.cotizacion_total) - Number(d.pagado);

  const confirmarPaso = async () => {
    const ok = await run(() => api.patch(`/reparaciones/${id}/estado`, {
      estado: paso.estado, nota: paso.nota, medio: paso.medio, condicion_recepcion: paso.condicion,
      confirmar_sin_pago: paso.sinPago,
    }));
    if (ok) setPaso(null);
  };

  return (
    <Modal show onHide={onClose} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>{d.folio} <Badge bg={BADGE[d.estado]}>{ETIQUETAS[d.estado]}</Badge></Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {msg && <div className={`alert alert-${msg.tipo} py-2`}>{msg.texto}</div>}

        <div className="row g-3">
          <div className="col-lg-6">
            <h6 className="fw-bold">Cliente</h6>
            <div>{d.cliente_nombre}</div>
            <div className="small text-secondary">{d.cliente_telefono} {d.cliente_correo && `· ${d.cliente_correo}`}</div>

            <h6 className="fw-bold mt-3">Equipo</h6>
            <div>{[d.tipo_equipo, d.marca, d.modelo].filter(Boolean).join(" · ")}</div>
            {d.numero_serie && <div className="small">Serie: {d.numero_serie}</div>}
            <div className="mt-1" style={{ whiteSpace: "pre-wrap" }}>{d.falla}</div>
            {d.condicion_recepcion && <div className="small mt-1"><strong>Recepción:</strong> {d.condicion_recepcion}</div>}

            <h6 className="fw-bold mt-3">Fotos</h6>
            <div className="d-flex flex-wrap gap-2">
              {d.fotos.length === 0 && <span className="text-secondary small">Sin fotos</span>}
              {d.fotos.map((f) => <FotoPrivada key={f.id} url={`/reparaciones/${id}/fotos/${f.id}`} />)}
            </div>
            <Form.Control type="file" size="sm" className="mt-2" accept="image/jpeg,image/png,image/webp" multiple disabled={ocupado}
              onChange={(e) => {
                const fd = new FormData();
                Array.from(e.target.files).forEach((f) => fd.append("fotos", f));
                e.target.value = "";
                run(() => api.post(`/reparaciones/${id}/fotos`, fd, { headers: { "Content-Type": "multipart/form-data" } }));
              }} />
          </div>

          <div className="col-lg-6">
            <h6 className="fw-bold">Traslados</h6>
            <div className="small">
              <div>
                Ingreso: <strong>{d.ingreso_modo === "recoleccion" ? "Recolección a domicilio" : "En tienda"}</strong>
                {d.ingreso_modo === "recoleccion" && (
                  <>
                    <div>{d.direccion_recoleccion} {d.referencia_recoleccion && `(${d.referencia_recoleccion})`}</div>
                    <div className="text-secondary">Horario preferido (a confirmar): {d.horario_recoleccion || "—"}</div>
                    <div>Costo: {costoTxt(d.costo_recoleccion)}</div>
                    <Form.Check label="Recolección coordinada" checked={!!d.traslado_ingreso_coordinado}
                      onChange={(e) => run(() => api.patch(`/reparaciones/${id}`, { traslado_ingreso_coordinado: e.target.checked }))} />
                  </>
                )}
              </div>
              <div className="mt-2">
                Devolución: <strong>{d.devolucion_modo === "domicilio" ? "Entrega a domicilio" : "Retiro en tienda"}</strong>
                {d.devolucion_modo === "domicilio" && (
                  <>
                    <div>{d.direccion_entrega} {d.referencia_entrega && `(${d.referencia_entrega})`}</div>
                    <div className="text-secondary">Horario preferido (a confirmar): {d.horario_entrega || "—"}</div>
                    <div>Costo: {costoTxt(d.costo_entrega)}</div>
                    <Form.Check label="Entrega coordinada" checked={!!d.traslado_devolucion_coordinado}
                      onChange={(e) => run(() => api.patch(`/reparaciones/${id}`, { traslado_devolucion_coordinado: e.target.checked }))} />
                  </>
                )}
              </div>
              {(d.ingreso_modo === "recoleccion" || d.devolucion_modo === "domicilio") && (
                <div className="d-flex gap-2 mt-2">
                  {[["costo_recoleccion", "Costo recolección"], ["costo_entrega", "Costo entrega"]].map(([k, lbl]) => (
                    <Form.Control key={k} size="sm" type="number" min="0" step="0.01" placeholder={lbl} defaultValue={d[k] ?? ""}
                      onBlur={(e) => e.target.value !== String(d[k] ?? "") && run(() => api.patch(`/reparaciones/${id}`, { [k]: e.target.value }))} />
                  ))}
                </div>
              )}
            </div>

            <h6 className="fw-bold mt-3">Técnico asignado</h6>
            <Form.Select size="sm" value={d.tecnico_id || ""} disabled={ocupado}
              onChange={(e) => run(() => api.patch(`/reparaciones/${id}`, { tecnico_id: e.target.value || null }), "Técnico asignado")}>
              <option value="">Sin asignar</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Form.Select>

            <h6 className="fw-bold mt-3">Diagnóstico</h6>
            <Form.Control as="textarea" rows={3} value={diag} onChange={(e) => setDiag(e.target.value)} />
            <Button size="sm" className="mt-1" disabled={ocupado} onClick={() => run(() => api.patch(`/reparaciones/${id}`, { diagnostico: diag }), "Diagnóstico guardado")}>Guardar diagnóstico</Button>
          </div>
        </div>

        <hr />
        <h6 className="fw-bold">Cotización <Badge bg="light" text="dark">{d.cotizacion_estado}</Badge> {d.cotizacion_resuelta_medio && <span className="small text-secondary">respondió por {d.cotizacion_resuelta_medio} — {fmtFecha(d.cotizacion_resuelta_en)}</span>}</h6>
        <Table size="sm" className="mb-2">
          <thead><tr><th>Tipo</th><th>Concepto</th><th className="text-end">Cant.</th><th className="text-end">Precio</th><th className="text-end">Subtotal</th><th></th></tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.id}>
                <td>{i.tipo === "mano_obra" ? "Mano de obra" : i.tipo === "repuesto" ? "Repuesto" : "Traslado"}</td>
                <td>{i.descripcion} {i.tipo === "repuesto" && (i.consumido ? <Badge bg="success">descontado</Badge> : <span className="small text-secondary">(stock disp.: {Number(i.stock_actual) - Number(i.stock_reservado)})</span>)}</td>
                <td className="text-end">{Number(i.cantidad)}</td><td className="text-end">{money(i.precio_unitario)}</td><td className="text-end">{money(i.subtotal)}</td>
                <td>{editable && !i.consumido && <Button size="sm" variant="link" className="text-danger p-0" onClick={() => run(() => api.delete(`/reparaciones/${id}/items/${i.id}`))}>✕</Button>}</td>
              </tr>
            ))}
            <tr><th colSpan={4} className="text-end">Total</th><th className="text-end">{money(d.cotizacion_total)}</th><th></th></tr>
          </tbody>
        </Table>

        {editable && (
          <div className="p-2 bg-light rounded mb-3">
            <div className="row g-2 align-items-end">
              <div className="col-6 col-md-2">
                <Form.Select size="sm" value={item.tipo} onChange={(e) => setItem({ tipo: e.target.value, descripcion: "", cantidad: 1, precio_unitario: "", producto_id: "", buscar: "" })}>
                  <option value="mano_obra">Mano de obra</option><option value="repuesto">Repuesto</option><option value="traslado">Traslado</option>
                </Form.Select>
              </div>
              {item.tipo === "repuesto" ? (
                <div className="col-12 col-md-4 position-relative">
                  <Form.Control size="sm" placeholder="Buscar repuesto del inventario…" value={item.buscar} onChange={(e) => setItem({ ...item, buscar: e.target.value, producto_id: "" })} />
                  {sugeridos.length > 0 && !item.producto_id && (
                    <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 5 }}>
                      {sugeridos.map((p) => (
                        <button type="button" key={p.id} className="list-group-item list-group-item-action py-1 small"
                          onClick={() => setItem({ ...item, producto_id: p.id, buscar: p.nombre, descripcion: p.nombre, precio_unitario: p.precio })}>
                          {p.nombre} <span className="text-secondary">({p.codigo}) · stock {p.stock}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="col-12 col-md-4"><Form.Control size="sm" placeholder="Descripción" value={item.descripcion} onChange={(e) => setItem({ ...item, descripcion: e.target.value })} /></div>
              )}
              <div className="col-4 col-md-1"><Form.Control size="sm" type="number" min="1" value={item.cantidad} onChange={(e) => setItem({ ...item, cantidad: e.target.value })} /></div>
              <div className="col-4 col-md-2"><Form.Control size="sm" type="number" min="0" step="0.01" placeholder="Precio" value={item.precio_unitario} onChange={(e) => setItem({ ...item, precio_unitario: e.target.value })} /></div>
              <div className="col-4 col-md-3 d-flex gap-1">
                <Button size="sm" disabled={ocupado} onClick={async () => {
                  const ok = await run(() => api.post(`/reparaciones/${id}/items`, { ...item, producto_id: item.producto_id || undefined }), "Concepto agregado");
                  if (ok) setItem({ tipo: item.tipo, descripcion: "", cantidad: 1, precio_unitario: "", producto_id: "", buscar: "" });
                }}>Agregar</Button>
                <Button size="sm" variant="outline-secondary" disabled={ocupado} onClick={() => run(() => api.post(`/reparaciones/${id}/items/traslados`))}>+ Traslados</Button>
              </div>
            </div>
            <div className="form-text">La cotización no descuenta inventario. Los repuestos se descuentan solo al usarlos (reparación en curso).</div>
          </div>
        )}

        {d.estado === "en_reparacion" && d.items.some((i) => i.tipo === "repuesto" && !i.consumido) && (
          <Button variant="warning" size="sm" className="mb-3" disabled={ocupado}
            onClick={() => run(() => api.post(`/reparaciones/${id}/consumir-repuestos`))}>Descontar repuestos usados del inventario</Button>
        )}

        {d.cotizacion_estado === "aprobada" && (
          <div className="p-2 border rounded mb-3">
            <h6 className="fw-bold">Cobro — pagado {money(d.pagado)} de {money(d.cotizacion_total)} (saldo {money(saldo)})</h6>
            {d.pagos.map((p) => <div key={p.id} className="small">{fmtFecha(p.creado_en)} · {money(p.monto)} · {p.metodo} {p.referencia && `· ${p.referencia}`} · {p.usuario_nombre}</div>)}
            {saldo > 0.001 && (
              <div className="row g-2 mt-1">
                <div className="col-4 col-md-2"><Form.Control size="sm" type="number" min="0" step="0.01" placeholder="Monto" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></div>
                <div className="col-4 col-md-2"><Form.Select size="sm" value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></Form.Select></div>
                <div className="col-4 col-md-3"><Form.Control size="sm" placeholder="Referencia" value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></div>
                <div className="col-12 col-md-2">
                  <Button size="sm" disabled={ocupado} onClick={async () => {
                    const ok = await run(() => api.post(`/reparaciones/${id}/pagos`, { ...pago, idempotency_key: claveCobro.current }));
                    if (ok) { claveCobro.current = nuevaClave(); setPago({ monto: "", metodo: "efectivo", referencia: "" }); }
                  }}>Registrar cobro</Button>
                </div>
                <div className="form-text">Este registro no emite factura/CAI: el POS aún no maneja servicios.</div>
              </div>
            )}
          </div>
        )}

        <h6 className="fw-bold">Cambiar estado</h6>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {d.transiciones.length === 0 && <span className="text-secondary small">Estado final</span>}
          {d.transiciones.map((t) => (
            <Button key={t} size="sm" variant={t === "cancelada" || t === "cotizacion_rechazada" ? "outline-danger" : "outline-primary"} disabled={ocupado}
              onClick={() => setPaso({ estado: t, nota: "", medio: "", condicion: "", sinPago: false })}>
              → {ETIQUETAS[t]}
            </Button>
          ))}
        </div>
        {paso && (
          <div className="p-2 border rounded mb-3 bg-light">
            <strong>Pasar a: {ETIQUETAS[paso.estado]}</strong>
            {["aprobada", "cotizacion_rechazada"].includes(paso.estado) && (
              <Form.Control size="sm" className="mt-2" placeholder="¿Cómo respondió el cliente? (WhatsApp, llamada, en tienda…) *" value={paso.medio} onChange={(e) => setPaso({ ...paso, medio: e.target.value })} />
            )}
            {paso.estado === "equipo_recibido" && (
              <Form.Control size="sm" className="mt-2" placeholder="Estado del equipo y accesorios recibidos" value={paso.condicion} onChange={(e) => setPaso({ ...paso, condicion: e.target.value })} />
            )}
            {paso.estado === "entregada" && saldo > 0.001 && d.cotizacion_estado === "aprobada" && (
              <Form.Check className="mt-2" label={`Entregar con saldo pendiente de ${money(saldo)}`} checked={paso.sinPago} onChange={(e) => setPaso({ ...paso, sinPago: e.target.checked })} />
            )}
            {paso.estado === "cotizacion_rechazada" && <div className="small text-secondary mt-1">Luego podrás coordinar la devolución del equipo (pasar a «Lista para entrega»).</div>}
            <Form.Control size="sm" className="mt-2" placeholder="Nota (opcional)" value={paso.nota} onChange={(e) => setPaso({ ...paso, nota: e.target.value })} />
            <div className="mt-2 d-flex gap-2">
              <Button size="sm" disabled={ocupado} onClick={confirmarPaso}>Confirmar</Button>
              <Button size="sm" variant="link" onClick={() => setPaso(null)}>Cancelar</Button>
            </div>
          </div>
        )}

        <div className="row g-3">
          <div className="col-lg-6">
            <h6 className="fw-bold">Comentarios</h6>
            {d.comentarios.map((c) => (
              <div key={c.id} className={`small border-start border-3 ps-2 mb-2 ${c.visibilidad === "cliente" ? "border-primary" : "border-secondary"}`}>
                <Badge bg={c.visibilidad === "cliente" ? "primary" : "secondary"}>{c.visibilidad === "cliente" ? "visible al cliente" : "interno"}</Badge>{" "}
                {c.usuario_nombre} · {fmtFecha(c.creado_en)}<div>{c.texto}</div>
              </div>
            ))}
            <Form.Control as="textarea" rows={2} value={coment.texto} onChange={(e) => setComent({ ...coment, texto: e.target.value })} />
            <div className="d-flex gap-3 align-items-center mt-1">
              <Form.Check inline type="radio" label="Interno" checked={coment.visibilidad === "interno"} onChange={() => setComent({ ...coment, visibilidad: "interno" })} />
              <Form.Check inline type="radio" label="Visible al cliente" checked={coment.visibilidad === "cliente"} onChange={() => setComent({ ...coment, visibilidad: "cliente" })} />
              <Button size="sm" disabled={ocupado || !coment.texto.trim()} onClick={async () => { if (await run(() => api.post(`/reparaciones/${id}/comentarios`, coment))) setComent({ ...coment, texto: "" }); }}>Guardar</Button>
            </div>
          </div>
          <div className="col-lg-6">
            <h6 className="fw-bold">Historial</h6>
            <ul className="list-unstyled small mb-0">
              {d.historial.map((h) => (
                <li key={h.id} className="mb-1">{fmtFecha(h.creado_en)} · <strong>{ETIQUETAS[h.estado_nuevo] || h.estado_nuevo}</strong>
                  {h.estado_anterior && h.estado_anterior !== h.estado_nuevo && <span className="text-secondary"> (desde {ETIQUETAS[h.estado_anterior]})</span>}
                  {" "}· {h.usuario_nombre || "cliente/web"} {h.nota && <span className="text-secondary">— {h.nota}</span>}</li>
              ))}
            </ul>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
