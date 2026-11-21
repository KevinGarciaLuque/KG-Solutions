// backend/routes/reparaciones.js  (protegido: auth + permiso del módulo "reparaciones")
const express = require("express");
const router = express.Router();
const db = require("../db");
const { requierePermiso } = require("./permisos");
const { recibirFotos, validarFotos, guardarFotos, enviarFoto, s, vacioANull, idemValida } = require("../lib/servicios");

router.use(requierePermiso("reparaciones"));

const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta"];
const ESTADOS = [
  "recibida", "pendiente_ingreso", "equipo_recibido", "en_diagnostico", "cotizacion_enviada",
  "aprobada", "cotizacion_rechazada", "en_reparacion", "lista_entrega", "entregada", "cancelada",
];
const TRANSICIONES = {
  recibida: ["pendiente_ingreso", "equipo_recibido", "cancelada"],
  pendiente_ingreso: ["equipo_recibido", "cancelada"],
  equipo_recibido: ["en_diagnostico", "cancelada"],
  en_diagnostico: ["cotizacion_enviada", "cancelada"],
  cotizacion_enviada: ["aprobada", "cotizacion_rechazada", "en_diagnostico", "cancelada"],
  aprobada: ["en_reparacion", "cancelada"],
  cotizacion_rechazada: ["lista_entrega", "en_diagnostico", "cancelada"], // devolver sin reparar o re-cotizar
  en_reparacion: ["lista_entrega", "cancelada"],
  lista_entrega: ["entregada"],
  entregada: [],
  cancelada: [],
};
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const sinSecretos = ({ token_salt, idem_key, ...r }) => r;

async function historial(conn, id, anterior, nuevo, nota, usuario) {
  await conn.query(
    "INSERT INTO reparacion_historial (reparacion_id, estado_anterior, estado_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?)",
    [id, anterior, nuevo, nota || null, usuario || null],
  );
}

async function recalcularTotal(conn, id) {
  const [[t]] = await conn.query("SELECT COALESCE(SUM(subtotal),0) AS total FROM reparacion_items WHERE reparacion_id = ?", [id]);
  await conn.query("UPDATE reparaciones SET cotizacion_total = ? WHERE id = ?", [Number(t.total), id]);
  return Number(t.total);
}

/* ---------- Listados ---------- */
router.get("/tecnicos", async (req, res) => {
  const [rows] = await db.query("SELECT id, nombre, rol FROM usuarios WHERE activo = 1 AND rol IN ('superadmin','admin','almacen','cajero') ORDER BY nombre");
  res.json(rows);
});

router.get("/resumen", async (req, res) => {
  try {
    const [porEstado] = await db.query("SELECT estado, COUNT(*) AS n FROM reparaciones GROUP BY estado");
    const [[traslados]] = await db.query(
      `SELECT
         SUM(ingreso_modo='recoleccion' AND traslado_ingreso_coordinado=0 AND estado IN ('recibida','pendiente_ingreso')) AS recolecciones_pendientes,
         SUM(devolucion_modo='domicilio' AND traslado_devolucion_coordinado=0 AND estado IN ('cotizacion_rechazada','lista_entrega')) AS devoluciones_pendientes
       FROM reparaciones`,
    );
    res.json({
      por_estado: Object.fromEntries(porEstado.map((r) => [r.estado, r.n])),
      recolecciones_pendientes: Number(traslados.recolecciones_pendientes || 0),
      devoluciones_pendientes: Number(traslados.devoluciones_pendientes || 0),
    });
  } catch (e) {
    console.error("GET /reparaciones/resumen:", e);
    res.status(500).json({ message: "Error al obtener el resumen" });
  }
});

// ?estado= &desde= &hasta= &tecnico_id= &q= &traslado=recoleccion|devolucion (pendientes de coordinar)
router.get("/", async (req, res) => {
  try {
    const { estado, desde, hasta, tecnico_id, q, traslado } = req.query;
    let sql = `SELECT r.*, u.nombre AS tecnico_nombre,
                 (SELECT COUNT(*) FROM reparacion_fotos f WHERE f.reparacion_id = r.id) AS total_fotos
               FROM reparaciones r LEFT JOIN usuarios u ON u.id = r.tecnico_id WHERE 1=1`;
    const p = [];
    if (estado && estado !== "todos" && ESTADOS.includes(String(estado))) { sql += " AND r.estado = ?"; p.push(estado); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(desde || ""))) { sql += " AND r.creado_en >= ?"; p.push(`${desde} 00:00:00`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ""))) { sql += " AND r.creado_en <= ?"; p.push(`${hasta} 23:59:59`); }
    if (Number(tecnico_id)) { sql += " AND r.tecnico_id = ?"; p.push(Number(tecnico_id)); }
    if (q) { sql += " AND (r.folio LIKE ? OR r.cliente_nombre LIKE ? OR r.cliente_telefono LIKE ? OR r.marca LIKE ? OR r.modelo LIKE ? OR r.numero_serie LIKE ?)"; p.push(...Array(6).fill(`%${q}%`)); }
    if (traslado === "recoleccion")
      sql += " AND r.ingreso_modo='recoleccion' AND r.traslado_ingreso_coordinado=0 AND r.estado IN ('recibida','pendiente_ingreso')";
    if (traslado === "devolucion")
      sql += " AND r.devolucion_modo='domicilio' AND r.traslado_devolucion_coordinado=0 AND r.estado IN ('cotizacion_rechazada','lista_entrega')";
    sql += " ORDER BY r.creado_en DESC LIMIT 300";
    const [rows] = await db.query(sql, p);
    res.json(rows.map(sinSecretos));
  } catch (e) {
    console.error("GET /reparaciones:", e);
    res.status(500).json({ message: "Error al obtener las reparaciones" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[r]] = await db.query(
      "SELECT r.*, u.nombre AS tecnico_nombre FROM reparaciones r LEFT JOIN usuarios u ON u.id = r.tecnico_id WHERE r.id = ?",
      [id],
    );
    if (!r) return res.status(404).json({ message: "Reparación no encontrada" });
    const [fotos] = await db.query("SELECT id, mime, tamano, nombre_original, subido_por, creado_en FROM reparacion_fotos WHERE reparacion_id = ? ORDER BY id", [id]);
    const [items] = await db.query(
      "SELECT i.*, p.stock AS stock_actual, p.stock_reservado FROM reparacion_items i LEFT JOIN productos p ON p.id = i.producto_id WHERE i.reparacion_id = ? ORDER BY i.id", [id]);
    const [hist] = await db.query(
      "SELECT h.*, u.nombre AS usuario_nombre FROM reparacion_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.reparacion_id = ? ORDER BY h.id", [id]);
    const [coment] = await db.query(
      "SELECT c.*, u.nombre AS usuario_nombre FROM reparacion_comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.reparacion_id = ? ORDER BY c.id", [id]);
    const [pagos] = await db.query(
      "SELECT p.id, p.monto, p.metodo, p.referencia, p.creado_en, u.nombre AS usuario_nombre FROM reparacion_pagos p LEFT JOIN usuarios u ON u.id = p.usuario_id WHERE p.reparacion_id = ? ORDER BY p.id", [id]);
    const pagado = pagos.reduce((a, x) => a + Number(x.monto), 0);
    res.json({ ...sinSecretos(r), fotos, items, historial: hist, comentarios: coment, pagos, pagado, transiciones: TRANSICIONES[r.estado] || [] });
  } catch (e) {
    console.error("GET /reparaciones/:id:", e);
    res.status(500).json({ message: "Error al obtener la reparación" });
  }
});

router.get("/:id/fotos/:fotoId", async (req, res) => {
  try {
    const [[foto]] = await db.query("SELECT archivo, mime FROM reparacion_fotos WHERE id = ? AND reparacion_id = ?", [Number(req.params.fotoId), Number(req.params.id)]);
    if (!foto) return res.status(404).json({ message: "No encontrado" });
    return enviarFoto(res, "reparaciones", Number(req.params.id), foto);
  } catch (e) {
    res.status(500).json({ message: "Error al obtener la imagen" });
  }
});

/* ---------- Edición de datos de gestión ---------- */
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = []; const p = [];
    if ("tecnico_id" in b) { sets.push("tecnico_id = ?"); p.push(num(b.tecnico_id) || null); }
    if ("diagnostico" in b) { sets.push("diagnostico = ?"); p.push(vacioANull(b.diagnostico, 5000)); }
    if ("condicion_recepcion" in b) { sets.push("condicion_recepcion = ?"); p.push(vacioANull(b.condicion_recepcion, 2000)); }
    for (const k of ["costo_recoleccion", "costo_entrega"]) {
      if (k in b) { const v = num(b[k]); if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ message: "Costo inválido" }); sets.push(`${k} = ?`); p.push(v); }
    }
    for (const k of ["traslado_ingreso_coordinado", "traslado_devolucion_coordinado"]) {
      if (k in b) { sets.push(`${k} = ?`); p.push(b[k] ? 1 : 0); }
    }
    if (!sets.length) return res.status(400).json({ message: "Nada que actualizar" });
    const [r] = await db.query(`UPDATE reparaciones SET ${sets.join(", ")} WHERE id = ? AND estado NOT IN ('entregada','cancelada')`, [...p, id]);
    if (!r.affectedRows) return res.status(400).json({ message: "No se pudo actualizar (¿cerrada o inexistente?)" });
    if ("tecnico_id" in b) {
      // Registro del cambio (mismo estado, con la nota) para saber quién asignó y cuándo.
      const [[cur]] = await db.query("SELECT estado FROM reparaciones WHERE id = ?", [id]);
      await historial(db, id, cur.estado, cur.estado, `Técnico asignado (id: ${num(b.tecnico_id) || "ninguno"})`, req.user.id);
    }
    res.json({ message: "Actualizado" });
  } catch (e) {
    console.error("PATCH /reparaciones/:id:", e);
    res.status(500).json({ message: "Error al actualizar" });
  }
});

/* ---------- Cambio de estado con reglas de negocio ---------- */
router.patch("/:id/estado", async (req, res) => {
  const id = Number(req.params.id);
  const nuevo = s(req.body?.estado);
  const nota = vacioANull(req.body?.nota, 255);
  const medio = vacioANull(req.body?.medio, 60); // cómo aprobó/rechazó el cliente
  const condicion = vacioANull(req.body?.condicion_recepcion, 2000);
  const sinPago = !!req.body?.confirmar_sin_pago;
  if (!ESTADOS.includes(nuevo)) return res.status(400).json({ message: "Estado inválido" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT * FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ message: "Reparación no encontrada" }); }
    if (!(TRANSICIONES[r.estado] || []).includes(nuevo)) {
      await conn.rollback();
      return res.status(400).json({ message: `No se puede pasar de "${r.estado}" a "${nuevo}".` });
    }
    const falla = async (m) => { await conn.rollback(); return res.status(400).json({ message: m }); };
    const sets = ["estado = ?"]; const p = [nuevo];

    if (nuevo === "equipo_recibido") { sets.push("fecha_recepcion = NOW()", "recibido_por = ?"); p.push(req.user.id); if (condicion) { sets.push("condicion_recepcion = ?"); p.push(condicion); } }
    if (nuevo === "cotizacion_enviada") {
      const [[c]] = await conn.query("SELECT COUNT(*) AS n FROM reparacion_items WHERE reparacion_id = ?", [id]);
      if (!c.n) return falla("Agrega al menos un concepto a la cotización antes de enviarla.");
      if (!r.diagnostico) return falla("Registra el diagnóstico antes de enviar la cotización.");
      sets.push("cotizacion_estado = 'enviada'", "cotizacion_enviada_en = NOW()");
    }
    if (nuevo === "en_diagnostico" && ["cotizacion_enviada", "cotizacion_rechazada"].includes(r.estado)) {
      sets.push("cotizacion_estado = 'borrador'"); // permite re-cotizar
    }
    if (nuevo === "aprobada" || nuevo === "cotizacion_rechazada") {
      if (r.cotizacion_estado !== "enviada") return falla("La cotización no está enviada.");
      if (!medio) return falla("Indica cómo respondió el cliente (WhatsApp, llamada, en tienda...).");
      sets.push("cotizacion_estado = ?", "cotizacion_resuelta_en = NOW()", "cotizacion_resuelta_por = ?", "cotizacion_resuelta_medio = ?", "cotizacion_resuelta_nota = ?");
      p.push(nuevo === "aprobada" ? "aprobada" : "rechazada", req.user.id, medio, nota);
    }
    if (nuevo === "en_reparacion" && r.cotizacion_estado !== "aprobada") return falla("La reparación solo inicia con la aprobación registrada del cliente.");
    if (nuevo === "entregada") {
      if (r.cotizacion_estado === "aprobada") {
        const [[pg]] = await conn.query("SELECT COALESCE(SUM(monto),0) AS pagado FROM reparacion_pagos WHERE reparacion_id = ?", [id]);
        if (Number(pg.pagado) + 0.001 < Number(r.cotizacion_total) && !sinPago) return falla("Hay saldo pendiente. Registra el cobro o confirma la entrega sin pago completo.");
      }
      sets.push("entregada_en = NOW()");
    }

    await conn.query(`UPDATE reparaciones SET ${sets.join(", ")} WHERE id = ?`, [...p, id]);
    await historial(conn, id, r.estado, nuevo, nota, req.user.id);
    await conn.commit();
    res.json({ message: "Estado actualizado", estado: nuevo });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("PATCH /reparaciones/:id/estado:", e);
    res.status(500).json({ message: "Error al actualizar el estado" });
  } finally { conn.release(); }
});

/* ---------- Cotización: conceptos ---------- */
const editable = (r) => ["equipo_recibido", "en_diagnostico"].includes(r.estado) && ["ninguna", "borrador"].includes(r.cotizacion_estado);

router.post("/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const tipo = s(b.tipo);
  if (!["mano_obra", "repuesto", "traslado"].includes(tipo)) return res.status(400).json({ message: "Tipo inválido" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT estado, cotizacion_estado FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ message: "No encontrada" }); }
    if (!editable(r)) { await conn.rollback(); return res.status(400).json({ message: "La cotización ya no se puede editar en este estado." }); }

    let descripcion = s(b.descripcion, 200);
    let cantidad = Number(b.cantidad ?? 1);
    let precio = num(b.precio_unitario);
    let producto_id = null;
    if (tipo === "repuesto") {
      producto_id = Number(b.producto_id);
      if (!Number.isInteger(producto_id) || producto_id <= 0) { await conn.rollback(); return res.status(400).json({ message: "Selecciona el repuesto del inventario." }); }
      const [[p]] = await conn.query("SELECT nombre, precio, descuento FROM productos WHERE id = ? AND activo = 1", [producto_id]);
      if (!p) { await conn.rollback(); return res.status(400).json({ message: "Producto no encontrado" }); }
      if (!Number.isInteger(cantidad)) { await conn.rollback(); return res.status(400).json({ message: "La cantidad de repuestos debe ser entera." }); }
      descripcion = descripcion || p.nombre;
      if (precio === null) precio = Number((Number(p.precio) * (1 - (Number(p.descuento) || 0) / 100)).toFixed(2));
    }
    if (!descripcion) { await conn.rollback(); return res.status(400).json({ message: "Describe el concepto." }); }
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 9999 || precio === null || !Number.isFinite(precio) || precio < 0) {
      await conn.rollback(); return res.status(400).json({ message: "Cantidad o precio inválido." });
    }
    await conn.query(
      "INSERT INTO reparacion_items (reparacion_id, tipo, producto_id, descripcion, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, tipo, producto_id, descripcion, cantidad, precio, Number((cantidad * precio).toFixed(2))],
    );
    const total = await recalcularTotal(conn, id);
    await conn.query("UPDATE reparaciones SET cotizacion_estado = 'borrador' WHERE id = ?", [id]);
    await conn.commit();
    res.json({ message: "Concepto agregado", total });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("POST /reparaciones/:id/items:", e);
    res.status(500).json({ message: "Error al agregar el concepto" });
  } finally { conn.release(); }
});

// Agrega como conceptos de "traslado" los costos de recolección/entrega ya definidos (>0) que aún no estén
router.post("/:id/items/traslados", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT * FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ message: "No encontrada" }); }
    if (!editable(r)) { await conn.rollback(); return res.status(400).json({ message: "La cotización ya no se puede editar." }); }
    const [exist] = await conn.query("SELECT descripcion FROM reparacion_items WHERE reparacion_id = ? AND tipo = 'traslado'", [id]);
    const ya = new Set(exist.map((e) => e.descripcion));
    const candidatos = [["Recolección a domicilio", r.costo_recoleccion], ["Entrega a domicilio", r.costo_entrega]];
    let agregados = 0;
    for (const [desc, costo] of candidatos) {
      if (costo !== null && Number(costo) > 0 && !ya.has(desc)) {
        await conn.query("INSERT INTO reparacion_items (reparacion_id, tipo, descripcion, cantidad, precio_unitario, subtotal) VALUES (?, 'traslado', ?, 1, ?, ?)", [id, desc, costo, costo]);
        agregados++;
      }
    }
    const total = await recalcularTotal(conn, id);
    if (agregados) await conn.query("UPDATE reparaciones SET cotizacion_estado = 'borrador' WHERE id = ?", [id]);
    await conn.commit();
    res.json({ message: agregados ? "Traslados agregados" : "No hay traslados nuevos con costo definido", total });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(500).json({ message: "Error al agregar traslados" });
  } finally { conn.release(); }
});

router.delete("/:id/items/:itemId", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT estado, cotizacion_estado FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r || !editable(r)) { await conn.rollback(); return res.status(400).json({ message: "La cotización ya no se puede editar." }); }
    await conn.query("DELETE FROM reparacion_items WHERE id = ? AND reparacion_id = ? AND consumido = 0", [Number(req.params.itemId), id]);
    const total = await recalcularTotal(conn, id);
    await conn.commit();
    res.json({ message: "Concepto eliminado", total });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(500).json({ message: "Error al eliminar" });
  } finally { conn.release(); }
});

/* ---------- Consumo de repuestos (movimientos de inventario) ---------- */
// Idempotente: cada concepto se consume una sola vez (flag consumido + bloqueo FOR UPDATE).
router.post("/:id/consumir-repuestos", async (req, res) => {
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT folio, estado FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ message: "No encontrada" }); }
    if (r.estado !== "en_reparacion") { await conn.rollback(); return res.status(400).json({ message: "Los repuestos solo se consumen con la reparación en curso." }); }

    const [items] = await conn.query(
      "SELECT id, producto_id, cantidad, descripcion FROM reparacion_items WHERE reparacion_id = ? AND tipo = 'repuesto' AND consumido = 0 AND producto_id IS NOT NULL ORDER BY producto_id, id", [id]);
    for (const it of items) {
      const [[p]] = await conn.query("SELECT nombre, stock, stock_reservado FROM productos WHERE id = ? FOR UPDATE", [it.producto_id]);
      const disponible = Number(p.stock) - Number(p.stock_reservado);
      if (disponible < Number(it.cantidad)) {
        await conn.rollback();
        return res.status(409).json({ message: `Stock insuficiente de "${p.nombre}". Disponible: ${Math.max(0, disponible)}.` });
      }
      await conn.query("UPDATE productos SET stock = stock - ? WHERE id = ?", [it.cantidad, it.producto_id]);
      await conn.query(
        "INSERT INTO movimientos (producto_id, tipo, cantidad, descripcion, usuario_id) VALUES (?, 'salida', ?, ?, ?)",
        [it.producto_id, it.cantidad, `Repuesto usado en reparación ${r.folio}`, req.user.id],
      );
      await conn.query("UPDATE reparacion_items SET consumido = 1, consumido_en = NOW(), consumido_por = ? WHERE id = ? AND consumido = 0", [req.user.id, it.id]);
    }
    if (items.length)
      await conn.query("INSERT INTO bitacora (usuario_id, accion, descripcion) VALUES (?, ?, ?)", [req.user.id, "Consumo de repuestos", `Reparación ${r.folio}: ${items.length} repuesto(s) descontados del inventario.`]);
    await conn.commit();
    res.json({ message: items.length ? `${items.length} repuesto(s) descontados del inventario` : "No hay repuestos pendientes de consumir", consumidos: items.length });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("POST consumir-repuestos:", e);
    res.status(500).json({ message: "Error al consumir repuestos" });
  } finally { conn.release(); }
});

/* ---------- Cobro (registro de pago de la reparación) ---------- */
// NOTA: el POS actual no maneja "servicios"; este registro NO emite factura/CAI.
router.post("/:id/pagos", async (req, res) => {
  const id = Number(req.params.id);
  const monto = Number(req.body?.monto);
  const metodo = s(req.body?.metodo).toLowerCase();
  const idem = idemValida(req.body?.idempotency_key);
  if (!idem) return res.status(400).json({ message: "Falta la clave de idempotencia." });
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ message: "Monto inválido" });
  if (!METODOS_PAGO.includes(metodo)) return res.status(400).json({ message: "Método de pago no habilitado" });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query("SELECT cotizacion_estado, cotizacion_total, estado FROM reparaciones WHERE id = ? FOR UPDATE", [id]);
    if (!r) { await conn.rollback(); return res.status(404).json({ message: "No encontrada" }); }
    const [[ya]] = await conn.query("SELECT id FROM reparacion_pagos WHERE reparacion_id = ? AND idem_key = ?", [id, idem]);
    if (ya) { await conn.rollback(); return res.json({ message: "El cobro ya estaba registrado", repetido: true }); }
    if (r.cotizacion_estado !== "aprobada") { await conn.rollback(); return res.status(400).json({ message: "Solo se cobra una cotización aprobada." }); }
    const [[pg]] = await conn.query("SELECT COALESCE(SUM(monto),0) AS pagado FROM reparacion_pagos WHERE reparacion_id = ?", [id]);
    if (Number(pg.pagado) + monto > Number(r.cotizacion_total) + 0.001) { await conn.rollback(); return res.status(400).json({ message: "El monto excede el saldo pendiente." }); }
    await conn.query("INSERT INTO reparacion_pagos (reparacion_id, monto, metodo, referencia, idem_key, usuario_id) VALUES (?, ?, ?, ?, ?, ?)", [id, monto, metodo, vacioANull(req.body?.referencia, 120), idem, req.user.id]);
    await conn.commit();
    res.json({ message: "Cobro registrado" });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e.code === "ER_DUP_ENTRY") return res.json({ message: "El cobro ya estaba registrado", repetido: true });
    console.error("POST /reparaciones/:id/pagos:", e);
    res.status(500).json({ message: "Error al registrar el cobro" });
  } finally { conn.release(); }
});

/* ---------- Comentarios (cliente vs internos) y fotos de personal ---------- */
router.post("/:id/comentarios", async (req, res) => {
  try {
    const texto = s(req.body?.texto, 2000);
    const vis = req.body?.visibilidad === "cliente" ? "cliente" : "interno";
    if (!texto) return res.status(400).json({ message: "Escribe el comentario" });
    const [r] = await db.query("INSERT INTO reparacion_comentarios (reparacion_id, visibilidad, texto, usuario_id) SELECT id, ?, ?, ? FROM reparaciones WHERE id = ?", [vis, texto, req.user.id, Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ message: "No encontrada" });
    res.json({ message: "Comentario guardado" });
  } catch (e) { res.status(500).json({ message: "Error al guardar el comentario" }); }
});

router.post("/:id/fotos", recibirFotos, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[r]] = await db.query("SELECT id FROM reparaciones WHERE id = ?", [id]);
    if (!r) return res.status(404).json({ message: "No encontrada" });
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM reparacion_fotos WHERE reparacion_id = ?", [id]);
    if (c.n + (req.files || []).length > 20) return res.status(400).json({ message: "Máximo 20 imágenes por reparación." });
    const guardadas = guardarFotos("reparaciones", id, validarFotos(req.files || []));
    for (const f of guardadas)
      await db.query("INSERT INTO reparacion_fotos (reparacion_id, archivo, mime, tamano, nombre_original, subido_por) VALUES (?, ?, ?, ?, ?, ?)", [id, f.archivo, f.mime, f.tamano, f.nombre_original, req.user.id]);
    res.json({ message: `${guardadas.length} imagen(es) agregadas` });
  } catch (e) {
    if (/imagen|Máximo|supera/i.test(e.message || "")) return res.status(400).json({ message: e.message });
    console.error("POST /reparaciones/:id/fotos:", e);
    res.status(500).json({ message: "Error al subir imágenes" });
  }
});

module.exports = router;
