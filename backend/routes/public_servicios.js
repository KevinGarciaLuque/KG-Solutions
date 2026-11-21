// backend/routes/public_servicios.js
// Rutas PÚBLICAS (sin login) de la tienda: pedidos, solicitudes de reparación,
// tickets de soporte y seguimiento. Montado en /api/public.
// El acceso a una solicitud ajena es imposible sin su enlace firmado (HMAC);
// el folio por sí solo NO devuelve datos.
const express = require("express");
const fs = require("fs");
const router = express.Router();
const db = require("../db");
const bus = require("../lib/pedidosBus");
const {
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
  s,
  vacioANull,
  correoValido,
  idemValida,
} = require("../lib/servicios");

const limitePost = limitar({ max: 10, ventanaMs: 10 * 60 * 1000 });
const limiteConsulta = limitar({ max: 120, ventanaMs: 10 * 60 * 1000 });

const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta"];
const MAX_UNIDADES_LINEA = 50;
const MAX_LINEAS = 60;

const emitirSeguro = (evento, data) => {
  try {
    bus.emit(evento, data);
  } catch (e) {
    console.warn("bus emit falló:", e.message);
  }
};

/* =====================================================
   GET /api/public/costos  -> costos de traslado/envío (null = por cotizar)
===================================================== */
router.get("/costos", async (req, res) => {
  try {
    const c = await leerCostos(db);
    return res.json({
      envio_pedido: c.costo_envio_pedido,
      recoleccion_reparacion: c.costo_recoleccion_reparacion,
      entrega_reparacion: c.costo_entrega_reparacion,
      visita_soporte: c.costo_visita_soporte,
      metodos_pago: METODOS_PAGO,
    });
  } catch (error) {
    console.error("❌ GET /public/costos:", error);
    return res.status(500).json({ message: "No se pudieron cargar los costos" });
  }
});

/* =====================================================
   POST /api/public/pedidos
   Revalida producto, precio y cantidad contra la BD. El pedido queda "nuevo",
   con pago pendiente y SIN reservar stock (la reserva ocurre al confirmarlo en el panel).
===================================================== */
router.post("/pedidos", limitePost, async (req, res) => {
  const b = req.body || {};
  const cliente_nombre = s(b.cliente_nombre, 150);
  const cliente_telefono = vacioANull(b.cliente_telefono, 40);
  const cliente_correo = vacioANull(b.cliente_correo, 150);
  const entrega = s(b.entrega).toLowerCase() === "envio" ? "envio" : "recoge";
  const cliente_direccion = vacioANull(b.cliente_direccion, 255);
  const referencia_entrega = vacioANull(b.referencia_entrega, 255);
  const notas = vacioANull(b.notas, 1000);
  const metodo = s(b.metodo_pago, 30).toLowerCase();
  const idem = idemValida(b.idempotency_key);
  const itemsIn = Array.isArray(b.items) ? b.items : [];

  if (!cliente_nombre) return res.status(400).json({ message: "El nombre es obligatorio." });
  if (!cliente_telefono && !cliente_correo)
    return res.status(400).json({ message: "Indica un teléfono/WhatsApp o un correo de contacto." });
  if (!correoValido(cliente_correo)) return res.status(400).json({ message: "Correo inválido." });
  if (entrega === "envio" && !cliente_direccion)
    return res.status(400).json({ message: "La dirección es obligatoria para entrega a domicilio." });
  if (metodo && !METODOS_PAGO.includes(metodo))
    return res.status(400).json({ message: "Método de pago no disponible." });
  if (!itemsIn.length || itemsIn.length > MAX_LINEAS)
    return res.status(400).json({ message: "El pedido no tiene productos válidos." });

  // Reintento idempotente: mismo pedido => mismo folio y mismo enlace
  const respuestaExistente = async () => {
    if (!idem) return null;
    const [[p]] = await db.query(
      "SELECT id, folio, token_salt, total_aprox, costo_envio, envio_cotizar FROM pedidos_web WHERE idem_key = ?",
      [idem],
    );
    if (!p) return null;
    return {
      id: p.id,
      folio: p.folio,
      total: Number(p.total_aprox),
      costo_envio: p.costo_envio === null ? null : Number(p.costo_envio),
      envio_cotizar: !!p.envio_cotizar,
      estado_pago: "pendiente",
      seguimiento_token: generarToken("pedido", p.id, p.token_salt),
      repetido: true,
    };
  };

  const previo = await respuestaExistente();
  if (previo) return res.json(previo);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Agrupa líneas repetidas del mismo producto
    const pedidoPorProducto = new Map();
    for (const raw of itemsIn) {
      const pid = Number(raw?.producto_id);
      const cant = Number(raw?.cantidad);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(cant) || cant <= 0 || cant > MAX_UNIDADES_LINEA) {
        throw new Error("Producto o cantidad inválida en el pedido.");
      }
      pedidoPorProducto.set(pid, (pedidoPorProducto.get(pid) || 0) + cant);
    }

    const lineas = [];
    let total = 0;
    for (const [pid, cantidad] of pedidoPorProducto) {
      const [rows] = await conn.query(
        `SELECT id, codigo, nombre, precio, descuento, stock, stock_reservado
         FROM productos WHERE id = ? AND activo = 1 LIMIT 1`,
        [pid],
      );
      if (!rows.length) throw new Error(`Producto no encontrado (ID ${pid}).`);
      const p = rows[0];
      const disponible = Number(p.stock) - Number(p.stock_reservado);
      if (disponible < cantidad) {
        throw new Error(
          disponible > 0
            ? `Solo hay ${disponible} unidad(es) disponibles de "${p.nombre}".`
            : `"${p.nombre}" está agotado.`,
        );
      }
      const descPct = Math.max(0, Math.min(100, Number(p.descuento) || 0));
      const precioUnit = Number((Number(p.precio) * (1 - descPct / 100)).toFixed(2));
      const subtotal = Number((precioUnit * cantidad).toFixed(2));
      total += subtotal;
      lineas.push({ producto_id: p.id, codigo: p.codigo || null, nombre: p.nombre, cantidad, precio_unitario: precioUnit, subtotal });
    }
    total = Number(total.toFixed(2));

    // Costo de envío: lo define el servidor, nunca el cliente
    let costo_envio = null;
    let envio_cotizar = 0;
    if (entrega === "envio") {
      const costos = await leerCostos(conn);
      if (costos.costo_envio_pedido === null) envio_cotizar = 1;
      else costo_envio = costos.costo_envio_pedido;
    } else {
      costo_envio = 0;
    }

    const salt = nuevaSal();
    const [r] = await conn.query(
      `INSERT INTO pedidos_web
        (cliente_nombre, cliente_telefono, cliente_correo, cliente_direccion, referencia_entrega,
         entrega, total_aprox, costo_envio, envio_cotizar, metodo_pago, estado_pago, notas,
         token_salt, idem_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
      [cliente_nombre, cliente_telefono, cliente_correo, entrega === "envio" ? cliente_direccion : null,
       entrega === "envio" ? referencia_entrega : null, entrega, total, costo_envio, envio_cotizar,
       metodo || null, notas, salt, idem],
    );
    const pedido_id = r.insertId;
    const folio = armarFolio("pedido", pedido_id);
    await conn.query("UPDATE pedidos_web SET folio = ? WHERE id = ?", [folio, pedido_id]);

    for (const l of lineas) {
      await conn.query(
        `INSERT INTO pedido_web_items (pedido_id, producto_id, codigo, nombre, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pedido_id, l.producto_id, l.codigo, l.nombre, l.cantidad, l.precio_unitario, l.subtotal],
      );
    }
    await conn.query(
      "INSERT INTO pedido_web_historial (pedido_id, estado_anterior, estado_nuevo, nota) VALUES (?, NULL, 'nuevo', 'Pedido creado desde la web')",
      [pedido_id],
    );
    await conn.commit();

    emitirSeguro("nuevo", { id: pedido_id, folio, cliente_nombre, total, entrega });

    return res.json({
      id: pedido_id,
      folio,
      total,
      costo_envio,
      envio_cotizar: !!envio_cotizar,
      estado_pago: "pendiente",
      seguimiento_token: generarToken("pedido", pedido_id, salt),
      items: lineas,
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    if (error.code === "ER_DUP_ENTRY" && idem) {
      const dup = await respuestaExistente().catch(() => null);
      if (dup) return res.json(dup);
    }
    const esNegocio = /producto|agotado|unidad|cantidad|inválid/i.test(error.message || "");
    if (!esNegocio) console.error("❌ POST /public/pedidos:", error);
    return res
      .status(esNegocio ? 400 : 500)
      .json({ message: esNegocio ? error.message : "No se pudo registrar el pedido." });
  } finally {
    conn.release();
  }
});

/* =====================================================
   Helpers para formularios con fotos (reparación / soporte)
===================================================== */
async function crearSolicitud({ tabla, carpeta, tipo, fotosTabla, fotosFk, historialTabla, historialFk,
                                estadoInicial, columnas, valores, idem, files, nota }) {
  const validadas = validarFotos(files); // lanza antes de tocar BD/disco
  const conn = await db.getConnection();
  let guardadas = [];
  let idCreado = null;
  try {
    await conn.beginTransaction();
    const salt = nuevaSal();
    const cols = [...columnas, "token_salt", "idem_key"];
    const [r] = await conn.query(
      `INSERT INTO ${tabla} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      [...valores, salt, idem],
    );
    const id = r.insertId;
    idCreado = id;
    const folio = armarFolio(tipo, id);
    await conn.query(`UPDATE ${tabla} SET folio = ? WHERE id = ?`, [folio, id]);
    await conn.query(
      `INSERT INTO ${historialTabla} (${historialFk}, estado_anterior, estado_nuevo, nota) VALUES (?, NULL, ?, ?)`,
      [id, estadoInicial, nota],
    );
    guardadas = guardarFotos(carpeta, id, validadas);
    for (const f of guardadas) {
      await conn.query(
        `INSERT INTO ${fotosTabla} (${fotosFk}, archivo, mime, tamano, nombre_original) VALUES (?, ?, ?, ?, ?)`,
        [id, f.archivo, f.mime, f.tamano, f.nombre_original],
      );
    }
    await conn.commit();
    return { id, folio, salt, fotos: guardadas.length };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    // limpia archivos huérfanos si ya se escribieron antes del fallo
    if (guardadas.length && idCreado) limpiarCarpeta(carpeta, idCreado);
    throw e;
  } finally {
    conn.release();
  }
}

const limpiarCarpeta = (carpeta, id) => {
  try {
    const path = require("path");
    const root = process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), "private_uploads");
    fs.rmSync(path.join(root, carpeta, String(id)), { recursive: true, force: true });
  } catch {}
};

/* =====================================================
   POST /api/public/reparaciones   (multipart: campos + fotos[])
===================================================== */
router.post("/reparaciones", limitePost, recibirFotos, async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = s(b.cliente_nombre, 150);
    const telefono = vacioANull(b.cliente_telefono, 40);
    const correo = vacioANull(b.cliente_correo, 150);
    const tipo_equipo = s(b.tipo_equipo, 80);
    const falla = s(b.falla, 3000);
    const ingreso = s(b.ingreso_modo) === "recoleccion" ? "recoleccion" : "tienda";
    const devolucion = s(b.devolucion_modo) === "domicilio" ? "domicilio" : "tienda";
    const idem = idemValida(b.idempotency_key);

    if (!nombre) return res.status(400).json({ message: "El nombre es obligatorio." });
    if (!telefono && !correo) return res.status(400).json({ message: "Indica un teléfono/WhatsApp o un correo." });
    if (!correoValido(correo)) return res.status(400).json({ message: "Correo inválido." });
    if (!tipo_equipo) return res.status(400).json({ message: "Indica el tipo de equipo." });
    if (!falla) return res.status(400).json({ message: "Describe la falla del equipo." });

    const dirRec = vacioANull(b.direccion_recoleccion, 255);
    const dirEnt = vacioANull(b.direccion_entrega, 255);
    if (ingreso === "recoleccion" && !dirRec)
      return res.status(400).json({ message: "Indica la dirección de recolección." });
    if (devolucion === "domicilio" && !dirEnt)
      return res.status(400).json({ message: "Indica la dirección de entrega." });

    if (idem) {
      const [[ex]] = await db.query("SELECT id, folio, token_salt FROM reparaciones WHERE idem_key = ?", [idem]);
      if (ex)
        return res.json({ id: ex.id, folio: ex.folio, seguimiento_token: generarToken("reparacion", ex.id, ex.token_salt), repetido: true });
    }

    const costos = await leerCostos(db);
    const costoRec = ingreso === "recoleccion" ? costos.costo_recoleccion_reparacion : 0;
    const costoEnt = devolucion === "domicilio" ? costos.costo_entrega_reparacion : 0;

    let r;
    try {
      r = await crearSolicitud({
        tabla: "reparaciones", carpeta: "reparaciones", tipo: "reparacion",
        fotosTabla: "reparacion_fotos", fotosFk: "reparacion_id",
        historialTabla: "reparacion_historial", historialFk: "reparacion_id",
        estadoInicial: "recibida", nota: "Solicitud creada desde la web",
        columnas: [
          "cliente_nombre", "cliente_telefono", "cliente_correo", "tipo_equipo", "marca", "modelo", "numero_serie",
          "falla", "ingreso_modo", "devolucion_modo",
          "direccion_recoleccion", "referencia_recoleccion", "horario_recoleccion",
          "direccion_entrega", "referencia_entrega", "horario_entrega",
          "costo_recoleccion", "costo_entrega",
        ],
        valores: [
          nombre, telefono, correo, tipo_equipo, vacioANull(b.marca, 80), vacioANull(b.modelo, 120), vacioANull(b.numero_serie, 120),
          falla, ingreso, devolucion,
          ingreso === "recoleccion" ? dirRec : null, ingreso === "recoleccion" ? vacioANull(b.referencia_recoleccion, 255) : null,
          ingreso === "recoleccion" ? vacioANull(b.horario_recoleccion, 120) : null,
          devolucion === "domicilio" ? dirEnt : null, devolucion === "domicilio" ? vacioANull(b.referencia_entrega, 255) : null,
          devolucion === "domicilio" ? vacioANull(b.horario_entrega, 120) : null,
          costoRec, costoEnt,
        ],
        idem, files: req.files || [],
      });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY" && idem) {
        const [[ex]] = await db.query("SELECT id, folio, token_salt FROM reparaciones WHERE idem_key = ?", [idem]);
        if (ex) return res.json({ id: ex.id, folio: ex.folio, seguimiento_token: generarToken("reparacion", ex.id, ex.token_salt), repetido: true });
      }
      if (/imagen|Máximo|supera/i.test(e.message || "")) return res.status(400).json({ message: e.message });
      throw e;
    }

    emitirSeguro("reparacion", { id: r.id, folio: r.folio, cliente_nombre: nombre });
    return res.json({
      id: r.id,
      folio: r.folio,
      fotos: r.fotos,
      costo_recoleccion: costoRec,
      costo_entrega: costoEnt,
      seguimiento_token: generarToken("reparacion", r.id, r.salt),
    });
  } catch (error) {
    console.error("❌ POST /public/reparaciones:", error);
    return res.status(500).json({ message: "No se pudo registrar la solicitud." });
  }
});

/* =====================================================
   POST /api/public/soporte   (multipart: campos + fotos[])
===================================================== */
router.post("/soporte", limitePost, recibirFotos, async (req, res) => {
  try {
    const b = req.body || {};
    const nombre = s(b.cliente_nombre, 150);
    const telefono = vacioANull(b.cliente_telefono, 40);
    const correo = vacioANull(b.cliente_correo, 150);
    const descripcion = s(b.descripcion, 3000);
    const modalidad = ["remoto", "tienda", "domicilio"].includes(s(b.modalidad)) ? s(b.modalidad) : "remoto";
    const direccion = vacioANull(b.direccion, 255);
    const idem = idemValida(b.idempotency_key);

    if (!nombre) return res.status(400).json({ message: "El nombre es obligatorio." });
    if (!telefono && !correo) return res.status(400).json({ message: "Indica un teléfono/WhatsApp o un correo." });
    if (!correoValido(correo)) return res.status(400).json({ message: "Correo inválido." });
    if (!descripcion) return res.status(400).json({ message: "Describe el problema." });
    if (modalidad === "domicilio" && !direccion)
      return res.status(400).json({ message: "Indica la dirección de la visita." });

    const buscarPrevio = async () => {
      if (!idem) return null;
      const [[ex]] = await db.query("SELECT id, folio, token_salt FROM soporte_tickets WHERE idem_key = ?", [idem]);
      return ex ? { id: ex.id, folio: ex.folio, seguimiento_token: generarToken("soporte", ex.id, ex.token_salt), repetido: true } : null;
    };
    const previo = await buscarPrevio();
    if (previo) return res.json(previo);

    const costos = await leerCostos(db);
    const costoVisita = modalidad === "domicilio" ? costos.costo_visita_soporte : 0;

    let r;
    try {
      r = await crearSolicitud({
        tabla: "soporte_tickets", carpeta: "soporte", tipo: "soporte",
        fotosTabla: "soporte_fotos", fotosFk: "ticket_id",
        historialTabla: "soporte_historial", historialFk: "ticket_id",
        estadoInicial: "recibido", nota: "Ticket creado desde la web",
        columnas: [
          "cliente_nombre", "cliente_telefono", "cliente_correo", "tipo_problema", "descripcion",
          "modalidad", "disponibilidad", "direccion", "referencia", "costo_visita",
        ],
        valores: [
          nombre, telefono, correo, vacioANull(b.tipo_problema, 80), descripcion, modalidad,
          vacioANull(b.disponibilidad, 255),
          modalidad === "domicilio" ? direccion : null,
          modalidad === "domicilio" ? vacioANull(b.referencia, 255) : null,
          costoVisita,
        ],
        idem, files: req.files || [],
      });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY" && idem) {
        const dup = await buscarPrevio();
        if (dup) return res.json(dup);
      }
      if (/imagen|Máximo|supera/i.test(e.message || "")) return res.status(400).json({ message: e.message });
      throw e;
    }

    emitirSeguro("soporte", { id: r.id, folio: r.folio, cliente_nombre: nombre });
    return res.json({
      id: r.id,
      folio: r.folio,
      fotos: r.fotos,
      costo_visita: costoVisita, // null => visita por cotizar
      seguimiento_token: generarToken("soporte", r.id, r.salt),
    });
  } catch (error) {
    console.error("❌ POST /public/soporte:", error);
    return res.status(500).json({ message: "No se pudo registrar el ticket." });
  }
});

/* =====================================================
   SEGUIMIENTO (solo con enlace/token firmado)
===================================================== */
const TABLAS = {
  pedido: { tabla: "pedidos_web" },
  reparacion: { tabla: "reparaciones" },
  soporte: { tabla: "soporte_tickets" },
};

// Devuelve el registro SOLO si el token es auténtico. Cualquier fallo => 404 genérico.
async function resolverToken(token) {
  const t = parsearToken(token);
  if (!t) return null;
  const [[row]] = await db.query(`SELECT * FROM ${TABLAS[t.tipo].tabla} WHERE id = ? LIMIT 1`, [t.id]);
  if (!row || !verificarToken(t.tipo, t.id, row.token_salt, t.firma)) return null;
  return { tipo: t.tipo, row };
}

router.get("/seguimiento/:token", limiteConsulta, async (req, res) => {
  try {
    const hit = await resolverToken(req.params.token);
    if (!hit) return res.status(404).json({ message: "Enlace de seguimiento no válido." });
    const { tipo, row } = hit;

    if (tipo === "pedido") {
      const [items] = await db.query(
        "SELECT nombre, cantidad, precio_unitario, subtotal FROM pedido_web_items WHERE pedido_id = ? ORDER BY id",
        [row.id],
      );
      const [hist] = await db.query(
        "SELECT estado_nuevo AS estado, creado_en FROM pedido_web_historial WHERE pedido_id = ? AND (estado_anterior IS NULL OR estado_anterior <> estado_nuevo) ORDER BY id",
        [row.id],
      );
      return res.json({
        tipo, folio: row.folio, estado: row.estado, estado_pago: row.estado_pago, metodo_pago: row.metodo_pago,
        entrega: row.entrega, direccion: row.cliente_direccion, referencia: row.referencia_entrega,
        total: Number(row.total_aprox), costo_envio: row.costo_envio === null ? null : Number(row.costo_envio),
        envio_cotizar: !!row.envio_cotizar, creado_en: row.creado_en, items, historial: hist,
      });
    }

    if (tipo === "reparacion") {
      const [fotos] = await db.query("SELECT id FROM reparacion_fotos WHERE reparacion_id = ? ORDER BY id", [row.id]);
      const [hist] = await db.query(
        "SELECT estado_nuevo AS estado, creado_en FROM reparacion_historial WHERE reparacion_id = ? AND (estado_anterior IS NULL OR estado_anterior <> estado_nuevo) ORDER BY id",
        [row.id],
      );
      const [coment] = await db.query(
        "SELECT texto, creado_en FROM reparacion_comentarios WHERE reparacion_id = ? AND visibilidad = 'cliente' ORDER BY id",
        [row.id],
      );
      const cotizacionVisible = ["enviada", "aprobada", "rechazada"].includes(row.cotizacion_estado);
      let cotizacion = null;
      if (cotizacionVisible) {
        const [items] = await db.query(
          "SELECT tipo, descripcion, cantidad, precio_unitario, subtotal FROM reparacion_items WHERE reparacion_id = ? ORDER BY id",
          [row.id],
        );
        cotizacion = {
          estado: row.cotizacion_estado, total: Number(row.cotizacion_total),
          diagnostico: row.diagnostico, items,
        };
      }
      return res.json({
        tipo, folio: row.folio, estado: row.estado,
        equipo: { tipo: row.tipo_equipo, marca: row.marca, modelo: row.modelo },
        falla: row.falla, ingreso_modo: row.ingreso_modo, devolucion_modo: row.devolucion_modo,
        direccion_recoleccion: row.direccion_recoleccion, horario_recoleccion: row.horario_recoleccion,
        direccion_entrega: row.direccion_entrega, horario_entrega: row.horario_entrega,
        costo_recoleccion: row.costo_recoleccion === null ? null : Number(row.costo_recoleccion),
        costo_entrega: row.costo_entrega === null ? null : Number(row.costo_entrega),
        creado_en: row.creado_en, fotos: fotos.map((f) => f.id), historial: hist, mensajes: coment, cotizacion,
      });
    }

    // soporte
    const [fotos] = await db.query("SELECT id FROM soporte_fotos WHERE ticket_id = ? ORDER BY id", [row.id]);
    const [hist] = await db.query(
      "SELECT estado_nuevo AS estado, creado_en FROM soporte_historial WHERE ticket_id = ? AND (estado_anterior IS NULL OR estado_anterior <> estado_nuevo) ORDER BY id",
      [row.id],
    );
    const [coment] = await db.query(
      "SELECT texto, creado_en FROM soporte_comentarios WHERE ticket_id = ? AND visibilidad = 'cliente' ORDER BY id",
      [row.id],
    );
    return res.json({
      tipo, folio: row.folio, estado: row.estado, modalidad: row.modalidad,
      descripcion: row.descripcion, direccion: row.direccion, disponibilidad: row.disponibilidad,
      costo_visita: row.costo_visita === null ? null : Number(row.costo_visita),
      fecha_programada: row.fecha_programada, solucion: ["resuelto", "cerrado"].includes(row.estado) ? row.solucion : null,
      creado_en: row.creado_en, fotos: fotos.map((f) => f.id), historial: hist, mensajes: coment,
    });
  } catch (error) {
    console.error("❌ GET /public/seguimiento:", error);
    return res.status(500).json({ message: "No se pudo consultar el seguimiento." });
  }
});

// Foto propia de la solicitud (misma verificación de token)
router.get("/seguimiento/:token/fotos/:fotoId", limiteConsulta, async (req, res) => {
  try {
    const hit = await resolverToken(req.params.token);
    const fotoId = Number(req.params.fotoId);
    if (!hit || hit.tipo === "pedido" || !Number.isInteger(fotoId)) return res.status(404).json({ message: "No encontrado" });
    const esRep = hit.tipo === "reparacion";
    const [[foto]] = await db.query(
      `SELECT archivo, mime FROM ${esRep ? "reparacion_fotos" : "soporte_fotos"} WHERE id = ? AND ${esRep ? "reparacion_id" : "ticket_id"} = ?`,
      [fotoId, hit.row.id],
    );
    if (!foto) return res.status(404).json({ message: "No encontrado" });
    return enviarFoto(res, esRep ? "reparaciones" : "soporte", hit.row.id, foto);
  } catch (error) {
    console.error("❌ GET /public/seguimiento/fotos:", error);
    return res.status(500).json({ message: "Error al obtener la imagen" });
  }
});

module.exports = router;
module.exports.limpiarCarpeta = limpiarCarpeta;
