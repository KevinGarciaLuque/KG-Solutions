// src/api/axios.js
import axios from "axios";
import API_BASE_URL from "../config/apiUrl";


const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    error.userMessage =
      error.response?.data?.message || error.message || "Error desconocido";
    console.error("❌ Error de API:", error.userMessage);
    return Promise.reject(error);
  },
);

export default api;
