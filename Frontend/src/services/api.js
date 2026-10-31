import axios from "axios";

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
} from "../auth/tokenStorage.js";

export const API_BASE_URL = (
  import.meta.env?.VITE_API_URL || "/api/v1"
).replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 15000;

const STATUS_MESSAGES = {
  400: "Revisa los datos enviados.",
  401: "Tu sesión expiró. Inicia sesión nuevamente.",
  403: "No tienes permisos para realizar esta acción.",
  404: "No encontramos el recurso solicitado.",
  429: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
};

export class ApiError extends Error {
  constructor({
    message,
    status = 0,
    fieldErrors = {},
    isNetworkError = false,
    isTimeout = false,
    isCanceled = false,
    cause,
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.isNetworkError = isNetworkError;
    this.isTimeout = isTimeout;
    this.isCanceled = isCanceled;
    this.cause = cause;
  }
}

function esEndpointDeAutenticacion(url = "") {
  return (
    url.includes("/auth/login/") ||
    url.includes("/auth/refresh/") ||
    url.includes("/usuarios/password/")
  );
}

function recogerMensajes(valor) {
  if (Array.isArray(valor)) {
    return valor.flatMap(recogerMensajes);
  }

  if (valor && typeof valor === "object") {
    return Object.values(valor).flatMap(recogerMensajes);
  }

  if (typeof valor === "string" && valor.trim()) {
    return [valor.trim()];
  }

  return [];
}

function extraerErroresCampo(datos) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    return {};
  }

  return Object.entries(datos).reduce((acumulado, [campo, valor]) => {
    if (campo === "detail") return acumulado;

    const mensajes = recogerMensajes(valor);

    if (mensajes.length) {
      acumulado[campo] = mensajes.join(" ");
    }

    return acumulado;
  }, {});
}

export function normalizeApiError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 0;
    const data = error.response?.data;
    const fieldErrors = extraerErroresCampo(data);
    const primerErrorDeCampo = Object.values(fieldErrors)[0];
    const detalle =
      typeof data?.detail === "string" && data.detail.trim()
        ? data.detail.trim()
        : "";

    if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
      return new ApiError({
        message: "Solicitud cancelada.",
        status,
        isCanceled: true,
        cause: error,
      });
    }

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new ApiError({
        message:
          "La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.",
        status,
        fieldErrors,
        isNetworkError: true,
        isTimeout: true,
        cause: error,
      });
    }

    if (!error.response) {
      return new ApiError({
        message:
          "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
        status,
        fieldErrors,
        isNetworkError: true,
        cause: error,
      });
    }

    return new ApiError({
      message:
        detalle ||
        primerErrorDeCampo ||
        STATUS_MESSAGES[status] ||
        "Ocurrió un error al procesar la solicitud.",
      status,
      fieldErrors,
      cause: error,
    });
  }

  return new ApiError({
    message:
      error?.message || "Ocurrió un error inesperado. Inténtalo de nuevo.",
    cause: error,
  });
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

let refreshPromise = null;
let authExpiredHandler = null;

export function setAuthExpiredHandler(handler) {
  authExpiredHandler = typeof handler === "function" ? handler : null;
}

function notificarSesionExpirada() {
  if (authExpiredHandler) {
    authExpiredHandler();
  }
}

async function renovarAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refresh = getRefreshToken();

  if (!refresh) {
    throw new ApiError({
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      status: 401,
    });
  }

  refreshPromise = refreshClient
    .post("/auth/refresh/", { refresh })
    .then(({ data }) => {
      if (!data?.access) {
        throw new ApiError({
          message: "No fue posible renovar la sesión.",
          status: 401,
        });
      }

      setAccessToken(data.access);
      return data.access;
    })
    .catch((error) => {
      const errorNormalizado = normalizeApiError(error);

      if (
        errorNormalizado.status === 401 ||
        errorNormalizado.status === 403
      ) {
        clearTokens();
      }

      throw errorNormalizado;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token && !esEndpointDeAutenticacion(config.url)) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    if (
      status === 401 &&
      original &&
      !original._retry &&
      !esEndpointDeAutenticacion(original.url)
    ) {
      original._retry = true;

      if (getRefreshToken()) {
        try {
          const access = await renovarAccessToken();

          original.headers = {
            ...original.headers,
            Authorization: `Bearer ${access}`,
          };

          return api(original);
        } catch (refreshError) {
          const errorNormalizado = normalizeApiError(refreshError);

          if (
            errorNormalizado.status === 401 ||
            errorNormalizado.status === 403
          ) {
            notificarSesionExpirada();
          }

          return Promise.reject(errorNormalizado);
        }
      }

      clearTokens();
      notificarSesionExpirada();
    }

    return Promise.reject(normalizeApiError(error));
  },
);
