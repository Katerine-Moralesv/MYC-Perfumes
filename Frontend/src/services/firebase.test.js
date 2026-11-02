import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configuracionCompleta,
  crearConfiguracionFirebase,
  escucharMensajesForeground,
  obtenerMessaging,
  obtenerTokenFCM,
  obtenerUrlServiceWorker,
} from "./firebase.js";

// Clave pública ficticia con estructura VAPID válida:
// Base64 URL-safe, 65 bytes y primer byte 0x04.
const VAPID_PUBLICA_VALIDA =
  "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

const entorno = {
  VITE_FIREBASE_API_KEY: "api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "myc.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "myc-perfumes",
  VITE_FIREBASE_STORAGE_BUCKET: "myc.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123456",
  VITE_FIREBASE_APP_ID: "1:123456:web:abc",
};

test("construye la configuración pública de Firebase", () => {
  const config = crearConfiguracionFirebase(entorno);

  assert.deepEqual(config, {
    apiKey: "api-key",
    authDomain: "myc.firebaseapp.com",
    projectId: "myc-perfumes",
    storageBucket: "myc.appspot.com",
    messagingSenderId: "123456",
    appId: "1:123456:web:abc",
  });
  assert.equal(configuracionCompleta(config), true);
  assert.equal(
    configuracionCompleta({ ...config, appId: "" }),
    false,
  );
});

test("el Service Worker recibe la configuración sin secretos", () => {
  const config = crearConfiguracionFirebase(entorno);
  const url = obtenerUrlServiceWorker(config);
  const analizada = new URL(url, "https://myc.example");

  assert.equal(
    analizada.pathname,
    "/firebase-messaging-sw.js",
  );
  assert.deepEqual(
    JSON.parse(analizada.searchParams.get("config")),
    config,
  );
});

test("un navegador no compatible no inicializa messaging", async () => {
  const messaging = await obtenerMessaging({
    app: { name: "app" },
    soporte: async () => false,
  });

  assert.equal(messaging, null);
});

test("inicializa messaging cuando el navegador es compatible", async () => {
  const app = { name: "app" };
  const instancia = { app };

  const messaging = await obtenerMessaging({
    app,
    soporte: async () => true,
    crearMessaging: (valor) => {
      assert.equal(valor, app);
      return instancia;
    },
  });

  assert.equal(messaging, instancia);
});

test("obtiene el token usando el Service Worker registrado", async () => {
  const registration = { scope: "/" };
  const messaging = { app: "app" };
  let solicitud = null;

  const token = await obtenerTokenFCM({
    vapidKey: VAPID_PUBLICA_VALIDA,
    navigatorRef: { serviceWorker: {} },
    messaging,
    registrarServiceWorker: async () => registration,
    solicitarToken: async (instancia, opciones) => {
      solicitud = { instancia, opciones };
      return "token-fcm";
    },
  });

  assert.equal(token, "token-fcm");
  assert.equal(solicitud.instancia, messaging);
  assert.equal(
    solicitud.opciones.vapidKey,
    VAPID_PUBLICA_VALIDA,
  );
  assert.equal(
    solicitud.opciones.serviceWorkerRegistration,
    registration,
  );
});

test("exige la clave VAPID y un navegador con Service Worker", async () => {
  await assert.rejects(
    obtenerTokenFCM({
      vapidKey: "",
      navigatorRef: { serviceWorker: {} },
    }),
    /VAPID/,
  );

  await assert.rejects(
    obtenerTokenFCM({
      vapidKey: VAPID_PUBLICA_VALIDA,
      navigatorRef: {},
    }),
    /Service Workers/,
  );
});

test("sin messaging no registra un manejador de primer plano", async () => {
  const desuscribir = await escucharMensajesForeground(() => {});

  assert.equal(typeof desuscribir, "function");
  assert.equal(desuscribir(), undefined);
});
