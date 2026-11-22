-- Migración: imagen de categoría (la usan la tienda y el panel).
-- Aditiva. Ejecutar una sola vez (falla con "Duplicate column" si ya existe).
ALTER TABLE categorias ADD COLUMN imagen VARCHAR(500) NULL AFTER categoria_padre_id;
