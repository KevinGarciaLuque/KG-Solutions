// URL base de la API. Limpia espacios y caracteres invisibles que a veces se
// cuelan al pegar la variable en Railway, y quita la barra final.
const raw = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

export const API_BASE_URL = String(raw)
  .replace(/[\u200B-\u200D\u2060\uFEFF\u00A0\s]/g, "")
  .replace(/\/+$/, "");

export default API_BASE_URL;
