import { api } from "./api.js";
import {
  TTL_ADMIN,
  invalidarCacheAdmin,
  obtenerConCache,
} from "./adminCache.js";

export async function listarUsuarios({ signal } = {}) {
  return obtenerConCache(
    "usuarios:lista",
    async () => {
      const { data } = await api.get("/usuarios/usuarios/");
      return data;
    },
    {
      ttl: TTL_ADMIN.usuarios,
      signal,
    },
  );
}

export async function crearUsuario(datos) {
  const { data } = await api.post("/usuarios/usuarios/", datos);
  invalidarCacheAdmin();
  return data;
}

export async function actualizarUsuario(id, datos) {
  const { data } = await api.patch(`/usuarios/usuarios/${id}/`, datos);
  invalidarCacheAdmin();
  return data;
}

export async function eliminarUsuario(id) {
  await api.delete(`/usuarios/usuarios/${id}/`);
  invalidarCacheAdmin();
}
