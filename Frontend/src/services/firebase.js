
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";

// =========================================================
// CONFIGURACIÓN FIREBASE
// =========================================================

export function crearConfiguracionFirebase(env = import.meta.env || {}) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

export function configuracionCompleta(config) {
  return Object.values(config || {}).every(
    (valor) => typeof valor === "string" && valor.trim().length > 0
  );
}

export const firebaseConfig = crearConfiguracionFirebase();

export const vapidKey = String(
  import.meta.env?.VITE_FIREBASE_VAPID_KEY || ""
).trim();

export const firebaseConfigurado =
  configuracionCompleta(firebaseConfig);

// =========================================================
// VALIDACIÓN DE CLAVE VAPID
// =========================================================

export function validarClaveVapid(key = vapidKey) {
  const clave = String(key || "").trim();

  if (!clave) {
    return {
      valida: false,
      motivo: "No se encontró la clave pública VAPID.",
    };
  }

  // Las claves públicas VAPID usan Base64 URL-safe.
  if (!/^[A-Za-z0-9_-]+$/.test(clave)) {
    return {
      valida: false,
      motivo:
        "La clave VAPID contiene caracteres no permitidos. Comprueba que copiaste la clave pública completa.",
    };
  }

  try {
    const base64 = clave
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const base64Completo =
      base64 + "=".repeat((4 - (base64.length % 4)) % 4);

    const binario = atob(base64Completo);

    if (binario.length !== 65) {
      return {
        valida: false,
        motivo: `La clave VAPID tiene una longitud incorrecta (${binario.length} bytes). Debe tener 65 bytes.`,
      };
    }

    const primerByte = binario.charCodeAt(0);

    if (primerByte !== 4) {
      return {
        valida: false,
        motivo:
          "La clave VAPID no tiene el formato de clave pública EC esperado.",
      };
    }

    return {
      valida: true,
      motivo: "",
    };
  } catch {
    return {
      valida: false,
      motivo: "No fue posible decodificar la clave pública VAPID.",
    };
  }
}

// =========================================================
// INICIALIZACIÓN FIREBASE
// =========================================================

let app = null;

if (firebaseConfigurado) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
}

// =========================================================
// SERVICE WORKER
// =========================================================

export function obtenerUrlServiceWorker(config = firebaseConfig) {
  const parametros = new URLSearchParams();

  parametros.set("config", JSON.stringify(config));

  return `/firebase-messaging-sw.js?${parametros.toString()}`;
}

export async function registrarServiceWorker(config = firebaseConfig) {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    throw new Error("El navegador no soporta Service Workers.");
  }

  return navigator.serviceWorker.register(
    obtenerUrlServiceWorker(config)
  );
}

// =========================================================
// FIREBASE MESSAGING
// =========================================================

export async function obtenerMessaging(opciones = {}) {
  const appActual = opciones.app ?? app;

  if (!appActual) {
    return null;
  }

  const comprobarSoporte = opciones.soporte ?? isSupported;
  const crearInstancia = opciones.crearMessaging ?? getMessaging;

  try {
    const soportado = await comprobarSoporte();

    if (!soportado) {
      return null;
    }

    return crearInstancia(appActual);
  } catch {
    return null;
  }
}

// =========================================================
// OBTENER TOKEN FCM
// =========================================================

export async function obtenerTokenFCM(opciones = {}) {
  const claveVapid = String(
    opciones.vapidKey ?? vapidKey
  ).trim();

  const validacion = validarClaveVapid(claveVapid);

  if (!validacion.valida) {
    throw new Error(validacion.motivo);
  }

  const navegador =
    opciones.navigatorRef ??
    (typeof navigator !== "undefined" ? navigator : null);

  if (!navegador || !("serviceWorker" in navegador)) {
    throw new Error("El navegador no soporta Service Workers.");
  }

  const messaging =
    opciones.messaging ?? (await obtenerMessaging(opciones));

  if (!messaging) {
    throw new Error(
      "No fue posible inicializar Firebase Messaging."
    );
  }

  const registrar =
    opciones.registrarServiceWorker ?? registrarServiceWorker;

  const solicitarToken = opciones.solicitarToken ?? getToken;

  const registration = await registrar(firebaseConfig);

  if (!registration) {
    throw new Error(
      "No fue posible registrar el Service Worker de Firebase."
    );
  }

  let token;

  try {
    token = await solicitarToken(messaging, {
      vapidKey: claveVapid,
      serviceWorkerRegistration: registration,
    });
  } catch (error) {
    if (error?.name === "InvalidAccessError" ||
        error?.message?.includes("applicationServerKey")) {
      throw new Error(
        "El navegador rechazó la clave VAPID. Comprueba que Cloudflare tiene configurada la clave pública Web Push del proyecto Firebase correcto y que se desplegó la última versión."
      );
    }

    throw error;
  }

  if (!token) {
    throw new Error(
      "Firebase no pudo generar el token del dispositivo."
    );
  }

  return token;
}

// =========================================================
// MENSAJES EN PRIMER PLANO
// =========================================================

export async function escucharMensajesForeground(handler) {
  const messaging = await obtenerMessaging();

  if (!messaging || typeof handler !== "function") {
    return () => {};
  }

  return onMessage(messaging, handler);
}

// =========================================================
// REVOCAR TOKEN FCM
// =========================================================

export async function revocarTokenFCM() {
  const messaging = await obtenerMessaging();

  if (!messaging) {
    return false;
  }

  try {
    return await deleteToken(messaging);
  } catch {
    return false;
  }
}
