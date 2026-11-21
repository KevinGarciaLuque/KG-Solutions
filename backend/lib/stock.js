// backend/lib/stock.js
// POLÍTICA DE STOCK (tienda web + POS comparten inventario):
//   - El pedido web nace "nuevo" y NO compromete unidades.
//   - Al CONFIRMAR el pedido desde el panel (nuevo -> en_proceso) se RESERVA:
//       productos.stock_reservado += cantidad   (solo si stock - stock_reservado >= cantidad)
//   - Al CANCELAR un pedido con reserva activa, se LIBERA (una sola vez).
//   - Al COBRAR en el POS, la reserva del pedido se libera y, en la misma
//     transacción, el POS descuenta stock (salida) -> la reserva se convierte en salida una vez.
//   - Disponible = stock - stock_reservado. Todo ocurre con SELECT ... FOR UPDATE
//     sobre las filas de productos, en orden de id (evita deadlocks), así web y POS
//     no pueden comprometer las mismas unidades.
// Todas las funciones esperan una conexión con transacción abierta.

async function lineasDePedido(conn, pedidoId) {
  const [items] = await conn.query(
    "SELECT producto_id, SUM(cantidad) AS cantidad FROM pedido_web_items WHERE pedido_id = ? AND producto_id IS NOT NULL GROUP BY producto_id ORDER BY producto_id ASC",
    [pedidoId],
  );
  return items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad) }));
}

// Reserva stock del pedido. Idempotente: si ya hay reserva activa no hace nada.
async function reservarPedido(conn, pedidoId) {
  const [[ped]] = await conn.query(
    "SELECT reserva_activa FROM pedidos_web WHERE id = ? FOR UPDATE",
    [pedidoId],
  );
  if (!ped) throw new Error("Pedido no encontrado");
  if (ped.reserva_activa) return false;

  const lineas = await lineasDePedido(conn, pedidoId);
  for (const l of lineas) {
    const [[p]] = await conn.query(
      "SELECT nombre, stock, stock_reservado, activo FROM productos WHERE id = ? FOR UPDATE",
      [l.producto_id],
    );
    if (!p || !p.activo) throw new Error(`Producto ${l.producto_id} no disponible.`);
    const disponible = Number(p.stock) - Number(p.stock_reservado);
    if (disponible < l.cantidad) {
      throw new Error(
        `Stock insuficiente para "${p.nombre}". Disponible: ${Math.max(0, disponible)}, pedido: ${l.cantidad}.`,
      );
    }
    await conn.query("UPDATE productos SET stock_reservado = stock_reservado + ? WHERE id = ?", [
      l.cantidad,
      l.producto_id,
    ]);
  }
  await conn.query("UPDATE pedidos_web SET reserva_activa = 1 WHERE id = ?", [pedidoId]);
  return true;
}

// Libera la reserva del pedido. Idempotente: solo actúa si reserva_activa = 1.
async function liberarPedido(conn, pedidoId) {
  const [[ped]] = await conn.query(
    "SELECT reserva_activa FROM pedidos_web WHERE id = ? FOR UPDATE",
    [pedidoId],
  );
  if (!ped || !ped.reserva_activa) return false;

  const lineas = await lineasDePedido(conn, pedidoId);
  for (const l of lineas) {
    await conn.query("SELECT id FROM productos WHERE id = ? FOR UPDATE", [l.producto_id]);
    await conn.query(
      "UPDATE productos SET stock_reservado = GREATEST(0, stock_reservado - ?) WHERE id = ?",
      [l.cantidad, l.producto_id],
    );
  }
  await conn.query("UPDATE pedidos_web SET reserva_activa = 0 WHERE id = ?", [pedidoId]);
  return true;
}

module.exports = { reservarPedido, liberarPedido };
