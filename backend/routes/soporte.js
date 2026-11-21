// backend/routes/soporte.js  (protegido: auth + permiso del módulo "soporte-tecnico")
const express = require("express");
const router = express.Router();
const db = require("../db");
const { requierePermiso } = require("./permisos");
const { recibirFotos, validarFotos, guardarFotos, enviarFoto, s, vacioANull } = require("../lib/servicios");

router.use(requierePermiso("soporte-tecnico"));

const ESTADOS = ["recibido", "asignado", "programado", "en_atencion", "resuelto", "cerrado"];
const TRANSICIONES = {
  recibido: ["asignado", "programado", "en_atencion"],
  asignado: ["programado", "en_atencion"],
  programado: ["asignado", "en_atencion"],
  en_atencion: ["programado", "resuelto"],
  resuelto: ["en_atencion", "cerrado"],
  cerrado: [],
};
const sinSecretos = ({ token_salt, idem_key, ...r }) => r;

const historial = (conn, id, ant, nuevo, nota, usuario) =>
  conn.query(
    "INSERT INTO soporte_historial (ticket_id, estado_anterior, estado_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?)",
    [id, ant, nuevo, nota || null, usuario || null],
  );

router.get("/resumen", async (req, res) => {
  try {
    const [porEstado] = await db.query("SELECT estado, COUNT(*) AS n FROM soporte_tickets GROUP BY estado");
    const [[v]] = await db.query(
      "SELECT COUNT(*) AS n FROM soporte_tickets WHERE modalidad='domicilio' AND fecha_programada IS NULL AND estado IN ('recibido','asignado')",
    );
    res.json({ por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])), visitas_sin_programar: Number(v.n) });
  } catch (e) {
    res.status(500).json({ message: "Error al obtener el resumen" });
  }
});

// ?estado= &desde= &hasta= &responsable_id= &modalidad= &q= &pendiente_visita=1
router.get("/", async (req, res) => {
  try {
    const { estado, desde, hasta, responsable_id, modalidad, q, pendiente_visita } = req.query;
    let sql = `SELECT t.*, u.nombre AS responsable_nombre,
                 (SELECT COUNT(*) FROM soporte_fotos f WHERE f.ticket_id = t.id) AS total_fotos
               FROM soporte_tickets t LEFT JOIN usuarios u ON u.id = t.responsable_id WHERE 1=1`;
    const p = [];
    if (estado && estado !== "todos" && ESTADOS.includes(String(estado))) { sql += " AND t.estado = ?"; p.push(estado); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(desde || ""))) { sql += " AND t.creado_en >= ?"; p.push(`${desde} 00:00:00`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ""))) { sql += " AND t.creado_en <= ?"; p.push(`${hasta} 23:59:59`); }
    if (Number(responsable_id)) { sql += " AND t.responsable_id = ?"; p.push(Number(responsable_id)); }
    if (["remoto", "tienda", "domicilio"].includes(String(modalidad))) { sql += " AND t.modalidad = ?"; p.push(modalidad); }
    if (q) { sql += " AND (t.folio LIKE ? OR t.cliente_nombre LIKE ? OR t.cliente_telefono LIKE ?)"; p.push(...Array(3).fill(`%${q}%`)); }
    if (pendiente_visita) sql += " AND t.modalidad='domicilio' AND t.fecha_programada IS NULL AND t.estado IN ('recibido','asignado')";
    sql += " ORDER BY t.creado_en DESC LIMIT 300";
    const [rows] = await db.query(sql, p);
    res.json(rows.map(sinSecretos));
  } catch (e) {
    console.error("GET /soporte:", e);
    res.status(500).json({ message: "Error al obtener los tickets" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[t]] = await db.query("SELECT t.*, u.nombre AS responsable_nombre, r.folio AS reparacion_folio FROM soporte_tickets t LEFT JOIN usuarios u ON u.id = t.responsable_id LEFT JOIN reparaciones r ON r.id = t.reparacion_id WHERE t.id = ?", [id]);
    if (!t) return res.status(404).json({ message: "Ticket no encontrado" });
    const [fotos] = await db.query("SELECT id, mime, tamano, nombre_original, creado_en FROM soporte_fotos WHERE ticket_id = ? ORDER BY id", [id]);
    const [hist] = await db.query("SELECT h.*, u.nombre AS usuario_nombre FROM soporte_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.ticket_id = ? ORDER BY h.id", [id]);
    const [coment] = await db.query("SELECT c.*, u.nombre AS usuario_nombre FROM soporte_comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.ticket_id = ? ORDER BY c.id", [id]);
    res.json({ ...sinSecretos(t), fotos, historial: hist, comentarios: coment, transiciones: TRANSICIONES[t.estado] || [] });
  } catch (e) {
    res.status(500).json({ message: "Error al obtener el ticket" });
  }
});

router.get("/:id/fotos/:fotoId", async (req, res) => {
  try {
    const [[foto]] = await db.query("SELECT archivo, mime FROM soporte_fotos WHERE id = ? AND ticket_id = ?", [Number(req.params.fotoId), Number(req.params.id)]);
    if (!foto) return res.status(404).json({ message: "No encontrado" });
    return enviarFoto(res, "soporte", Number(req.params.id), foto);
  } catch (e) {
    res.status(500).json({ message: "Error al obtener la imagen" });
  }
});

// Datos de gestión: responsable, fecha programada, solución, costo de visita
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = []; const p = [];
    if ("responsable_id" in b) { sets.push("responsable_id = ?"); p.push(Number(b.responsable_id) || null); }
    if ("fecha_programada" in b) {
      const f = b.fecha_programada ? new Date(b.fecha_programada) : null;
      if (b.fecha_programada && Number.isNaN(f.getTime())) return res.status(400).json({ message: "Fecha inválida" });
      sets.push("fecha_programada = ?"); p.push(f ? f.toISOString().slice(0, 19).replace("T", " ") : null);
    }
    if ("solucion" in b) { sets.push("solucion = ?"); p.push(vacioANull(b.solucion, 5000)); }
    if ("costo_visita" in b) {
      const v = b.costo_visita === "" || b.costo_visita === null ? null : Number(b.costo_visita);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ message: "Costo inválido" });
      sets.push("costo_visita = ?"); p.push(v);
    }
    if (!sets.length) return res.status(400).json({ message: "Nada que actualizar" });
    const [r] = await db.query(`UPDATE soporte_tickets SET ${sets.join(", ")} WHERE id = ? AND estado <> 'cerrado'`, [...p, id]);
    if (!r.affectedRows) return res.status(400).json({ message: "No se pudo actualizar (¿cerrado o inexistente?)" });
    const [[cur]] = await db.query("SELECT estado FROM soporte_tickets WHERE id = ?", [id]);
    if ("responsable_id" in b) await historial(db, id, cur.estado, cur.estado, `Responsable asignado (id: ${Number(b.responsable_id) || "ninguno"})`, req.user.id);
    if ("fecha_programada" in b) await historial(db, id, cur.estado, cur.estado, `Fecha programada: ${b.fecha_programada || "sin fecha"}`, req.user.id);
    res.json({ message: "Actualizado" });
  } catch (e) {
    console.error("PATCH /soporte/:id:", e);
    res.status(500).json({ message: "Error al actualizar" });
  }
});

router.patch("/:id/estado", async (req, res) => {
  const id = Number(req.params.id);
  const nuevo = s(req.body?.estado);
  const nota = vacioANull(req.body?.nota, 255);
  if (!ESTADOS.includes(nuevo)) return res.status(400).json({ message: "Estado inválido" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query("SELECT * FROM soporte_tickets WHERE id = ? FOR UPDATE", [id]);
    if (!t) { await conn.rollback(); return res.status(404).json({ message: "Ticket no encontrado" }); }
    if (!(TRANSICIONES[t.estado] || []).includes(nuevo)) { await conn.rollback(); return res.status(400).json({ message: `No se puede pasar de "${t.estado}" a "${nuevo}".` }); }
    const falla = async (m) => { await conn.rollback(); return res.status(400).json({ message: m }); };
    if (["asignado", "programado", "en_atencion"].includes(nuevo) && !t.responsable_id) return falla("Asigna un responsable primero.");
    if (nuevo === "programado" && !t.fecha_programada) return falla("Indica la fecha programada primero.");
    if (nuevo === "resuelto" && !t.solucion) return falla("Registra la solución aplicada antes de marcarlo como resuelto.");
    await conn.query("UPDATE soporte_tickets SET estado = ? WHERE id = ?", [nuevo, id]);
    await historial(conn, id, t.estado, nuevo, nota, req.user.id);
    await conn.commit();
    res.json({ message: "Estado actualizado", estado: nuevo });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("PATCH /soporte/:id/estado:", e);
    res.status(500).json({ message: "Error al actualizar el estado" });
  } finally { conn.release(); }
});

// Vincular una orden de reparación (si hay que ingresar el equipo al taller)
router.post("/:id/vincular-reparacion", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const repId = Number(req.body?.reparacion_id);
    const [[rep]] = await db.query("SELECT id, folio FROM reparaciones WHERE id = ?", [repId]);
    if (!rep) return res.status(404).json({ message: "Reparación no encontrada" });
    const [r] = await db.query("UPDATE soporte_tickets SET reparacion_id = ? WHERE id = ? AND estado <> 'cerrado'", [repId, id]);
    if (!r.affectedRows) return res.status(400).json({ message: "No se pudo vincular" });
    const [[cur]] = await db.query("SELECT estado FROM soporte_tickets WHERE id = ?", [id]);
    await historial(db, id, cur.estado, cur.estado, `Vinculado a la reparación ${rep.folio}`, req.user.id);
    res.json({ message: "Reparación vinculada" });
  } catch (e) {
    res.status(500).json({ message: "Error al vincular" });
  }
});

router.post("/:id/comentarios", async (req, res) => {
  try {
    const texto = s(req.body?.texto, 2000);
    const vis = req.body?.visibilidad === "cliente" ? "cliente" : "interno";
    if (!texto) return res.status(400).json({ message: "Escribe el comentario" });
    const [r] = await db.query("INSERT INTO soporte_comentarios (ticket_id, visibilidad, texto, usuario_id) SELECT id, ?, ?, ? FROM soporte_tickets WHERE id = ?", [vis, texto, req.user.id, Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ message: "No encontrado" });
    res.json({ message: "Comentario guardado" });
  } catch (e) { res.status(500).json({ message: "Error al guardar el comentario" }); }
});

router.post("/:id/fotos", recibirFotos, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[t]] = await db.query("SELECT id FROM soporte_tickets WHERE id = ?", [id]);
    if (!t) return res.status(404).json({ message: "No encontrado" });
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM soporte_fotos WHERE ticket_id = ?", [id]);
    if (c.n + (req.files || []).length > 20) return res.status(400).json({ message: "Máximo 20 imágenes por ticket." });
    const guardadas = guardarFotos("soporte", id, validarFotos(req.files || []));
    for (const f of guardadas)
      await db.query("INSERT INTO soporte_fotos (ticket_id, archivo, mime, tamano, nombre_original, subido_por) VALUES (?, ?, ?, ?, ?, ?)", [id, f.archivo, f.mime, f.tamano, f.nombre_original, req.user.id]);
    res.json({ message: `${guardadas.length} imagen(es) agregadas` });
  } catch (e) {
    if (/imagen|Máximo|supera/i.test(e.message || "")) return res.status(400).json({ message: e.message });
    res.status(500).json({ message: "Error al subir imágenes" });
  }
});

module.exports = router;
