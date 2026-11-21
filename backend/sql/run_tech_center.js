// Aplica sql/tech_center_migration.sql contra la BD del .env del backend.
//   cd backend && node sql/run_tech_center.js
// - Tolerante a "ya existe": se puede correr más de una vez.
// - Se NIEGA a correr contra una BD remota (p. ej. Railway) salvo --allow-remote,
//   para evitar tocar producción por accidente.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const host = String(process.env.DB_HOST || "127.0.0.1").toLowerCase();
const esLocal = ["127.0.0.1", "localhost", "::1"].includes(host);
if (!esLocal && !process.argv.includes("--allow-remote")) {
  console.error(
    `⛔ DB_HOST=${host} no es local. Esta migración no se aplica a una BD remota sin --allow-remote.\n` +
      "   Apunta backend/.env a una BD de desarrollo (local) y vuelve a ejecutar.",
  );
  process.exit(2);
}

const db = require("../db");

const IGNORAR = new Set([
  "ER_DUP_FIELDNAME",
  "ER_DUP_KEYNAME",
  "ER_TABLE_EXISTS_ERROR",
  "ER_FK_DUP_NAME",
  "ER_DUP_ENTRY",
]);

const sqlText = fs.readFileSync(path.join(__dirname, "tech_center_migration.sql"), "utf8");
const stmts = sqlText
  .split(/;\s*\r?\n/)
  .map((chunk) =>
    chunk
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

(async () => {
  console.log(`BD destino: ${process.env.DB_NAME} @ ${host}`);
  for (const sql of stmts) {
    const label = sql.replace(/\s+/g, " ").slice(0, 70);
    try {
      await db.query(sql);
      console.log("OK    ", label);
    } catch (e) {
      if (IGNORAR.has(e.code) || e.errno === 1826) {
        console.log("existe", label, `(${e.code})`);
      } else {
        console.error("FALLO ", label, "\n      ", e.code, e.sqlMessage);
        process.exit(1);
      }
    }
  }
  console.log("\n✅ Migración KG Solutions (tech center) aplicada.");
  process.exit(0);
})();
