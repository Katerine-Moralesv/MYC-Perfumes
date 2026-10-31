import { api } from "./api.js";

export async function iniciarSesion({ username, password }) {
  const { data } = await api.post("/auth/login/", {
    username,
    password,
  });

  return data;
}

export async function obtenerPerfil() {
  const { data } = await api.get("/usuarios/perfil/");
  return data;
}

export async function actualizarPerfil(datos) {
  const { data } = await api.patch("/usuarios/perfil/", datos);
  return data;
}

export async function solicitarRecuperacion(email) {
  const { data } = await api.post("/usuarios/password/solicitar/", {
    email,
  });

  return data;
}

export async function verificarCodigoRecuperacion({ email, codigo }) {
  const { data } = await api.post("/usuarios/password/verificar/", {
    email,
    codigo,
  });

  return data;
}

export async function restablecerPassword({
  email,
  resetToken,
  nuevaPassword,
}) {
  const { data } = await api.post("/usuarios/password/restablecer/", {
    email,
    reset_token: resetToken,
    new_password: nuevaPassword,
  });

  return data;
}
