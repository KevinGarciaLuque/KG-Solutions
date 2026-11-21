// Utilidades de los formularios de pedidos / reparaciones / soporte.

export const MAX_FOTOS = 6;
export const MAX_MB = 5;
const TIPOS_OK = ["image/jpeg", "image/png", "image/webp"];

export const money = (n) => `L ${Number(n || 0).toFixed(2)}`;

// Clave de idempotencia: un reintento del mismo envío no crea duplicados.
export const nuevaClave = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`)
    .replace(/[^A-Za-z0-9]/g, "")
    .padEnd(32, "0")
    .slice(0, 48);

// Validación previa en el navegador (el servidor valida de nuevo).
export const validarFotosCliente = (actuales, nuevas) => {
  const lista = [...actuales];
  for (const f of nuevas) {
    if (!TIPOS_OK.includes(f.type)) return { error: `"${f.name}" no es JPG, PNG o WebP.` };
    if (f.size > MAX_MB * 1024 * 1024) return { error: `"${f.name}" pesa más de ${MAX_MB} MB.` };
    lista.push(f);
  }
  if (lista.length > MAX_FOTOS) return { error: `Máximo ${MAX_FOTOS} imágenes.` };
  return { lista };
};

/* ---- Seguimientos guardados en este navegador (solo conveniencia) ---- */
const KEY = "kg_seguimientos";

export const leerSeguimientos = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const guardarSeguimiento = ({ tipo, folio, token }) => {
  try {
    const previos = leerSeguimientos().filter((s) => s.token !== token);
    localStorage.setItem(KEY, JSON.stringify([{ tipo, folio, token, fecha: Date.now() }, ...previos].slice(0, 20)));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
};

export const linkSeguimiento = (token) => `${window.location.origin}/seguimiento/${token}`;

// Acepta el enlace completo o solo el código
export const extraerToken = (texto) => {
  const t = String(texto || "").trim();
  const m = /([prs]\d{1,10}\.[A-Za-z0-9_-]{20,64})/.exec(t);
  return m ? m[1] : "";
};
