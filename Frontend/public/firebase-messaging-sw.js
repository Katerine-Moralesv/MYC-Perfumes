/* global firebase, clients, self */

importScripts(
  "https://www.gstatic.com/firebasejs/13.1.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/13.1.0/firebase-messaging-compat.js",
);

const CARPETA_ICONOS = "/favicon.svg";
const TIPO_MENSAJE = "MYC_PEDIDO_NOTIFICACION";

function leerConfiguracion() {
  try {
    const parametros = new URL(self.location.href).searchParams;
    const contenido = parametros.get("config") || "{}";
    const config = JSON.parse(contenido);

    if (
      config &&
      typeof config === "object" &&
      config.apiKey &&
      config.projectId &&
      config.appId &&
      config.messagingSenderId
    ) {
      return config;
    }
  } catch {
    // Se usa el manejo de push de respaldo.
  }

  return null;
}

function datosNotificacion(payload) {
  const datos = payload?.data || {};
  const notificacion = payload?.notification || {};
  const pedidoId =
    datos.pedido_id || datos.pedidoId || datos.pedido || "";

  return {
    pedidoId: String(pedidoId || ""),
    titulo: datos.titulo || notificacion.title || "Nuevo pedido",
    cuerpo:
      datos.cuerpo ||
      notificacion.body ||
      "Una clienta registró un pedido en MYC Perfumes.",
    url:
      datos.url ||
      (pedidoId ? `/?pedido=${encodeURIComponent(pedidoId)}` : "/"),
  };
}

async function mostrarNotificacion(payload) {
  const datos = datosNotificacion(payload);

  await self.registration.showNotification(datos.titulo, {
    body: datos.cuerpo,
    icon: CARPETA_ICONOS,
    badge: CARPETA_ICONOS,
    tag: datos.pedidoId
      ? `myc-pedido-${datos.pedidoId}`
      : "myc-pedido",
    data: {
      pedidoId: datos.pedidoId,
      url: datos.url,
    },
  });
}

const configuracion = leerConfiguracion();

if (configuracion) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(configuracion);
    }

    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      mostrarNotificacion(payload);
    });
  } catch {
    // Si Firebase no se inicializa, se intenta el evento push.
  }
} else {
  self.addEventListener("push", (event) => {
    if (!event.data) return;

    let payload = {};

    try {
      payload = event.data.json();
    } catch {
      payload = { notification: { body: event.data.text() } };
    }

    event.waitUntil(mostrarNotificacion(payload));
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const datos = event.notification.data || {};
  const pedidoId = String(
    datos.pedidoId || datos.pedido_id || "",
  );
  const url =
    datos.url ||
    (pedidoId
      ? `/?pedido=${encodeURIComponent(pedidoId)}`
      : "/");

  event.waitUntil(
    (async () => {
      const ventanas = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin !== self.location.origin) {
          continue;
        }

        if (pedidoId) {
          ventana.postMessage({
            type: TIPO_MENSAJE,
            pedidoId,
          });
        }

        await ventana.focus();
        return;
      }

      const urlAbsoluta = new URL(
        url,
        self.location.origin,
      ).href;

      await clients.openWindow(urlAbsoluta);
    })(),
  );
});
