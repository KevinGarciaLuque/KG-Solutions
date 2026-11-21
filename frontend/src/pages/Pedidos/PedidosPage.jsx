import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Spinner } from "react-bootstrap";
import { FaGlobe, FaSyncAlt } from "react-icons/fa";
import api from "../../api/axios";

const money = (n) => `L ${Number(n || 0).toFixed(2)}`;

const ESTADOS = [
  { key: "nuevo", label: "Nuevos" },
  { key: "en_proceso", label: "En proceso" },
  { key: "listo", label: "Listos para cobrar" },
  { key: "cobrado", label: "Cobrados" },
  { key: "cancelado", label: "Cancelados" },
  { key: "todos", label: "Todos" },
];

const BADGE = {
  nuevo: "primary",
  en_proceso: "warning",
  listo: "success",
  cobrado: "secondary",
  cancelado: "danger",
};

const fmtFecha = (f) => {
  if (!f) return "";
  try {
    return new Date(f).toLocaleString("es-HN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return f;
  }
};

export default function PedidosPage({ onCobrarPedido = () => {} }) {
  const [filtro, setFiltro] = useState("nuevo");
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [seleccionado, setSeleccionado] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [accionLoading, setAccionLoading] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [extra, setExtra] = useState({ desde: "", hasta: "", entrega: "", q: "" });
  const [costoEnvio, setCostoEnvio] = useState("");

  const aviso = (tipo, texto) => {
    setMensaje({ tipo, texto });
    window.clearTimeout(window.__pedidosTimer);
    window.__pedidosTimer = window.setTimeout(() => setMensaje(null), 3500);
  };

  const cargarLista = useCallback(async () => {
    setLoading(true);
    try {
      const params = { estado: filtro, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };
      const res = await api.get("/pedidos", { params });
      setPedidos(Array.isArray(res.data) ? res.data : []);
    } catch {
      aviso("danger", "No se pudieron cargar los pedidos.");
    } finally {
      setLoading(false);
    }
  }, [filtro, extra]);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

  const abrirDetalle = async (id) => {
    setSeleccionado(id);
    setDetalle(null);
    setDetalleLoading(true);
    try {
      const res = await api.get(`/pedidos/${id}`);
      setDetalle(res.data);
    } catch {
      aviso("danger", "No se pudo cargar el pedido.");
    } finally {
      setDetalleLoading(false);
    }
  };

  const cambiarEstado = async (id, estado) => {
    setAccionLoading(true);
    try {
      await api.patch(`/pedidos/${id}/estado`, { estado });
      aviso("success", "Pedido actualizado.");
      await cargarLista();
      await abrirDetalle(id);
    } catch (e) {
      aviso("danger", e.response?.data?.message || "No se pudo actualizar.");
    } finally {
      setAccionLoading(false);
    }
  };

  const confirmarPago = async (id) => {
    setAccionLoading(true);
    try {
      await api.patch(`/pedidos/${id}/pago`, {});
      aviso("success", "Pago confirmado.");
      await abrirDetalle(id);
    } catch (e) {
      aviso("danger", e.response?.data?.message || "No se pudo confirmar el pago.");
    } finally {
      setAccionLoading(false);
    }
  };

  const guardarCostoEnvio = async (id) => {
    setAccionLoading(true);
    try {
      await api.patch(`/pedidos/${id}/costo-envio`, { costo_envio: costoEnvio });
      aviso("success", "Costo de envío registrado.");
      await abrirDetalle(id);
    } catch (e) {
      aviso("danger", e.response?.data?.message || "No se pudo registrar el costo.");
    } finally {
      setAccionLoading(false);
    }
  };

  const cobrar = () => {
    if (!detalle) return;
    onCobrarPedido(detalle);
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <h3 className="mb-0">
          <FaGlobe className="text-info me-2" />
          Pedidos Web
        </h3>
        <Button variant="outline-secondary" size="sm" onClick={cargarLista}>
          <FaSyncAlt className="me-1" /> Actualizar
        </Button>
      </div>

      {mensaje && (
        <div className={`alert alert-${mensaje.tipo} py-2`}>{mensaje.texto}</div>
      )}

      <ul className="nav nav-pills gap-1 mb-3 flex-wrap">
        {ESTADOS.map((e) => (
          <li className="nav-item" key={e.key}>
            <button
              className={`nav-link ${filtro === e.key ? "active" : ""}`}
              onClick={() => setFiltro(e.key)}
            >
              {e.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="row g-2 mb-3">
        <div className="col-6 col-md-2"><input type="date" className="form-control form-control-sm" value={extra.desde} onChange={(e) => setExtra({ ...extra, desde: e.target.value })} /></div>
        <div className="col-6 col-md-2"><input type="date" className="form-control form-control-sm" value={extra.hasta} onChange={(e) => setExtra({ ...extra, hasta: e.target.value })} /></div>
        <div className="col-6 col-md-2">
          <select className="form-select form-select-sm" value={extra.entrega} onChange={(e) => setExtra({ ...extra, entrega: e.target.value })}>
            <option value="">Toda entrega</option><option value="envio">A domicilio</option><option value="recoge">Retiro en tienda</option>
          </select>
        </div>
        <div className="col-6 col-md-4"><input className="form-control form-control-sm" placeholder="Folio, cliente, teléfono…" value={extra.q} onChange={(e) => setExtra({ ...extra, q: e.target.value })} /></div>
      </div>

      <div className="row g-3">
        {/* Lista */}
        <div className="col-lg-5">
          <div className="bg-white shadow-sm rounded">
            {loading ? (
              <div className="p-4 text-center text-muted">
                <Spinner size="sm" animation="border" /> Cargando...
              </div>
            ) : pedidos.length === 0 ? (
              <div className="p-4 text-center text-muted">
                No hay pedidos en esta categoría.
              </div>
            ) : (
              <ul className="list-group list-group-flush">
                {pedidos.map((p) => (
                  <li
                    key={p.id}
                    className={`list-group-item list-group-item-action d-flex justify-content-between align-items-start ${
                      seleccionado === p.id ? "active" : ""
                    }`}
                    style={{ cursor: "pointer" }}
                    onClick={() => abrirDetalle(p.id)}
                  >
                    <div>
                      <div className="fw-semibold">
                        {p.folio || `#${p.id}`} · {p.cliente_nombre}
                      </div>
                      <small
                        className={
                          seleccionado === p.id ? "text-white-50" : "text-muted"
                        }
                      >
                        {fmtFecha(p.creado_en)} ·{" "}
                        {p.entrega === "envio" ? "Envío (por coordinar)" : "Recoge"} ·{" "}
                        pago {p.estado_pago === "confirmado" ? "confirmado" : "pendiente"}
                      </small>
                    </div>
                    <div className="text-end">
                      <div className="fw-bold">{money(p.total_aprox)}</div>
                      <Badge bg={BADGE[p.estado] || "secondary"}>
                        {p.estado}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Detalle */}
        <div className="col-lg-7">
          <div className="bg-white shadow-sm rounded p-3">
            {!seleccionado ? (
              <p className="text-muted mb-0">
                Selecciona un pedido para ver el detalle.
              </p>
            ) : detalleLoading || !detalle ? (
              <div className="text-center text-muted py-4">
                <Spinner size="sm" animation="border" /> Cargando pedido...
              </div>
            ) : (
              <>
                <div className="d-flex justify-content-between align-items-start mb-3">
                  <div>
                    <h5 className="mb-1">Pedido {detalle.folio || `#${detalle.id}`}</h5>
                    <Badge bg={BADGE[detalle.estado] || "secondary"}>
                      {detalle.estado}
                    </Badge>
                  </div>
                  <div className="text-end small text-muted">
                    {fmtFecha(detalle.creado_en)}
                  </div>
                </div>

                <div className="row mb-3">
                  <div className="col-sm-6">
                    <div className="small text-muted">Cliente</div>
                    <div className="fw-semibold">{detalle.cliente_nombre}</div>
                    {detalle.cliente_telefono && (
                      <div className="small">{detalle.cliente_telefono}</div>
                    )}
                    {detalle.cliente_correo && (
                      <div className="small">{detalle.cliente_correo}</div>
                    )}
                  </div>
                  <div className="col-sm-6">
                    <div className="small text-muted">Entrega</div>
                    <div className="fw-semibold">
                      {detalle.entrega === "envio"
                        ? "Envío a domicilio"
                        : "Recoger en el local"}
                    </div>
                    {detalle.entrega === "envio" && (
                      <div className="small">
                        {detalle.cliente_direccion || "-"}
                        {detalle.referencia_entrega && ` (${detalle.referencia_entrega})`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Producto</th>
                        <th className="text-center">Cant.</th>
                        <th className="text-end">P. unit.</th>
                        <th className="text-end">Subtotal</th>
                        <th className="text-center">Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detalle.items || []).map((it) => (
                        <tr key={it.id}>
                          <td>{it.codigo || "-"}</td>
                          <td>{it.nombre}</td>
                          <td className="text-center">{it.cantidad}</td>
                          <td className="text-end">{money(it.precio_unitario)}</td>
                          <td className="text-end">{money(it.subtotal)}</td>
                          <td className="text-center">
                            {it.stock_actual == null ? (
                              "-"
                            ) : (
                              <Badge
                                bg={
                                  Number(it.stock_actual) >= Number(it.cantidad)
                                    ? "success"
                                    : "danger"
                                }
                              >
                                {it.stock_actual}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={4} className="text-end">
                          Total aproximado
                        </th>
                        <th className="text-end">{money(detalle.total_aprox)}</th>
                        <th />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="row g-2 mb-3 small">
                  <div className="col-sm-6">
                    <strong>Pago:</strong>{" "}
                    <Badge bg={detalle.estado_pago === "confirmado" ? "success" : "warning"} text={detalle.estado_pago === "confirmado" ? undefined : "dark"}>
                      {detalle.estado_pago}
                    </Badge>{" "}
                    {detalle.metodo_pago && <span>({detalle.metodo_pago})</span>}
                    {detalle.estado_pago === "pendiente" && !["cancelado", "cobrado"].includes(detalle.estado) && (
                      <Button size="sm" variant="outline-success" className="ms-2" disabled={accionLoading} onClick={() => confirmarPago(detalle.id)}>
                        Confirmar pago
                      </Button>
                    )}
                  </div>
                  <div className="col-sm-6">
                    <strong>Stock:</strong>{" "}
                    {detalle.reserva_activa ? <Badge bg="info">reservado</Badge> : <span className="text-muted">sin reserva</span>}
                  </div>
                  {detalle.entrega === "envio" && (
                    <div className="col-12">
                      <strong>Envío:</strong>{" "}
                      {detalle.envio_cotizar ? <Badge bg="warning" text="dark">por cotizar</Badge> : money(detalle.costo_envio)}
                      {!["cancelado", "cobrado"].includes(detalle.estado) && (
                        <span className="ms-2 d-inline-flex gap-1">
                          <input type="number" min="0" step="0.01" className="form-control form-control-sm" style={{ width: 110 }} placeholder="Costo" value={costoEnvio} onChange={(e) => setCostoEnvio(e.target.value)} />
                          <Button size="sm" variant="outline-secondary" disabled={accionLoading || costoEnvio === ""} onClick={() => guardarCostoEnvio(detalle.id)}>Guardar</Button>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {detalle.numero_factura && (
                  <div className="alert alert-secondary py-2">
                    Facturado: <strong>{detalle.numero_factura}</strong>
                  </div>
                )}

                {/* Acciones por estado */}
                <div className="d-flex flex-wrap gap-2">
                  {detalle.estado === "nuevo" && (
                    <Button
                      variant="warning"
                      disabled={accionLoading}
                      onClick={() => cambiarEstado(detalle.id, "en_proceso")}
                    >
                      Confirmar pedido (reserva stock)
                    </Button>
                  )}

                  {detalle.estado === "en_proceso" && (
                    <Button
                      variant="success"
                      disabled={accionLoading}
                      onClick={() => cambiarEstado(detalle.id, "listo")}
                    >
                      Listo para cobrar
                    </Button>
                  )}

                  {detalle.estado === "listo" && (
                    <>
                      <Button variant="success" onClick={cobrar}>
                        <i className="bi bi-cash-coin me-1" /> Cobrar
                      </Button>
                      <Button
                        variant="outline-secondary"
                        disabled={accionLoading}
                        onClick={() => cambiarEstado(detalle.id, "en_proceso")}
                      >
                        Regresar a proceso
                      </Button>
                    </>
                  )}

                  {["nuevo", "en_proceso", "listo"].includes(detalle.estado) && (
                    <Button
                      variant="outline-danger"
                      disabled={accionLoading}
                      onClick={() => {
                        if (window.confirm("¿Cancelar este pedido?"))
                          cambiarEstado(detalle.id, "cancelado");
                      }}
                    >
                      Cancelar pedido
                    </Button>
                  )}
                </div>

                {Array.isArray(detalle.historial) && detalle.historial.length > 0 && (
                  <div className="mt-3">
                    <div className="small fw-bold mb-1">Historial</div>
                    <ul className="list-unstyled small mb-0">
                      {detalle.historial.map((h) => (
                        <li key={h.id}>
                          {fmtFecha(h.creado_en)} · <strong>{h.estado_nuevo}</strong>
                          {h.usuario_nombre ? ` · ${h.usuario_nombre}` : " · web"}
                          {h.nota ? <span className="text-muted"> — {h.nota}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
