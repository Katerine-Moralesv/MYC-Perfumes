import { ApiError } from "./api.js";

export const TTL_ADMIN = {
  dashboard: 60_000,
  listas: 30_000,
  catalogo: 120_000,
  usuarios: 60_000,
};

const CACHE = new Map();
const EN_VUELO = new Map();

let generacion = 0;

function errorCancelado() {
  return new ApiError({
    message: "Solicitud cancelada.",
    isCanceled: true,
  });
}

function esperarConSenal(promesa, signal) {
  if (!signal) return promesa;

  if (signal.aborted) {
    return Promise.reject(errorCancelado());
  }

  return new Promise((resolve, reject) => {
    let terminado = false;

    function abortar() {
      if (terminado) return;

      terminado = true;
      signal.removeEventListener("abort", abortar);
      reject(errorCancelado());
    }

    signal.addEventListener("abort", abortar, { once: true });

    promesa.then(
      (valor) => {
        if (terminado) return;

        terminado = true;
        signal.removeEventListener("abort", abortar);
        resolve(valor);
      },
      (error) => {
        if (terminado) return;

        terminado = true;
        signal.removeEventListener("abort", abortar);
        reject(error);
      },
    );
  });
}

export function invalidarCacheAdmin(prefijo) {
  generacion += 1;

  if (!prefijo) {
    CACHE.clear();
    EN_VUELO.clear();
    return;
  }

  for (const clave of [...CACHE.keys()]) {
    if (clave.startsWith(prefijo)) CACHE.delete(clave);
  }

  for (const clave of [...EN_VUELO.keys()]) {
    if (clave.startsWith(prefijo)) EN_VUELO.delete(clave);
  }
}

export function limpiarCacheAdmin() {
  invalidarCacheAdmin();
}

export async function obtenerConCache(
  clave,
  cargar,
  {
    ttl = TTL_ADMIN.listas,
    signal,
    forzar = false,
  } = {},
) {
  if (!forzar) {
    const entrada = CACHE.get(clave);

    if (entrada && entrada.expira > Date.now()) {
      return entrada.datos;
    }
  }

  const enVuelo = EN_VUELO.get(clave);

  if (!forzar && enVuelo && enVuelo.generacion === generacion) {
    return esperarConSenal(enVuelo.promesa, signal);
  }

  const generacionInicio = generacion;

  const promesa = Promise.resolve()
    .then(() => cargar())
    .then((datos) => {
      const actual = EN_VUELO.get(clave);

      if (
        actual &&
        actual.promesa === promesa &&
        generacionInicio === generacion
      ) {
        CACHE.set(clave, {
          datos,
          expira: Date.now() + ttl,
          generacion: generacionInicio,
        });
      }

      return datos;
    })
    .finally(() => {
      const actual = EN_VUELO.get(clave);

      if (actual && actual.promesa === promesa) {
        EN_VUELO.delete(clave);
      }
    });

  EN_VUELO.set(clave, {
    promesa,
    generacion: generacionInicio,
  });

  return esperarConSenal(promesa, signal);
}
