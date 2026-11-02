import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { api } from "./api.js";
import {
  CLAVE_PEDIDO_PENDIENTE,
  CLAVE_TOKEN_FCM,
  TIPO_MENSAJE_SW,
  borrarPedidoPendiente,
  borrarTokenLocal,
  cerrarNotificaciones,
  crearManejadorMensajeForeground,
  desactivarDispositivo,
  evaluarSoporteNavegador,
  extraerPedidoDeMensaje,
  guardarPedidoPendiente,
  guardarTokenLocal,
  leerPedidoDeMensajeSW,
  leerPedidoDesdeUrl,
  leerPedidoPendiente,
  leerTokenLocal,
  limpiarPedidoDeUrl,
  obtenerPedidoPendienteInicial,
  registrarDispositivo,
  resolverPedidoPendiente,
  solicitarPermisoNotificaciones,
} from "./notificaciones.js";

const postOriginal = api.post;

function crearStorageMock() {
  const datos = new Map();

  return {
    getItem(clave) {
      return datos.has(clave) ? datos.get(clave) : null;
    },
    setItem(clave, valor) {
      datos.set(clave, String(valor));
    },
    removeItem(clave) {
      datos.delete(clave);
    },
  };
}

beforeEach(() => {
  api.post = postOriginal;
});

afterEach(() => {
  api.post = postOriginal;
});

test("detecta un navegador sin Service Worker o sin push", () => {
  const sinServiceWorker = evaluarSoporteNavegador({
    windowRef: { PushManager: function PushManager() {} },
    navigatorRef: {},
    NotificationRef: {
      requestPermission: async () => "granted",
    },
  });

  assert.equal(sinServiceWorker.soportado, false);
  assert.match(sinServiceWorker.motivo, /Service Workers/);

  const sinPush = evaluarSoporteNavegador({
    windowRef: {},
    navigatorRef: { serviceWorker: {} },
    NotificationRef: {
      requestPermission: async () => "granted",
    },
  });

  assert.equal(sinPush.soportado, false);
  assert.match(sinPush.motivo, /push/);
});

test("detecta un navegador compatible", () => {
  const soporte = evaluarSoporteNavegador({
    windowRef: { PushManager: function PushManager() {} },
    navigatorRef: { serviceWorker: {} },
    NotificationRef: {
      requestPermission: async () => "granted",
    },
  });

  assert.deepEqual(soporte, { soportado: true, motivo: "" });
});

test("rechaza el permiso denegado sin romper la aplicación", async () => {
  await assert.rejects(
    solicitarPermisoNotificaciones({
      requestPermission: async () => "denied",
    }),
    /denegado/,
  );
});

test("informa cuando el permiso no se concede", async () => {
  await assert.rejects(
    solicitarPermisoNotificaciones({
      requestPermission: async () => "default",
    }),
    /No se concedió/,
  );

  await assert.rejects(
    solicitarPermisoNotificaciones(null),
    /no permite/,
  );
});

test("acepta el permiso concedido", async () => {
  const permiso = await solicitarPermisoNotificaciones({
    requestPermission: async () => "granted",
  });

  assert.equal(permiso, "granted");
});

test("registra el token con la instancia Axios compartida", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return { data: { id: 1, activo: true } };
  };

  const dispositivo = await registrarDispositivo(
    "  token-fcm  ",
    "web",
  );

  assert.deepEqual(solicitud, {
    url: "/notificaciones/dispositivos/",
    body: {
      token: "token-fcm",
      plataforma: "web",
    },
  });
  assert.equal(dispositivo.id, 1);
});

test("rechaza tokens vacíos antes de llamar a la API", async () => {
  let llamadas = 0;

  api.post = async () => {
    llamadas += 1;
    return { data: {} };
  };

  await assert.rejects(
    registrarDispositivo("   "),
    /no es válido/,
  );
  assert.equal(llamadas, 0);
});

test("desactiva el token usando la API compartida", async () => {
  let solicitud = null;

  api.post = async (url, body) => {
    solicitud = { url, body };
    return { data: { desactivado: true } };
  };

  const resultado = await desactivarDispositivo("token-fcm");

  assert.deepEqual(solicitud, {
    url: "/notificaciones/dispositivos/desactivar/",
    body: { token: "token-fcm" },
  });
  assert.equal(resultado.desactivado, true);
});

test("desactiva con el access token capturado antes del logout", async () => {
  let solicitud = null;

  api.post = async (url, body, config) => {
    solicitud = { url, body, config };
    return { data: { desactivado: true } };
  };

  await desactivarDispositivo("token-fcm", {
    accessToken: "jwt-vigente",
  });

  assert.equal(
    solicitud.url,
    "/notificaciones/dispositivos/desactivar/",
  );
  assert.deepEqual(solicitud.body, { token: "token-fcm" });
  assert.deepEqual(solicitud.config, {
    headers: { Authorization: "Bearer jwt-vigente" },
  });
});

test("la desactivación de logout no intenta renovar la sesión", async () => {
  let configuracion = null;

  api.post = async (url, body, config) => {
    configuracion = config;
    return { data: { desactivado: true } };
  };

  await desactivarDispositivo("token-fcm", {
    accessToken: "jwt-vigente",
    skipAuthRefresh: true,
  });

  assert.equal(configuracion.skipAuthRefresh, true);
  assert.equal(
    configuracion.headers.Authorization,
    "Bearer jwt-vigente",
  );
});

test("guarda, lee y elimina el token local sin tocar los JWT", () => {
  const storage = crearStorageMock();

  assert.equal(guardarTokenLocal("token-fcm", storage), true);
  assert.equal(leerTokenLocal(storage), "token-fcm");
  assert.equal(storage.getItem(CLAVE_TOKEN_FCM), "token-fcm");
  assert.equal(borrarTokenLocal(storage), true);
  assert.equal(leerTokenLocal(storage), "");
});

test("extrae el pedido de un mensaje en primer plano", () => {
  const pedido = extraerPedidoDeMensaje({
    data: {
      pedido_id: "42",
      titulo: "Nuevo pedido #42",
      cuerpo: "Laura registró un pedido.",
    },
  });

  assert.deepEqual(pedido, {
    pedidoId: 42,
    titulo: "Nuevo pedido #42",
    cuerpo: "Laura registró un pedido.",
  });

  assert.equal(
    extraerPedidoDeMensaje({ data: { pedido_id: "abc" } }),
    null,
  );
});

test("el manejador de primer plano muestra el aviso", () => {
  let aviso = null;
  const manejar = crearManejadorMensajeForeground((pedido) => {
    aviso = pedido;
  });

  const pedido = manejar({
    data: { pedido_id: "7", titulo: "Nuevo pedido #7" },
  });

  assert.equal(pedido.pedidoId, 7);
  assert.equal(aviso.pedidoId, 7);
});

test("lee el mensaje del Service Worker y descarta ruido", () => {
  assert.equal(
    leerPedidoDeMensajeSW(
      JSON.stringify({ type: TIPO_MENSAJE_SW, pedidoId: "15" }),
    ),
    15,
  );
  assert.equal(
    leerPedidoDeMensajeSW({
      type: TIPO_MENSAJE_SW,
      pedidoId: 16,
    }),
    16,
  );
  assert.equal(
    leerPedidoDeMensajeSW({
      type: "OTRO",
      pedidoId: 16,
    }),
    null,
  );
  assert.equal(leerPedidoDeMensajeSW("no-json"), null);
});

test("persiste el pedido pendiente en sessionStorage y sobrevive a una recarga", () => {
  const storage = crearStorageMock();

  assert.equal(guardarPedidoPendiente(44, storage), true);
  assert.equal(
    storage.getItem(CLAVE_PEDIDO_PENDIENTE),
    "44",
  );
  assert.equal(leerPedidoPendiente(storage), 44);

  const recargado = crearStorageMock();
  recargado.setItem(
    CLAVE_PEDIDO_PENDIENTE,
    storage.getItem(CLAVE_PEDIDO_PENDIENTE),
  );

  assert.equal(leerPedidoPendiente(recargado), 44);
  assert.equal(borrarPedidoPendiente(recargado), true);
  assert.equal(leerPedidoPendiente(recargado), null);
});

test("recupera el pedido desde la URL y lo persiste para el login", () => {
  const storage = crearStorageMock();
  const locationRef = {
    href: "https://myc.example/?pedido=55",
  };

  assert.equal(
    obtenerPedidoPendienteInicial({ locationRef, storage }),
    55,
  );
  assert.equal(leerPedidoPendiente(storage), 55);
});

test("decide abrir el pedido pendiente solo al autenticarse", () => {
  assert.deepEqual(
    resolverPedidoPendiente({
      pedidoPendiente: 21,
      isAuthenticated: true,
      status: "authenticated",
    }),
    { accion: "abrir", pedidoId: 21 },
  );

  assert.deepEqual(
    resolverPedidoPendiente({
      pedidoPendiente: 21,
      isAuthenticated: false,
      status: "anonymous",
    }),
    { accion: "login", pedidoId: 21 },
  );

  assert.deepEqual(
    resolverPedidoPendiente({
      pedidoPendiente: 21,
      isAuthenticated: false,
      status: "loading",
    }),
    { accion: "esperar", pedidoId: 21 },
  );
});

test("el logout desactiva, revoca y limpia solo el token FCM", async () => {
  const storage = crearStorageMock();
  const llamadas = {
    desactivar: null,
    revocar: 0,
  };

  storage.setItem(CLAVE_TOKEN_FCM, "token-fcm");
  storage.setItem("myc_access_token", "jwt-access");
  storage.setItem("myc_refresh_token", "jwt-refresh");

  const resultado = await cerrarNotificaciones({
    storage,
    accessToken: "jwt-access",
    desactivar: async (token, opciones) => {
      llamadas.desactivar = { token, opciones };
    },
    revocar: async () => {
      llamadas.revocar += 1;
    },
  });

  assert.deepEqual(llamadas.desactivar, {
    token: "token-fcm",
    opciones: {
      accessToken: "jwt-access",
      skipAuthRefresh: true,
    },
  });
  assert.equal(llamadas.revocar, 1);
  assert.deepEqual(resultado, {
    desactivado: true,
    token: "token-fcm",
  });
  assert.equal(leerTokenLocal(storage), "");
  assert.equal(
    storage.getItem("myc_access_token"),
    "jwt-access",
  );
  assert.equal(
    storage.getItem("myc_refresh_token"),
    "jwt-refresh",
  );
});

test("el logout termina si falla el backend", async () => {
  const storage = crearStorageMock();
  let revocado = 0;

  storage.setItem(CLAVE_TOKEN_FCM, "token-fcm");

  await cerrarNotificaciones({
    storage,
    desactivar: async () => {
      throw new Error("backend caído");
    },
    revocar: async () => {
      revocado += 1;
    },
  });

  assert.equal(revocado, 1);
  assert.equal(leerTokenLocal(storage), "");
});

test("el logout termina si falla Firebase", async () => {
  const storage = crearStorageMock();
  let desactivado = 0;

  storage.setItem(CLAVE_TOKEN_FCM, "token-fcm");

  await cerrarNotificaciones({
    storage,
    desactivar: async () => {
      desactivado += 1;
    },
    revocar: async () => {
      throw new Error("Firebase caído");
    },
  });

  assert.equal(desactivado, 1);
  assert.equal(leerTokenLocal(storage), "");
});

test("sin token FCM no afecta el logout ni toca otros almacenamientos", async () => {
  const storage = crearStorageMock();
  let desactivado = 0;
  let revocado = 0;

  storage.setItem("myc_access_token", "jwt-access");

  const resultado = await cerrarNotificaciones({
    storage,
    desactivar: async () => {
      desactivado += 1;
    },
    revocar: async () => {
      revocado += 1;
    },
  });

  assert.deepEqual(resultado, {
    desactivado: false,
    token: "",
  });
  assert.equal(desactivado, 0);
  assert.equal(revocado, 0);
  assert.equal(
    storage.getItem("myc_access_token"),
    "jwt-access",
  );
});

test("lee el pedido desde la URL y limpia el parámetro", () => {
  const locationRef = {
    href: "https://myc.example/?pedido=33&x=1#inicio",
  };

  assert.equal(leerPedidoDesdeUrl(locationRef), 33);
  assert.equal(
    leerPedidoDesdeUrl({ href: "https://myc.example/?pedido=0" }),
    null,
  );
  assert.equal(
    leerPedidoDesdeUrl({ href: "https://myc.example/" }),
    null,
  );

  let reemplazo = null;
  const historyRef = {
    state: { actual: true },
    replaceState(estado, titulo, url) {
      reemplazo = { estado, titulo, url };
    },
  };

  assert.equal(
    limpiarPedidoDeUrl({ locationRef, historyRef }),
    true,
  );
  assert.deepEqual(reemplazo, {
    estado: { actual: true },
    titulo: "",
    url: "/?x=1#inicio",
  });
});
