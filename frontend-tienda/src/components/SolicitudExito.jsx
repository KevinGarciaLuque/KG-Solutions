import { useState } from "react";
import { Link } from "react-router-dom";
import { linkSeguimiento } from "../utils/servicios.js";

// Confirmación en pantalla: folio + enlace de seguimiento seguro.
const SolicitudExito = ({ titulo, folio, token, children }) => {
  const [copiado, setCopiado] = useState(false);
  const link = linkSeguimiento(token);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      window.prompt("Copia tu enlace de seguimiento:", link);
    }
  };

  return (
    <div className="container py-5" style={{ maxWidth: 640 }}>
      <div className="p-4 rounded-4 bg-white shadow-sm text-center">
        <i className="bi bi-check-circle-fill text-success" style={{ fontSize: 48 }}></i>
        <h1 className="h4 fw-bold mt-2">{titulo}</h1>
        <p className="mb-1 text-secondary">Tu folio es</p>
        <p className="display-6 fw-bold mb-3" data-testid="folio">{folio}</p>

        {children}

        <div className="alert alert-warning text-start small">
          <strong>Guarda tu enlace de seguimiento.</strong> El folio por sí solo no permite ver tus datos; solo este
          enlace te da acceso al estado, fotos y cotización de tu solicitud. No lo compartas.
        </div>

        <div className="input-group mb-3">
          <input className="form-control" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-outline-secondary" onClick={copiar}>
            {copiado ? "¡Copiado!" : "Copiar"}
          </button>
        </div>

        <Link to={`/seguimiento/${token}`} className="btn btn-warning fw-semibold">
          Ver seguimiento
        </Link>
      </div>
    </div>
  );
};

export default SolicitudExito;
