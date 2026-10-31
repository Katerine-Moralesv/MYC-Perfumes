const ACCESS_TOKEN_KEY = "myc_access_token";
const REFRESH_TOKEN_KEY = "myc_refresh_token";
const LEGACY_PROFILE_KEY = "mycAdminProfile";

const memoria = new Map();

function obtenerAlmacenamiento() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function leer(clave) {
  if (memoria.has(clave)) {
    return memoria.get(clave) || "";
  }

  const almacenamiento = obtenerAlmacenamiento();

  if (almacenamiento) {
    try {
      const guardado = almacenamiento.getItem(clave);

      if (guardado) return guardado;
    } catch {
      // No hay almacenamiento persistente disponible.
    }
  }

  return "";
}

function escribir(clave, valor) {
  if (valor) {
    memoria.set(clave, valor);
  } else {
    memoria.delete(clave);
  }

  const almacenamiento = obtenerAlmacenamiento();

  if (!almacenamiento) return;

  try {
    if (valor) {
      almacenamiento.setItem(clave, valor);
    } else {
      almacenamiento.removeItem(clave);
    }
  } catch {
    // La sesión sigue disponible en memoria durante esta pestaña.
  }
}

export function getAccessToken() {
  return leer(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return leer(REFRESH_TOKEN_KEY);
}

export function setAccessToken(token) {
  escribir(ACCESS_TOKEN_KEY, token || "");
}

export function setTokens({ access, refresh }) {
  escribir(ACCESS_TOKEN_KEY, access || "");

  if (refresh) {
    escribir(REFRESH_TOKEN_KEY, refresh);
  }
}

export function clearTokens() {
  escribir(ACCESS_TOKEN_KEY, "");
  escribir(REFRESH_TOKEN_KEY, "");
  escribir(LEGACY_PROFILE_KEY, "");
}

export function hasStoredSession() {
  return Boolean(getAccessToken() || getRefreshToken());
}

export function getAccessTokenExpiration() {
  const token = getAccessToken();

  if (!token) return 0;

  try {
    const payload = token.split(".")[1];

    if (!payload) return 0;

    const normalizado = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const relleno = normalizado.padEnd(
      normalizado.length + ((4 - (normalizado.length % 4)) % 4),
      "=",
    );
    const datos = JSON.parse(atob(relleno));

    return Number(datos.exp) || 0;
  } catch {
    return 0;
  }
}
