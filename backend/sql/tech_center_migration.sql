-- =====================================================
-- KG Solutions: tienda tecnológica + reparaciones + soporte técnico
-- Migración ADITIVA (no borra ni modifica datos existentes).
-- Ejecutar SOLO en desarrollo primero:  node sql/run_tech_center.js
-- (el runner se niega a correr contra una BD remota sin --allow-remote)
-- Cada sentencia termina con ";" al final de línea. No uses ";" dentro de textos.
-- =====================================================

-- 1) Productos: datos técnicos + stock reservado por pedidos web confirmados
ALTER TABLE productos ADD COLUMN modelo VARCHAR(120) NULL;
ALTER TABLE productos ADD COLUMN especificaciones TEXT NULL;
ALTER TABLE productos ADD COLUMN garantia VARCHAR(120) NULL;
ALTER TABLE productos ADD COLUMN stock_reservado INT NOT NULL DEFAULT 0;

-- 2) Pedidos web: folio, seguimiento seguro, entrega, pago y reserva
ALTER TABLE pedidos_web ADD COLUMN folio VARCHAR(24) NULL;
ALTER TABLE pedidos_web ADD COLUMN token_salt CHAR(32) NULL;
ALTER TABLE pedidos_web ADD COLUMN idem_key VARCHAR(64) NULL;
ALTER TABLE pedidos_web ADD COLUMN cliente_correo VARCHAR(150) NULL;
ALTER TABLE pedidos_web ADD COLUMN referencia_entrega VARCHAR(255) NULL;
ALTER TABLE pedidos_web ADD COLUMN costo_envio DECIMAL(10,2) NULL;
ALTER TABLE pedidos_web ADD COLUMN envio_cotizar TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE pedidos_web ADD COLUMN metodo_pago VARCHAR(30) NULL;
ALTER TABLE pedidos_web ADD COLUMN estado_pago ENUM('pendiente','confirmado') NOT NULL DEFAULT 'pendiente';
ALTER TABLE pedidos_web ADD COLUMN pago_confirmado_por INT NULL;
ALTER TABLE pedidos_web ADD COLUMN pago_confirmado_en DATETIME NULL;
ALTER TABLE pedidos_web ADD COLUMN reserva_activa TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE pedidos_web ADD COLUMN notas_internas TEXT NULL;
ALTER TABLE pedidos_web ADD UNIQUE KEY uq_pedidos_web_folio (folio);
ALTER TABLE pedidos_web ADD UNIQUE KEY uq_pedidos_web_idem (idem_key);

UPDATE pedidos_web SET folio = CONCAT('PW-', YEAR(creado_en), '-', LPAD(id, 6, '0')) WHERE folio IS NULL;
UPDATE pedidos_web SET token_salt = MD5(CONCAT(RAND(), id, NOW(6))) WHERE token_salt IS NULL;

CREATE TABLE IF NOT EXISTS pedido_web_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  estado_anterior VARCHAR(30) NULL,
  estado_nuevo VARCHAR(30) NOT NULL,
  nota VARCHAR(255) NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pwh_pedido (pedido_id),
  CONSTRAINT fk_pwh_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_web(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Reparaciones
CREATE TABLE IF NOT EXISTS reparaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(24) NULL,
  token_salt CHAR(32) NOT NULL,
  idem_key VARCHAR(64) NULL,
  cliente_nombre VARCHAR(150) NOT NULL,
  cliente_telefono VARCHAR(40) NULL,
  cliente_correo VARCHAR(150) NULL,
  tipo_equipo VARCHAR(80) NOT NULL,
  marca VARCHAR(80) NULL,
  modelo VARCHAR(120) NULL,
  numero_serie VARCHAR(120) NULL,
  falla TEXT NOT NULL,
  ingreso_modo ENUM('tienda','recoleccion') NOT NULL DEFAULT 'tienda',
  devolucion_modo ENUM('tienda','domicilio') NOT NULL DEFAULT 'tienda',
  direccion_recoleccion VARCHAR(255) NULL,
  referencia_recoleccion VARCHAR(255) NULL,
  horario_recoleccion VARCHAR(120) NULL,
  direccion_entrega VARCHAR(255) NULL,
  referencia_entrega VARCHAR(255) NULL,
  horario_entrega VARCHAR(120) NULL,
  costo_recoleccion DECIMAL(10,2) NULL,
  costo_entrega DECIMAL(10,2) NULL,
  traslado_ingreso_coordinado TINYINT(1) NOT NULL DEFAULT 0,
  traslado_devolucion_coordinado TINYINT(1) NOT NULL DEFAULT 0,
  estado ENUM('recibida','pendiente_ingreso','equipo_recibido','en_diagnostico',
              'cotizacion_enviada','aprobada','cotizacion_rechazada','en_reparacion',
              'lista_entrega','entregada','cancelada') NOT NULL DEFAULT 'recibida',
  tecnico_id INT NULL,
  fecha_recepcion DATETIME NULL,
  recibido_por INT NULL,
  condicion_recepcion TEXT NULL,
  diagnostico TEXT NULL,
  cotizacion_estado ENUM('ninguna','borrador','enviada','aprobada','rechazada') NOT NULL DEFAULT 'ninguna',
  cotizacion_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  cotizacion_enviada_en DATETIME NULL,
  cotizacion_resuelta_en DATETIME NULL,
  cotizacion_resuelta_por INT NULL,
  cotizacion_resuelta_medio VARCHAR(60) NULL,
  cotizacion_resuelta_nota VARCHAR(255) NULL,
  entregada_en DATETIME NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reparaciones_folio (folio),
  UNIQUE KEY uq_reparaciones_idem (idem_key),
  INDEX idx_reparaciones_estado (estado),
  INDEX idx_reparaciones_creado (creado_en),
  INDEX idx_reparaciones_tecnico (tecnico_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reparacion_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reparacion_id INT NOT NULL,
  tipo ENUM('mano_obra','repuesto','traslado') NOT NULL,
  producto_id INT NULL,
  descripcion VARCHAR(200) NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  consumido TINYINT(1) NOT NULL DEFAULT 0,
  consumido_en DATETIME NULL,
  consumido_por INT NULL,
  INDEX idx_ri_reparacion (reparacion_id),
  CONSTRAINT fk_ri_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reparacion_fotos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reparacion_id INT NOT NULL,
  archivo VARCHAR(120) NOT NULL,
  mime VARCHAR(40) NOT NULL,
  tamano INT NOT NULL,
  nombre_original VARCHAR(150) NULL,
  subido_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rf_reparacion (reparacion_id),
  CONSTRAINT fk_rf_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reparacion_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reparacion_id INT NOT NULL,
  estado_anterior VARCHAR(30) NULL,
  estado_nuevo VARCHAR(30) NOT NULL,
  nota VARCHAR(255) NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rh_reparacion (reparacion_id),
  CONSTRAINT fk_rh_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reparacion_comentarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reparacion_id INT NOT NULL,
  visibilidad ENUM('cliente','interno') NOT NULL DEFAULT 'interno',
  texto TEXT NOT NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rc_reparacion (reparacion_id),
  CONSTRAINT fk_rc_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cobros de reparación registrados por el personal. La llave idem evita duplicados en reintentos.
CREATE TABLE IF NOT EXISTS reparacion_pagos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reparacion_id INT NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  metodo VARCHAR(30) NOT NULL,
  referencia VARCHAR(120) NULL,
  idem_key VARCHAR(64) NOT NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rp_idem (reparacion_id, idem_key),
  CONSTRAINT fk_rp_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Soporte técnico
CREATE TABLE IF NOT EXISTS soporte_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(24) NULL,
  token_salt CHAR(32) NOT NULL,
  idem_key VARCHAR(64) NULL,
  cliente_nombre VARCHAR(150) NOT NULL,
  cliente_telefono VARCHAR(40) NULL,
  cliente_correo VARCHAR(150) NULL,
  tipo_problema VARCHAR(80) NULL,
  descripcion TEXT NOT NULL,
  modalidad ENUM('remoto','tienda','domicilio') NOT NULL DEFAULT 'remoto',
  disponibilidad VARCHAR(255) NULL,
  direccion VARCHAR(255) NULL,
  referencia VARCHAR(255) NULL,
  costo_visita DECIMAL(10,2) NULL,
  estado ENUM('recibido','asignado','programado','en_atencion','resuelto','cerrado') NOT NULL DEFAULT 'recibido',
  responsable_id INT NULL,
  fecha_programada DATETIME NULL,
  solucion TEXT NULL,
  reparacion_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_soporte_folio (folio),
  UNIQUE KEY uq_soporte_idem (idem_key),
  INDEX idx_soporte_estado (estado),
  INDEX idx_soporte_creado (creado_en),
  CONSTRAINT fk_soporte_reparacion FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS soporte_fotos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  archivo VARCHAR(120) NOT NULL,
  mime VARCHAR(40) NOT NULL,
  tamano INT NOT NULL,
  nombre_original VARCHAR(150) NULL,
  subido_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sf_ticket (ticket_id),
  CONSTRAINT fk_sf_ticket FOREIGN KEY (ticket_id) REFERENCES soporte_tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS soporte_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  estado_anterior VARCHAR(30) NULL,
  estado_nuevo VARCHAR(30) NOT NULL,
  nota VARCHAR(255) NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sh_ticket (ticket_id),
  CONSTRAINT fk_sh_ticket FOREIGN KEY (ticket_id) REFERENCES soporte_tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS soporte_comentarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  visibilidad ENUM('cliente','interno') NOT NULL DEFAULT 'interno',
  texto TEXT NOT NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sc_ticket (ticket_id),
  CONSTRAINT fk_sc_ticket FOREIGN KEY (ticket_id) REFERENCES soporte_tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Costos configurables (vacío = "por cotizar"). Tabla ya usada por CAI.
INSERT IGNORE INTO configuracion (clave, valor) VALUES ('costo_envio_pedido', '');
INSERT IGNORE INTO configuracion (clave, valor) VALUES ('costo_recoleccion_reparacion', '');
INSERT IGNORE INTO configuracion (clave, valor) VALUES ('costo_entrega_reparacion', '');
INSERT IGNORE INTO configuracion (clave, valor) VALUES ('costo_visita_soporte', '');

-- 6) Categorías base de tecnología (solo si no existen)
INSERT INTO categorias (nombre, descripcion)
SELECT x.n, x.d FROM (
  SELECT 'Computadoras' AS n, 'Equipos de escritorio y all-in-one' AS d UNION ALL
  SELECT 'Laptops', 'Portátiles para trabajo, estudio y gaming' UNION ALL
  SELECT 'Impresoras', 'Impresoras, multifuncionales y escáneres' UNION ALL
  SELECT 'Monitores', 'Pantallas y monitores' UNION ALL
  SELECT 'Accesorios', 'Teclados, mouse, audífonos, cables y más' UNION ALL
  SELECT 'Componentes', 'Memorias, discos, procesadores, tarjetas y fuentes' UNION ALL
  SELECT 'Redes', 'Routers, switches, access points y cableado' UNION ALL
  SELECT 'Consumibles', 'Tintas, tóner, papel y limpieza'
) x
WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE c.nombre = x.n);
