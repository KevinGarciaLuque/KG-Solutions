// src/api/axios.js
import axios from "axios";

/* =====================================================
   BASE URL
   - Producción (Railway): VITE_API_URL
   - Local fallback
===================================================== */
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

/* =====================================================
   Instancia axios
===================================================== */
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15000, // ⏱️ evita cuelgues silenciosos
});

/* =====================================================
   Helper: obtener token limpio
===================================================== */
const getToken = () => {
  const raw = localStorage.getItem("token");
  if (!raw) return null;

  // Quita comillas si se guardó como string JSON
  const cleaned = raw.replace(/^"+|"+$/g, "").trim();

  // Evita "Bearer Bearer xxx"
  if (cleaned.toLowerCase().startsWith("bearer ")) {
    return cleaned.slice(7).trim();
  }

  return cleaned;
};

/* =====================================================
   REQUEST INTERCEPTOR
   - Adjunta JWT automáticamente
===================================================== */
api.interceptors.request.use(
  (config) => {
    const token = getToken();

    config.headers = config.headers || {};

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      delete config.headers.Authorization;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

/* =====================================================
   RESPONSE INTERCEPTOR
   - Manejo global de errores
   ✅ IMPORTANTE: NO convertir a new Error(msg) porque
      eso elimina error.response.status (y ocupa en tus validaciones)
===================================================== */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const msg =
      error.response?.data?.message || error.message || "Error desconocido";

    // ✅ opcional: adjuntar mensaje "limpio" sin destruir el error
    error.userMessage = msg;

    if (status === 401) {
      console.error("❌ 401 No autenticado:", msg);
    } else if (status === 403) {
      console.error("⛔ 403 Acceso denegado:", msg);
    } else {
      console.error("❌ Error de API:", msg);
    }

    // ✅ devolver el error original de axios (con response/status)
    return Promise.reject(error);
  },
);

export default api;
