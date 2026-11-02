import { initializeApp, getApps, getApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";

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
  return Object.values(config || {}).every(Boolean);
}

export const firebaseConfig = crearConfiguracionFirebase();

export const vapidKey = import.meta.env?.VITE_FIREBASE_VAPID_KEY || "";

export const firebaseConfigurado =
  configuracionCompleta(firebaseConfig);

let app = null;

if (firebaseConfigurado) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
}

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
    obtenerUrlServiceWorker(config),
  );
}

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

export async function obtenerTokenFCM(opciones = {}) {
  if (!opciones.vapidKey && !vapidKey) {
    throw new Error("No se encontró la clave pública VAPID.");
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
      "No fue posible inicializar Firebase Messaging.",
    );
  }

  const registrar =
    opciones.registrarServiceWorker ?? registrarServiceWorker;
  const solicitarToken = opciones.solicitarToken ?? getToken;

  const registration = await registrar(firebaseConfig);

  const token = await solicitarToken(messaging, {
    vapidKey: opciones.vapidKey || vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error(
      "Firebase no pudo generar el token del dispositivo.",
    );
  }

  return token;
}

export async function escucharMensajesForeground(handler) {
  const messaging = await obtenerMessaging();

  if (!messaging || typeof handler !== "function") {
    return () => {};
  }

  return onMessage(messaging, handler);
}

export async function revocarTokenFCM() {
  const messaging = await obtenerMessaging();

  if (!messaging) return false;

  try {
    return await deleteToken(messaging);
  } catch {
    return false;
  }
}
