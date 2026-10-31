import { api } from "./api.js";

export async function listarUsuarios() {
  const { data } = await api.get("/usuarios/usuarios/");
  return data;
}

export async function crearUsuario(datos) {
  const { data } = await api.post("/usuarios/usuarios/", datos);
  return data;
}

export async function actualizarUsuario(id, datos) {
  const { data } = await api.patch(`/usuarios/usuarios/${id}/`, datos);
  return data;
}

export async function eliminarUsuario(id) {
  await api.delete(`/usuarios/usuarios/${id}/`);
}
