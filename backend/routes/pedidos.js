// backend/routes/pedidos.js
// Módulo de Pedidos Web (protegido). Los pedidos entran desde la tienda pública
// (routes/public.js -> POST /pedidos). Aquí el personal los gestiona:
//   nuevo -> en_proceso (CONFIRMA: reserva stock) -> listo -> (se cobra en Registrar Venta) -> cobrado
// También: cancelado (libera la reserva). Política de stock: ver lib/stock.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { reservarPedido, liberarPedido } = require("../lib/stock");
const { requierePermiso } = require("./permisos");

const requireRoles =
  (...roles) =>
  (req, res, next) => {
    const rol = req.user?.rol;
    if (!rol || (!roles.includes(rol) && rol !== "superadmin")) {
      return res.status(403).json({ message: "Acceso denegado." });
    }
    next();
  };

const GESTOR = requireRoles("admin", "cajero", "usuario");
// Además del rol, exige el módulo "pedidos" en la matriz de permisos
const PUEDE = [GESTOR, requierePermiso("pedidos")];

const TRANSICIONES = {
  nuevo: ["en_proceso", "cancelado"],
  en_proceso: ["listo", "cancelado"],
  listo: ["en_proceso", "cancelado"],
  cobrado: [],
  cancelado: [],
};

const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta"];

// Nunca exponer la sal del enlace de seguimiento
const limpiar = (p) => {
  if (!p) return p;
  const { token_salt, idem_key, ...resto } = p;
  return resto;
};

// GET /api/pedidos/resumen -> { nuevos } para la campanita (polling ligero)
router.get("/resumen", PUEDE, async (req, res) => {
  try {
    const [[row]] = await db.query(
      "SELECT COUNT(*) AS nuevos FROM pedidos_web WHERE estado = 'nuevo'",
    );
    const [recientes] = await db.query(
      `SELECT id, folio, cliente_nombre, total_aprox, entrega, creado_en, leido
       FROM pedidos_web
       WHERE estado = 'nuevo'
       ORDER BY creado_en DESC
       LIMIT 8`,
    );
    return res.json({ nuevos: row.nuevos, recientes });
  } catch (error) {
    console.error("❌ Error GET /pedidos/resumen:", error);
    return res.status(500).json({ message: "Error al obtener el resumen de pedidos" });
  }
});

// GET /api/pedidos?estado=&desde=&hasta=&entrega=&q=
router.get("/", PUEDE, async (req, res) => {
  try {
    const estado = String(req.query.estado || "").trim();
    const desde = String(req.query.desde || "").trim();
    const hasta = String(req.query.hasta || "").trim();
    const entrega = String(req.query.entrega || "").trim();
    const q = String(req.query.q || "").trim();

    let sql = `
      SELECT p.*, f.numero_factura
      FROM pedidos_web p
      LEFT JOIN ventas v ON v.id = p.venta_id
      LEFT JOIN facturas f ON f.id = v.factura_id
      WHERE 1=1
    `;
    const params = [];
    if (estado && estado !== "todos") {
      sql += " AND p.estado = ? ";
      params.push(estado);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      sql += " AND p.creado_en >= ? ";
      params.push(`${desde} 00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      sql += " AND p.creado_en <= ? ";
      params.push(`${hasta} 23:59:59`);
    }
    if (entrega === "envio" || entrega === "recoge") {
      sql += " AND p.entrega = ? ";
      params.push(entrega);
    }
    if (q) {
      sql += " AND (p.folio LIKE ? OR p.cliente_nombre LIKE ? OR p.cliente_telefono LIKE ?) ";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY p.creado_en DESC LIMIT 300";

    const [rows] = await db.query(sql, params);
    return res.json(rows.map(limpiar));
  } catch (error) {
    console.error("❌ Error GET /pedidos:", error);
    return res.status(500).json({ message: "Error al obtener los pedidos" });
  }
});

// GET /api/pedidos/:id -> pedido + items + historial
router.get("/:id", PUEDE, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const [[pedido]] = await db.query(
      `SELECT p.*, f.numero_factura
       FROM pedidos_web p
       LEFT JOIN ventas v ON v.id = p.venta_id
       LEFT JOIN facturas f ON f.id = v.factura_id
       WHERE p.id = ? LIMIT 1`,
      [id],
    );
    if (!pedido) return res.status(404).json({ message: "Pedido no encontrado" });

    const [items] = await db.query(
      `SELECT i.*, pr.stock AS stock_actual, pr.stock_reservado
       FROM pedido_web_items i
       LEFT JOIN productos pr ON pr.id = i.producto_id
       WHERE i.pedido_id = ?
       ORDER BY i.id ASC`,
      [id],
    );
    const [historial] = await db.query(
      `SELECT h.*, u.nombre AS usuario_nombre
       FROM pedido_web_historial h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.pedido_id = ? ORDER BY h.id ASC`,
      [id],
    );

    return res.json({ ...limpiar(pedido), items, historial });
  } catch (error) {
    console.error("❌ Error GET /pedidos/:id:", error);
    return res.status(500).json({ message: "Error al obtener el pedido" });
  }
});

// PATCH /api/pedidos/:id/estado  body: { estado, nota? }
// Transacción: bloquea el pedido, valida transición, reserva/libera stock y registra historial.
router.patch("/:id/estado", PUEDE, async (req, res) => {
  const id = Number(req.params.id);
  const nuevoEstado = String(req.body.estado || "").trim();
  const nota = String(req.body.nota || "").trim().slice(0, 255) || null;
  if (!id) return res.status(400).json({ message: "ID inválido" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[pedido]] = await conn.query(
      "SELECT estado FROM pedidos_web WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!pedido) {
      await conn.rollback();
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    const permitidas = TRANSICIONES[pedido.estado] || [];
    if (!permitidas.includes(nuevoEstado)) {
      await conn.rollback();
      return res.status(400).json({
        message: `No se puede pasar de "${pedido.estado}" a "${nuevoEstado}".`,
      });
    }

    if (nuevoEstado === "en_proceso") await reservarPedido(conn, id); // lanza si no hay stock
    if (nuevoEstado === "cancelado") await liberarPedido(conn, id);

    await conn.query(
      "UPDATE pedidos_web SET estado = ?, procesado_por = ?, leido = 1 WHERE id = ?",
      [nuevoEstado, req.user?.id || null, id],
    );
    await conn.query(
      "INSERT INTO pedido_web_historial (pedido_id, estado_anterior, estado_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?)",
      [id, pedido.estado, nuevoEstado, nota, req.user?.id || null],
    );

    await conn.commit();
    return res.json({ message: "Estado actualizado", estado: nuevoEstado });
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    const esNegocio = /stock insuficiente|no disponible/i.test(error.message || "");
    if (!esNegocio) console.error("❌ Error PATCH /pedidos/:id/estado:", error);
    return res
      .status(esNegocio ? 409 : 500)
      .json({ message: esNegocio ? error.message : "Error al actualizar el estado" });
  } finally {
    conn.release();
  }
});

// PATCH /api/pedidos/:id/pago  body: { metodo_pago? }  -> confirma el pago (idempotente)
router.patch("/:id/pago", PUEDE, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const metodo = String(req.body.metodo_pago || "").trim().toLowerCase();
    if (metodo && !METODOS_PAGO.includes(metodo)) {
      return res.status(400).json({ message: "Método de pago no habilitado." });
    }
    const [[ped]] = await db.query("SELECT estado, estado_pago, metodo_pago FROM pedidos_web WHERE id = ?", [id]);
    if (!ped) return res.status(404).json({ message: "Pedido no encontrado" });
    if (ped.estado === "cancelado") return res.status(400).json({ message: "El pedido está cancelado." });
    if (ped.estado_pago === "confirmado") return res.json({ message: "El pago ya estaba confirmado." });

    const metodoFinal = metodo || ped.metodo_pago;
    if (!metodoFinal) return res.status(400).json({ message: "Indica el método de pago." });

    await db.query(
      `UPDATE pedidos_web
       SET estado_pago = 'confirmado', metodo_pago = ?, pago_confirmado_por = ?, pago_confirmado_en = NOW()
       WHERE id = ? AND estado_pago = 'pendiente'`,
      [metodoFinal, req.user?.id || null, id],
    );
    await db.query(
      "INSERT INTO pedido_web_historial (pedido_id, estado_anterior, estado_nuevo, nota, usuario_id) VALUES (?, ?, ?, ?, ?)",
      [id, ped.estado, ped.estado, `Pago confirmado (${metodoFinal})`, req.user?.id || null],
    );
    return res.json({ message: "Pago confirmado" });
  } catch (error) {
    console.error("❌ Error PATCH /pedidos/:id/pago:", error);
    return res.status(500).json({ message: "Error al confirmar el pago" });
  }
});

// PATCH /api/pedidos/:id/costo-envio body: { costo_envio } -> cotiza el envío pendiente
router.patch("/:id/costo-envio", PUEDE, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const costo = Number(req.body.costo_envio);
    if (!Number.isFinite(costo) || costo < 0) return res.status(400).json({ message: "Costo inválido." });
    const [r] = await db.query(
      "UPDATE pedidos_web SET costo_envio = ?, envio_cotizar = 0 WHERE id = ? AND entrega = 'envio' AND estado NOT IN ('cobrado','cancelado')",
      [costo, id],
    );
    if (!r.affectedRows) return res.status(400).json({ message: "No se pudo actualizar el costo de envío." });
    return res.json({ message: "Costo de envío registrado" });
  } catch (error) {
    console.error("❌ Error PATCH /pedidos/:id/costo-envio:", error);
    return res.status(500).json({ message: "Error al registrar el costo" });
  }
});

// PATCH /api/pedidos/:id/leido -> marca la notificación como vista
router.patch("/:id/leido", PUEDE, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido" });
    await db.query("UPDATE pedidos_web SET leido = 1 WHERE id = ?", [id]);
    return res.json({ message: "Pedido marcado como visto" });
  } catch (error) {
    console.error("❌ Error PATCH /pedidos/:id/leido:", error);
    return res.status(500).json({ message: "Error al marcar el pedido" });
  }
});

// PATCH /api/pedidos/leidos/todos -> marca todos los nuevos como vistos
router.patch("/leidos/todos", PUEDE, async (req, res) => {
  try {
    await db.query("UPDATE pedidos_web SET leido = 1 WHERE estado = 'nuevo'");
    return res.json({ message: "Notificaciones marcadas como vistas" });
  } catch (error) {
    console.error("❌ Error PATCH /pedidos/leidos/todos:", error);
    return res.status(500).json({ message: "Error al marcar las notificaciones" });
  }
});

module.exports = router;
