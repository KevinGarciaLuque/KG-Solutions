import { useEffect, useState } from "react";
import api from "../api/axios";

const CAMPOS = [
  { key: "costo_envio_pedido", label: "Envío a domicilio de pedidos web" },
  { key: "costo_recoleccion_reparacion", label: "Recolección del equipo a reparar (a domicilio)" },
  { key: "costo_entrega_reparacion", label: "Entrega del equipo reparado (a domicilio)" },
  { key: "costo_visita_soporte", label: "Visita de soporte técnico a domicilio" },
];

// Costos en lempiras. Vacío = "por cotizar": el cliente lo ve así antes de confirmar.
export default function CostosServiciosTab() {
  const [valores, setValores] = useState({});
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.get("/tienda-config/costos")
      .then((r) => setValores(Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, v === null ? "" : String(v)]))))
      .catch(() => setMsg({ tipo: "danger", texto: "No se pudieron cargar los costos." }));
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setMsg(null);
    try {
      await api.put("/tienda-config/costos", valores);
      setMsg({ tipo: "success", texto: "Costos guardados." });
    } catch (err) {
      setMsg({ tipo: "danger", texto: err.response?.data?.message || "No se pudieron guardar." });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="bg-white rounded shadow-sm p-3 mt-3" style={{ maxWidth: 640 }}>
      <h5 className="mb-1">Costos de envío y traslados</h5>
      <p className="text-muted small">Déjalo vacío para mostrar «por cotizar» al cliente.</p>
      {msg && <div className={`alert alert-${msg.tipo} py-2`}>{msg.texto}</div>}
      {CAMPOS.map((c) => (
        <div className="mb-3" key={c.key}>
          <label className="form-label">{c.label}</label>
          <div className="input-group">
            <span className="input-group-text">L</span>
            <input type="number" min="0" step="0.01" className="form-control" placeholder="Por cotizar"
              value={valores[c.key] ?? ""} onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })} />
          </div>
        </div>
      ))}
      <button className="btn btn-primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar costos"}</button>
    </form>
  );
}
