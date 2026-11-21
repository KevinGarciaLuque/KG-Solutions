// backend/lib/servicios.js
// Utilidades compartidas por pedidos web, reparaciones y soporte técnico:
//  - folios legibles (no secretos)
//  - enlaces de seguimiento firmados (HMAC): el folio solo NO da acceso a datos
//  - validación y almacenamiento PRIVADO de imágenes
//  - límite simple de peticiones por IP para formularios públicos
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

/* ---------------- Folios ---------------- */
const PREFIJOS = { pedido: "PW", reparacion: "REP", soporte: "SOP" };

const armarFolio = (tipo, id, fecha = new Date()) =>
  `${PREFIJOS[tipo]}-${fecha.getFullYear()}-${String(id).padStart(6, "0")}`;

/* ---------------- Token de seguimiento ---------------- */
// token = <k><id>.<hmac>   donde k = p|r|s. Se puede recalcular (reintentos
// idempotentes devuelven el mismo enlace) y no se puede falsificar sin el secreto.
const KIND = { pedido: "p", reparacion: "r", soporte: "s" };

function secreto() {
  const s = process.env.TRACKING_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error("Falta TRACKING_SECRET o JWT_SECRET en el entorno.");
  return s;
}

const nuevaSal = () => crypto.randomBytes(16).toString("hex");

function firmar(tipo, id, salt) {
  return crypto
    .createHmac("sha256", secreto())
    .update(`${tipo}:${id}:${salt}`)
    .digest("base64url");
}

const generarToken = (tipo, id, salt) => `${KIND[tipo]}${id}.${firmar(tipo, id, salt)}`;

// Devuelve { tipo, id } si el formato es válido (aún sin verificar firma)
function parsearToken(token) {
  const m = /^([prs])(\d{1,10})\.([A-Za-z0-9_-]{20,64})$/.exec(String(token || "").trim());
  if (!m) return null;
  const tipo = Object.keys(KIND).find((k) => KIND[k] === m[1]);
  return { tipo, id: Number(m[2]), firma: m[3] };
}

function verificarToken(tipo, id, salt, firma) {
  if (!salt) return false;
  const esperado = Buffer.from(firmar(tipo, id, salt));
  const recibido = Buffer.from(String(firma));
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

/* ---------------- Imágenes privadas ---------------- */
const MAX_FOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB por imagen
const PRIVATE_ROOT = process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), "private_uploads");

// Detecta el tipo real por firma binaria (no se confía en mimetype ni extensión).
function detectarImagen(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

// Middleware multer en memoria: nada toca el disco hasta validar todo el lote.
const subirFotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FOTOS, fields: 40, fieldSize: 20 * 1024 },
}).array("fotos", MAX_FOTOS);

// Wrapper para convertir errores de multer en 400 legibles
const recibirFotos = (req, res, next) =>
  subirFotos(req, res, (err) => {
    if (!err) return next();
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? `Cada imagen debe pesar máximo ${MAX_BYTES / 1024 / 1024} MB.`
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? `Máximo ${MAX_FOTOS} imágenes.`
          : "No se pudieron procesar los archivos.";
    return res.status(400).json({ message: msg });
  });

// Valida todas las imágenes del request; lanza Error si alguna es inválida.
function validarFotos(files = []) {
  if (files.length > MAX_FOTOS) throw new Error(`Máximo ${MAX_FOTOS} imágenes.`);
  return files.map((f) => {
    const tipo = detectarImagen(f.buffer);
    if (!tipo) throw new Error(`"${f.originalname}" no es una imagen válida (solo JPG, PNG o WebP).`);
    if (f.size > MAX_BYTES) throw new Error(`"${f.originalname}" supera ${MAX_BYTES / 1024 / 1024} MB.`);
    return { ...tipo, buffer: f.buffer, size: f.size, original: String(f.originalname || "").slice(0, 140) };
  });
}

// Guarda en disco privado y devuelve filas listas para insertar.
function guardarFotos(carpeta, id, validadas) {
  const dir = path.join(PRIVATE_ROOT, carpeta, String(id));
  fs.mkdirSync(dir, { recursive: true });
  return validadas.map((v) => {
    const archivo = `${crypto.randomBytes(16).toString("hex")}.${v.ext}`;
    fs.writeFileSync(path.join(dir, archivo), v.buffer, { flag: "wx" });
    return { archivo, mime: v.mime, tamano: v.size, nombre_original: v.original };
  });
}

function rutaFoto(carpeta, id, archivo) {
  // archivo viene de la BD, pero se protege igualmente contra traversal
  const limpio = path.basename(String(archivo));
  return path.join(PRIVATE_ROOT, carpeta, String(id), limpio);
}

function enviarFoto(res, carpeta, id, foto) {
  const ruta = rutaFoto(carpeta, id, foto.archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ message: "Archivo no encontrado" });
  res.set({
    "Content-Type": foto.mime,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return fs.createReadStream(ruta).pipe(res);
}

/* ---------------- Rate limit simple por IP ---------------- */
function limitar({ max = 10, ventanaMs = 10 * 60 * 1000 } = {}) {
  const golpes = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const ahora = Date.now();
    const lista = (golpes.get(ip) || []).filter((t) => ahora - t < ventanaMs);
    if (lista.length >= max) {
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." });
    }
    lista.push(ahora);
    golpes.set(ip, lista);
    if (golpes.size > 5000) for (const [k, v] of golpes) if (!v.some((t) => ahora - t < ventanaMs)) golpes.delete(k);
    next();
  };
}

/* ---------------- Costos configurables ---------------- */
const CLAVES_COSTO = [
  "costo_envio_pedido",
  "costo_recoleccion_reparacion",
  "costo_entrega_reparacion",
  "costo_visita_soporte",
];

// valor '' o ausente => null ("por cotizar")
async function leerCostos(conn) {
  const [rows] = await conn.query("SELECT clave, valor FROM configuracion WHERE clave IN (?)", [CLAVES_COSTO]);
  const out = Object.fromEntries(CLAVES_COSTO.map((k) => [k, null]));
  for (const r of rows) {
    const v = String(r.valor ?? "").trim();
    const n = v === "" ? null : Number(v);
    out[r.clave] = Number.isFinite(n) && n >= 0 ? n : null;
  }
  return out;
}

/* ---------------- Helpers varios ---------------- */
const s = (v, max = 255) => String(v ?? "").trim().slice(0, max);
const vacioANull = (v, max) => {
  const t = s(v, max);
  return t === "" ? null : t;
};
const correoValido = (v) => !v || /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(v);
const idemValida = (v) => {
  const t = s(v, 64);
  return /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
};

module.exports = {
  armarFolio,
  nuevaSal,
  generarToken,
  parsearToken,
  verificarToken,
  recibirFotos,
  validarFotos,
  guardarFotos,
  enviarFoto,
  limitar,
  leerCostos,
  CLAVES_COSTO,
  MAX_FOTOS,
  s,
  vacioANull,
  correoValido,
  idemValida,
};
