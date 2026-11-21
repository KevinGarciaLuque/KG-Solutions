import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { getImgSrc } from "../utils/img.js";
import { buildWaLink } from "../utils/whatsapp.js";
import { useSiteConfig } from "../context/SiteConfigContext.jsx";
import SolicitudExito from "../components/SolicitudExito.jsx";
import { guardarSeguimiento, money, nuevaClave } from "../utils/servicios.js";
import api from "../api/axios.js";

const METODO_TXT = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta" };

const CartPage = () => {
  const { items, removeItem, updateQty, totalPrecio, clear } = useCart();
  const { telefonoPrincipal } = useSiteConfig();
  const claveRef = useRef(nuevaClave());

  const [costos, setCostos] = useState(null);
  const [paso, setPaso] = useState("carrito"); // carrito | datos
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(null);
  const [aceptaCotizar, setAceptaCotizar] = useState(false);
  const [d, setD] = useState({
    cliente_nombre: "", cliente_telefono: "", cliente_correo: "",
    entrega: "recoge", cliente_direccion: "", referencia_entrega: "", metodo_pago: "", notas: "",
  });

  useEffect(() => {
    api.get("/public/costos").then((r) => setCostos(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e.target.value }));
  const metodos = costos?.metodos_pago || ["efectivo", "transferencia", "tarjeta"];
  const envioCotizar = d.entrega === "envio" && costos && costos.envio_pedido === null;
  const costoEnvio = d.entrega === "envio" && costos && costos.envio_pedido !== null ? costos.envio_pedido : 0;

  if (ok) {
    const linkWa = buildWaLink(
      telefonoPrincipal,
      `Hola, hice el pedido ${ok.folio} en la tienda web. Quedo atento a la confirmación.`,
    );
    return (
      <SolicitudExito titulo="Pedido registrado" folio={ok.folio} token={ok.seguimiento_token}>
        <p className="mb-1">Total de productos: <strong>{money(ok.total)}</strong></p>
        {d.entrega === "envio" && (
          <p className="mb-1">Envío: <strong>{ok.envio_cotizar ? "por cotizar (te lo confirmaremos antes de despachar)" : money(ok.costo_envio)}</strong></p>
        )}
        <p className="text-secondary small">
          Pago <strong>pendiente</strong>: nuestro equipo confirmará tu pedido y el método de pago contigo. Tu pedido aún no
          reserva unidades hasta que el personal lo confirme.
        </p>
        {telefonoPrincipal && (
          <a className="btn btn-outline-success btn-sm mb-3" href={linkWa} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-whatsapp me-1"></i> Avisar por WhatsApp (opcional)
          </a>
        )}
      </SolicitudExito>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container py-5 text-center">
        <h1 className="h3 fw-bold mb-3">Tu carrito está vacío</h1>
        <p className="text-secondary mb-4">Agrega productos desde la tienda.</p>
        <Link to="/productos" className="btn btn-warning fw-semibold">Ver productos</Link>
      </div>
    );
  }

  const confirmar = async (e) => {
    e.preventDefault();
    setError("");
    if (!d.cliente_nombre.trim()) return setError("Escribe tu nombre.");
    if (!d.cliente_telefono.trim() && !d.cliente_correo.trim()) return setError("Indica un teléfono/WhatsApp o un correo.");
    if (d.entrega === "envio" && !d.cliente_direccion.trim()) return setError("La dirección es obligatoria para entrega a domicilio.");
    if (envioCotizar && !aceptaCotizar) return setError("Confirma que entiendes que el costo de envío se cotiza aparte.");

    setEnviando(true);
    try {
      const { data } = await api.post("/public/pedidos", {
        ...d,
        idempotency_key: claveRef.current,
        items: items.map((it) => ({ producto_id: it.id, cantidad: it.cantidad })),
      });
      guardarSeguimiento({ tipo: "pedido", folio: data.folio, token: data.seguimiento_token });
      setOk(data);
      clear();
    } catch (err) {
      setError(err.response?.data?.message || "No se pudo registrar el pedido. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="container py-5">
      <h1 className="h3 fw-bold mb-4">{paso === "carrito" ? "Tu carrito" : "Datos del pedido"}</h1>

      <div className="row g-5">
        <div className="col-lg-8">
          {paso === "carrito" &&
            items.map((it) => (
              <div className="cart-row d-flex align-items-center gap-3 py-3 border-bottom" key={it.id}>
                <img src={getImgSrc(it.imagen)} alt={it.nombre} className="cart-row-img" />
                <div className="flex-grow-1">
                  <p className="fw-semibold mb-1">{it.nombre}</p>
                  <p className="text-secondary small mb-0">{money(it.precio)} c/u</p>
                </div>
                <div className="input-group" style={{ maxWidth: 120 }}>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => updateQty(it.id, it.cantidad - 1)}>-</button>
                  <input type="number" className="form-control form-control-sm text-center" value={it.cantidad} min={1}
                    onChange={(e) => updateQty(it.id, Math.max(1, Number(e.target.value) || 1))} />
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => updateQty(it.id, it.cantidad + 1)}>+</button>
                </div>
                <p className="fw-bold mb-0 text-end" style={{ minWidth: 90 }}>{money(it.precio * it.cantidad)}</p>
                <button className="btn btn-link text-danger" onClick={() => removeItem(it.id)} aria-label="Eliminar">
                  <i className="bi bi-trash"></i>
                </button>
              </div>
            ))}
          {paso === "carrito" && (
            <button className="btn btn-link text-secondary mt-2 p-0" onClick={clear}>Vaciar carrito</button>
          )}

          {paso === "datos" && (
            <form id="form-pedido" onSubmit={confirmar} className="p-4 rounded-4 bg-white shadow-sm">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label">Nombre completo *</label>
                  <input className="form-control" value={d.cliente_nombre} onChange={set("cliente_nombre")} maxLength={150} autoFocus />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Teléfono / WhatsApp</label>
                  <input className="form-control" inputMode="tel" value={d.cliente_telefono} onChange={set("cliente_telefono")} maxLength={40} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Correo electrónico</label>
                  <input type="email" className="form-control" value={d.cliente_correo} onChange={set("cliente_correo")} maxLength={150} />
                </div>

                <div className="col-12">
                  <label className="form-label d-block fw-semibold">¿Cómo quieres recibir tu pedido?</label>
                  <div className="form-check">
                    <input className="form-check-input" type="radio" id="e-recoge" checked={d.entrega === "recoge"} onChange={() => setD((p) => ({ ...p, entrega: "recoge" }))} />
                    <label className="form-check-label" htmlFor="e-recoge"><i className="bi bi-shop me-1"></i> Retiro en tienda <span className="text-secondary small">(sin costo)</span></label>
                  </div>
                  <div className="form-check">
                    <input className="form-check-input" type="radio" id="e-envio" checked={d.entrega === "envio"} onChange={() => setD((p) => ({ ...p, entrega: "envio" }))} />
                    <label className="form-check-label" htmlFor="e-envio"><i className="bi bi-truck me-1"></i> Entrega a domicilio{" "}
                      {costos && <span className="text-secondary small">({costos.envio_pedido === null ? "costo por cotizar" : money(costos.envio_pedido)})</span>}
                    </label>
                  </div>
                </div>

                {d.entrega === "envio" && (
                  <>
                    <div className="col-12">
                      <label className="form-label">Dirección de entrega *</label>
                      <input className="form-control" value={d.cliente_direccion} onChange={set("cliente_direccion")} maxLength={255} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Referencia</label>
                      <input className="form-control" value={d.referencia_entrega} onChange={set("referencia_entrega")} maxLength={255} />
                    </div>
                    {envioCotizar && (
                      <div className="col-12">
                        <div className="alert alert-warning mb-2 small">
                          El costo de envío <strong>requiere cotización</strong>. Te lo confirmaremos antes de despachar; podrás cancelar si no te conviene.
                        </div>
                        <div className="form-check">
                          <input className="form-check-input" type="checkbox" id="acepta" checked={aceptaCotizar} onChange={(e) => setAceptaCotizar(e.target.checked)} />
                          <label className="form-check-label" htmlFor="acepta">Entiendo que el envío se cotiza aparte</label>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="col-12">
                  <label className="form-label">Método de pago preferido</label>
                  <select className="form-select" value={d.metodo_pago} onChange={set("metodo_pago")}>
                    <option value="">Lo definimos al confirmar</option>
                    {metodos.map((m) => <option key={m} value={m}>{METODO_TXT[m] || m}</option>)}
                  </select>
                  <div className="form-text">El pago queda pendiente; el personal lo confirma. No se cobra en línea.</div>
                </div>
                <div className="col-12">
                  <label className="form-label">Notas (opcional)</label>
                  <textarea className="form-control" rows={2} value={d.notas} onChange={set("notas")} maxLength={1000} />
                </div>
              </div>
            </form>
          )}
        </div>

        <div className="col-lg-4">
          <div className="cart-summary p-4 rounded-4">
            <h5 className="fw-bold mb-3">Resumen</h5>
            <div className="d-flex justify-content-between mb-2"><span>Productos</span><span className="fw-bold">{money(totalPrecio)}</span></div>
            {paso === "datos" && d.entrega === "envio" && (
              <div className="d-flex justify-content-between mb-2">
                <span>Envío</span><span className="fw-bold">{envioCotizar ? "Por cotizar" : money(costoEnvio)}</span>
              </div>
            )}
            <p className="text-secondary small">
              Los precios y la disponibilidad se validan al registrar el pedido. El total final lo confirma el personal.
            </p>
            {paso === "carrito" ? (
              <button className="btn btn-warning w-100 fw-semibold" onClick={() => { setPaso("datos"); setError(""); }}>
                Continuar con el pedido
              </button>
            ) : (
              <>
                <button className="btn btn-warning w-100 fw-semibold mb-2" form="form-pedido" disabled={enviando}>
                  {enviando ? "Registrando…" : "Registrar pedido"}
                </button>
                <button className="btn btn-link w-100" onClick={() => setPaso("carrito")} disabled={enviando}>← Volver al carrito</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CartPage;
