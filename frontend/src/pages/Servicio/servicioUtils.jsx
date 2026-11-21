// Utilidades compartidas por las pantallas de Reparaciones y Soporte técnico.
import { useEffect, useState } from "react";
import api from "../../api/axios";

export const money = (n) => `L ${Number(n || 0).toFixed(2)}`;

export const fmtFecha = (f) => {
  if (!f) return "";
  try {
    return new Date(f).toLocaleString("es-HN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(f);
  }
};

export const nuevaClave = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`)
    .replace(/[^A-Za-z0-9]/g, "")
    .padEnd(32, "0")
    .slice(0, 48);

export const ETIQUETAS = {
  recibida: "Recibida", pendiente_ingreso: "Pendiente de ingreso", equipo_recibido: "Equipo recibido",
  en_diagnostico: "En diagnóstico", cotizacion_enviada: "Cotización enviada", aprobada: "Aprobada",
  cotizacion_rechazada: "Cotización rechazada", en_reparacion: "En reparación", lista_entrega: "Lista para entrega",
  entregada: "Entregada", cancelada: "Cancelada",
  recibido: "Recibido", asignado: "Asignado", programado: "Programado", en_atencion: "En atención",
  resuelto: "Resuelto", cerrado: "Cerrado",
};

export const BADGE = {
  recibida: "primary", recibido: "primary", pendiente_ingreso: "info", equipo_recibido: "info", en_diagnostico: "warning",
  cotizacion_enviada: "warning", aprobada: "success", cotizacion_rechazada: "danger", en_reparacion: "warning",
  lista_entrega: "success", entregada: "secondary", cancelada: "dark", asignado: "info", programado: "info",
  en_atencion: "warning", resuelto: "success", cerrado: "secondary",
};

// Carga una imagen protegida (requiere Bearer) como blob y la muestra.
export function FotoPrivada({ url, alt = "Foto" }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let activo = true;
    let objUrl = null;
    api.get(url, { responseType: "blob" })
      .then((r) => {
        if (!activo) return;
        objUrl = URL.createObjectURL(r.data);
        setSrc(objUrl);
      })
      .catch(() => activo && setSrc("error"));
    return () => {
      activo = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [url]);

  if (src === "error") return <span className="text-danger small">No se pudo cargar</span>;
  if (!src) return <span className="text-secondary small">Cargando…</span>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      <img src={src} alt={alt} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }} />
    </a>
  );
}

export const errMsg = (e, fallback = "Ocurrió un error") => e?.response?.data?.message || fallback;
