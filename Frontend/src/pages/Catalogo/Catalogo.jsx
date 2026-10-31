import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  actualizarFamiliaOlfativa,
  crearFamiliaOlfativa,
  eliminarFamiliaOlfativa,
  listarCategorias,
  listarFamiliasOlfativas,
  obtenerErrorNombreFamilia,
  resolverUrlMedia,
} from "../../services/catalogo.js";
import {
  actualizarActivo,
  actualizarProducto,
  crearProducto,
  listarProductosAdmin,
} from "../../services/catalogoAdmin.js";
import { PESTANAS_CATALOGO } from "./catalogoTabs.js";
import "./Catalogo.css";

const formatoPrecio = (valor) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(valor) || 0);

const ETIQUETAS_CAMPO = {
  nombre: "Nombre",
  descripcion: "Descripción",
  categoria: "Categoría",
  familias_olfativas: "Familias olfativas",
  foto: "Foto",
  precio: "Precio",
  contenido_ml: "Contenido en ml",
  dias_entrega: "Días de entrega",
  activo: "Estado",
};

function crearFormularioVacio(categorias = []) {
  return {
    nombre: "",
    descripcion: "",
    categoria: categorias[0] ? String(categorias[0].id) : "",
    familias_olfativas: [],
    precio: "",
    contenido_ml: "",
    dias_entrega: "1",
    activo: true,
  };
}

function ImagenProducto({ producto }) {
  const [errorImagen, setErrorImagen] = useState(false);
  const src = resolverUrlMedia(producto.foto);

  return (
    <div
      className={`catalogo-producto-imagen imagen-${producto.id % 4}`}
    >
      {src && !errorImagen ? (
        <img
          src={src}
          alt={`Foto de ${producto.nombre}`}
          loading="lazy"
          onError={() => setErrorImagen(true)}
        />
      ) : (
        <span aria-hidden="true">🌸</span>
      )}
    </div>
  );
}

function Catalogo() {
  const [pestana, setPestana] = useState("productos");
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [familias, setFamilias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [intentoCarga, setIntentoCarga] = useState(0);

  const [busqueda, setBusqueda] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("Todas");
  const [orden, setOrden] = useState("nombre");
  const [familiaNombre, setFamiliaNombre] = useState("");
  const [errorFamilia, setErrorFamilia] = useState("");
  const [guardandoFamilia, setGuardandoFamilia] = useState(false);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [productoEditando, setProductoEditando] = useState(null);
  const [formulario, setFormulario] = useState(() =>
    crearFormularioVacio()
  );
  const [archivoFoto, setArchivoFoto] = useState(null);
  const [fotoActual, setFotoActual] = useState("");
  const [fotoPreview, setFotoPreview] = useState("");
  const [quitarFoto, setQuitarFoto] = useState(false);
  const [errorPreview, setErrorPreview] = useState(false);

  const [error, setError] = useState("");
  const [erroresCampo, setErroresCampo] = useState({});
  const [mensajeExito, setMensajeExito] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [accionActivoId, setAccionActivoId] = useState(null);

  const [familiaEditando, setFamiliaEditando] = useState(null);
  const [nombreEdicionFamilia, setNombreEdicionFamilia] = useState("");
  const [errorEdicionFamilia, setErrorEdicionFamilia] = useState("");
  const [guardandoEdicionFamilia, setGuardandoEdicionFamilia] =
    useState(false);

  const [familiaEliminando, setFamiliaEliminando] = useState(null);
  const [errorEliminarFamilia, setErrorEliminarFamilia] = useState("");
  const [eliminandoFamilia, setEliminandoFamilia] = useState(false);

  const hayModalAbierto =
    modalAbierto ||
    familiaEditando != null ||
    familiaEliminando != null;

  useEffect(() => {
    const controlador = new AbortController();
    let activo = true;

    async function cargarCatalogo() {
      setCargando(true);
      setErrorCarga("");

      try {
        const [
          productosApi,
          categoriasApi,
          familiasApi,
        ] = await Promise.all([
          listarProductosAdmin({ signal: controlador.signal }),
          listarCategorias({ signal: controlador.signal }),
          listarFamiliasOlfativas({ signal: controlador.signal }),
        ]);

        if (!activo) return;

        setProductos(productosApi);
        setCategorias(categoriasApi);
        setFamilias(familiasApi);
      } catch (errorCargaApi) {
        if (!activo || errorCargaApi?.isCanceled) return;

        setErrorCarga(
          errorCargaApi?.message ||
            "No se pudo cargar el catálogo administrativo."
        );
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargarCatalogo();

    return () => {
      activo = false;
      controlador.abort();
    };
  }, [intentoCarga]);

  useEffect(() => {
    if (!hayModalAbierto) return undefined;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [hayModalAbierto]);

  useEffect(() => {
    return () => {
      if (fotoPreview) {
        URL.revokeObjectURL(fotoPreview);
      }
    };
  }, [fotoPreview]);

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLocaleLowerCase("es");

    const resultado = productos.filter((producto) => {
      const familiasTexto = (
        producto.familias_olfativas_nombres || []
      ).join(" ");
      const textoProducto = [
        producto.nombre,
        producto.descripcion,
        producto.categoria_nombre,
        producto.contenido_ml,
        familiasTexto,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es");

      const coincideBusqueda = textoProducto.includes(texto);
      const coincideCategoria =
        filtroCategoria === "Todas" ||
        String(producto.categoria) === filtroCategoria;

      return coincideBusqueda && coincideCategoria;
    });

    resultado.sort((a, b) => {
      if (orden === "precio-menor") {
        return (
          (Number(a.precio) || 0) - (Number(b.precio) || 0)
        );
      }

      if (orden === "precio-mayor") {
        return (
          (Number(b.precio) || 0) - (Number(a.precio) || 0)
        );
      }

      return String(a.nombre || "").localeCompare(
        String(b.nombre || ""),
        "es"
      );
    });

    return resultado;
  }, [productos, busqueda, filtroCategoria, orden]);

  const previewSrc =
    fotoPreview ||
    (!quitarFoto ? resolverUrlMedia(fotoActual) : "");

  function actualizarCampo(campo, valor) {
    setFormulario((actual) => ({
      ...actual,
      [campo]: valor,
    }));

    if (erroresCampo[campo]) {
      setErroresCampo((actual) => {
        const siguiente = { ...actual };
        delete siguiente[campo];
        return siguiente;
      });
    }

    if (error) setError("");
  }

  function actualizarFamilias(event) {
    const seleccionadas = Array.from(
      event.target.selectedOptions,
      (opcion) => opcion.value
    );

    actualizarCampo("familias_olfativas", seleccionadas);
  }

  function manejarImagenArchivo(event) {
    const input = event.currentTarget;
    const archivo = input.files?.[0];

    if (!archivo) return;

    if (!archivo.type.startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido.");
      input.value = "";
      return;
    }

    if (archivo.size > 10 * 1024 * 1024) {
      setError("La imagen supera los 10 MB. Elige una más pequeña.");
      input.value = "";
      return;
    }

    if (fotoPreview) {
      URL.revokeObjectURL(fotoPreview);
    }

    setArchivoFoto(archivo);
    setFotoPreview(URL.createObjectURL(archivo));
    setQuitarFoto(false);
    setErrorPreview(false);
    setError("");
    input.value = "";
  }

  function quitarImagen() {
    if (archivoFoto) {
      setArchivoFoto(null);
      setFotoPreview("");
      setErrorPreview(false);
      return;
    }

    if (fotoActual) {
      setQuitarFoto(true);
      setErrorPreview(false);
    }
  }

  function abrirNuevoProducto() {
    setProductoEditando(null);
    setFormulario(crearFormularioVacio(categorias));
    setArchivoFoto(null);
    setFotoActual("");
    setFotoPreview("");
    setQuitarFoto(false);
    setErrorPreview(false);
    setError("");
    setErroresCampo({});
    setModalAbierto(true);
  }

  function abrirEditarProducto(producto) {
    setProductoEditando(producto.id);
    setFormulario({
      nombre: producto.nombre || "",
      descripcion: producto.descripcion || "",
      categoria:
        producto.categoria != null
          ? String(producto.categoria)
          : "",
      familias_olfativas: Array.isArray(
        producto.familias_olfativas
      )
        ? producto.familias_olfativas.map(String)
        : [],
      precio:
        producto.precio != null
          ? String(producto.precio)
          : "",
      contenido_ml:
        producto.contenido_ml != null
          ? String(producto.contenido_ml)
          : "",
      dias_entrega: String(producto.dias_entrega ?? 1),
      activo: producto.activo !== false,
    });
    setArchivoFoto(null);
    setFotoActual(producto.foto || "");
    setFotoPreview("");
    setQuitarFoto(false);
    setErrorPreview(false);
    setError("");
    setErroresCampo({});
    setModalAbierto(true);
  }

  function cerrarModal() {
    if (guardando) return;

    setModalAbierto(false);
    setProductoEditando(null);
    setArchivoFoto(null);
    setFotoActual("");
    setFotoPreview("");
    setQuitarFoto(false);
    setErrorPreview(false);
    setError("");
    setErroresCampo({});
  }

  function validarFormulario() {
    const errores = {};
    const nombre = formulario.nombre.trim();
    const precio = Number(formulario.precio);
    const contenidoMl = Number(formulario.contenido_ml);
    const diasEntrega = Number(formulario.dias_entrega);

    if (!nombre) {
      errores.nombre = "Escribe el nombre del producto.";
    }

    if (!formulario.categoria) {
      errores.categoria = "Selecciona una categoría.";
    }

    if (
      formulario.precio === "" ||
      !Number.isFinite(precio) ||
      precio <= 0
    ) {
      errores.precio = "Ingresa un precio mayor que cero.";
    }

    if (
      formulario.contenido_ml === "" ||
      !Number.isInteger(contenidoMl) ||
      contenidoMl < 1
    ) {
      errores.contenido_ml =
        "Ingresa un contenido en mililitros mayor que cero.";
    }

    if (
      formulario.dias_entrega === "" ||
      !Number.isInteger(diasEntrega) ||
      diasEntrega < 1
    ) {
      errores.dias_entrega =
        "Los días de entrega deben ser un entero mayor o igual a 1.";
    }

    setErroresCampo(errores);

    if (Object.keys(errores).length) {
      setError("Revisa los campos marcados.");
      return false;
    }

    setError("");
    return true;
  }

  async function guardarProducto(event) {
    event.preventDefault();

    if (!validarFormulario()) return;

    setGuardando(true);
    setMensajeExito("");
    setError("");

    try {
      const editando = productoEditando != null;
      const productoGuardado = editando
        ? await actualizarProducto(productoEditando, {
            formulario,
            archivoFoto,
            quitarFoto,
          })
        : await crearProducto({
            formulario,
            archivoFoto,
          });

      setProductos((actuales) =>
        editando
          ? actuales.map((producto) =>
              String(producto.id) === String(productoGuardado.id)
                ? productoGuardado
                : producto
            )
          : [productoGuardado, ...actuales]
      );

      setModalAbierto(false);
      setProductoEditando(null);
      setArchivoFoto(null);
      setFotoActual("");
      setFotoPreview("");
      setQuitarFoto(false);
      setErrorPreview(false);
      setErroresCampo({});
      setMensajeExito(
        editando
          ? "Producto actualizado correctamente."
          : "Producto creado correctamente."
      );
    } catch (errorGuardar) {
      const campos = errorGuardar?.fieldErrors || {};
      setErroresCampo(campos);
      setError(
        Object.keys(campos).length
          ? "Revisa los campos del formulario."
          : errorGuardar?.message ||
            "No se pudo guardar el producto."
      );
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(producto) {
    if (accionActivoId != null) return;

    setAccionActivoId(producto.id);
    setError("");
    setMensajeExito("");

    try {
      const actualizado = await actualizarActivo(
        producto.id,
        !producto.activo
      );

      setProductos((actuales) =>
        actuales.map((item) =>
          String(item.id) === String(actualizado.id)
            ? actualizado
            : item
        )
      );

      setMensajeExito(
        actualizado.activo
          ? "Producto activado correctamente."
          : "Producto desactivado correctamente."
      );
    } catch (errorActivo) {
      setError(
        errorActivo?.message ||
          "No se pudo actualizar el estado del producto."
      );
    } finally {
      setAccionActivoId(null);
    }
  }

  const familiasConConteo = useMemo(
    () =>
      familias
        .map((familia) => ({
          ...familia,
          cantidad: productos.filter((producto) =>
            (producto.familias_olfativas || []).some(
              (id) => String(id) === String(familia.id)
            )
          ).length,
        }))
        .sort((a, b) =>
          String(a.nombre).localeCompare(String(b.nombre), "es")
        ),
    [familias, productos]
  );

  async function crearFamilia(evento) {
    evento.preventDefault();

    if (guardandoFamilia) return;

    const nombre = familiaNombre.trim();
    const errorNombre = obtenerErrorNombreFamilia(nombre, familias);

    if (errorNombre) {
      setErrorFamilia(errorNombre);
      return;
    }

    setGuardandoFamilia(true);
    setErrorFamilia("");
    setMensajeExito("");

    try {
      const nueva = await crearFamiliaOlfativa(nombre);
      setFamilias((actuales) =>
        [...actuales, nueva].sort((a, b) =>
          String(a.nombre).localeCompare(String(b.nombre), "es")
        )
      );
      setFamiliaNombre("");
      setMensajeExito(
        `Familia olfativa "${nueva.nombre}" creada correctamente.`
      );
    } catch (errorCrearFamilia) {
      setErrorFamilia(
        errorCrearFamilia?.message ||
          "No se pudo crear la familia olfativa."
      );
    } finally {
      setGuardandoFamilia(false);
    }
  }

  function abrirEditarFamilia(familia) {
    setFamiliaEditando(familia);
    setNombreEdicionFamilia(familia.nombre || "");
    setErrorEdicionFamilia("");
    setError("");
    setMensajeExito("");
  }

  function cerrarEditarFamilia() {
    if (guardandoEdicionFamilia) return;

    setFamiliaEditando(null);
    setNombreEdicionFamilia("");
    setErrorEdicionFamilia("");
  }

  async function guardarEdicionFamilia(evento) {
    evento.preventDefault();

    if (!familiaEditando || guardandoEdicionFamilia) return;

    const errorNombre = obtenerErrorNombreFamilia(
      nombreEdicionFamilia,
      familias,
      familiaEditando.id
    );

    if (errorNombre) {
      setErrorEdicionFamilia(errorNombre);
      return;
    }

    setGuardandoEdicionFamilia(true);
    setErrorEdicionFamilia("");
    setMensajeExito("");

    try {
      const actualizada = await actualizarFamiliaOlfativa(
        familiaEditando.id,
        nombreEdicionFamilia
      );

      setFamilias((actuales) =>
        actuales
          .map((familia) =>
            String(familia.id) === String(actualizada.id)
              ? actualizada
              : familia
          )
          .sort((a, b) =>
            String(a.nombre).localeCompare(String(b.nombre), "es")
          )
      );

      setProductos((actuales) =>
        actuales.map((producto) => {
          const asociada = (
            producto.familias_olfativas || []
          ).some(
            (id) => String(id) === String(actualizada.id)
          );

          if (!asociada) return producto;

          return {
            ...producto,
            familias_olfativas_nombres: (
              producto.familias_olfativas_nombres || []
            ).map((nombre) =>
              nombre === familiaEditando.nombre
                ? actualizada.nombre
                : nombre
            ),
          };
        })
      );

      setFamiliaEditando(null);
      setNombreEdicionFamilia("");
      setMensajeExito(
        `Familia olfativa "${actualizada.nombre}" actualizada correctamente.`
      );
    } catch (errorEdicion) {
      setErrorEdicionFamilia(
        errorEdicion?.message ||
          "No se pudo actualizar la familia olfativa."
      );
    } finally {
      setGuardandoEdicionFamilia(false);
    }
  }

  function abrirEliminarFamilia(familia) {
    setFamiliaEliminando(familia);
    setErrorEliminarFamilia("");
    setError("");
    setMensajeExito("");
  }

  function cerrarEliminarFamilia() {
    if (eliminandoFamilia) return;

    setFamiliaEliminando(null);
    setErrorEliminarFamilia("");
  }

  async function confirmarEliminarFamilia() {
    if (!familiaEliminando || eliminandoFamilia) return;

    if (familiaEliminando.cantidad > 0) {
      setErrorEliminarFamilia(
        "Esta familia tiene productos asociados. Reasígnalos a otra familia o quítalos de esta antes de eliminarla."
      );
      return;
    }

    setEliminandoFamilia(true);
    setErrorEliminarFamilia("");
    setMensajeExito("");

    try {
      await eliminarFamiliaOlfativa(familiaEliminando.id);

      setFamilias((actuales) =>
        actuales.filter(
          (familia) =>
            String(familia.id) !== String(familiaEliminando.id)
        )
      );

      setProductos((actuales) =>
        actuales.map((producto) => {
          const familiasProducto = producto.familias_olfativas || [];

          if (
            !familiasProducto.some(
              (id) => String(id) === String(familiaEliminando.id)
            )
          ) {
            return producto;
          }

          return {
            ...producto,
            familias_olfativas: familiasProducto.filter(
              (id) => String(id) !== String(familiaEliminando.id)
            ),
            familias_olfativas_nombres: (
              producto.familias_olfativas_nombres || []
            ).filter(
              (nombre) => nombre !== familiaEliminando.nombre
            ),
          };
        })
      );

      const nombreEliminado = familiaEliminando.nombre;
      setFamiliaEliminando(null);
      setMensajeExito(
        `Familia olfativa "${nombreEliminado}" eliminada correctamente.`
      );
    } catch (errorEliminar) {
      setErrorEliminarFamilia(
        errorEliminar?.message ||
          "No se pudo eliminar la familia olfativa."
      );
    } finally {
      setEliminandoFamilia(false);
    }
  }

  return (
    <main className="catalogo">
      <section className="catalogo-contenido">
        <header className="catalogo-encabezado">
          <div>
            <p className="catalogo-etiqueta">MYC PERFUMES</p>
            <h1>Catálogo</h1>
            <p className="catalogo-subtitulo">
              Administra los productos, precios, contenido, categorías,
              familias olfativas y fotografías de tu catálogo.
            </p>
          </div>

          {pestana === "productos" && (
            <button
              className="catalogo-boton-principal"
              type="button"
              onClick={abrirNuevoProducto}
              disabled={
                cargando ||
                Boolean(errorCarga) ||
                categorias.length === 0
              }
              title={
                categorias.length === 0
                  ? "No hay categorías disponibles"
                  : "Agregar producto"
              }
            >
              <span aria-hidden="true">＋</span> Agregar producto
            </button>
          )}
        </header>

        <nav
          className="catalogo-pestanas"
          aria-label="Secciones del catálogo"
        >
          {PESTANAS_CATALOGO.map((pestanaCatalogo) => (
            <button
              key={pestanaCatalogo.valor}
              type="button"
              className={
                pestana === pestanaCatalogo.valor ? "activa" : ""
              }
              onClick={() => {
                setPestana(pestanaCatalogo.valor);
                setError("");
                setErrorFamilia("");
              }}
            >
              <span aria-hidden="true">
                {pestanaCatalogo.icono}
              </span>{" "}
              {pestanaCatalogo.etiqueta}
            </button>
          ))}
        </nav>

        {pestana === "productos" ? (
          <section className="catalogo-panel">
            <div className="catalogo-filtros">
              <label className="catalogo-buscador">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Buscar producto, categoría o familia..."
                  value={busqueda}
                  onChange={(event) => setBusqueda(event.target.value)}
                  aria-label="Buscar productos del catálogo"
                />
              </label>

              <select
                value={filtroCategoria}
                onChange={(event) =>
                  setFiltroCategoria(event.target.value)
                }
                aria-label="Filtrar por categoría"
              >
                <option value="Todas">Todas las categorías</option>
                {categorias.map((categoria) => (
                  <option
                    key={categoria.id}
                    value={String(categoria.id)}
                  >
                    {categoria.nombre}
                  </option>
                ))}
              </select>

              <select
                value={orden}
                onChange={(event) => setOrden(event.target.value)}
                aria-label="Ordenar productos"
              >
                <option value="nombre">Ordenar: nombre</option>
                <option value="precio-menor">
                  Precio: menor a mayor
                </option>
                <option value="precio-mayor">
                  Precio: mayor a menor
                </option>
              </select>
            </div>

            <div className="catalogo-tabla-contenedor">
              <table className="catalogo-tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Precio</th>
                    <th>Entrega</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan="5" className="catalogo-vacio">
                        <span aria-hidden="true">⌕</span>
                        <strong>Cargando productos...</strong>
                        <p>Estamos cargando el catálogo.</p>
                      </td>
                    </tr>
                  )}

                  {!cargando && errorCarga && (
                    <tr>
                      <td colSpan="5" className="catalogo-vacio">
                        <span aria-hidden="true">!</span>
                        <strong>No se pudo cargar el catálogo</strong>
                        <p>{errorCarga}</p>
                        <button
                          type="button"
                          className="catalogo-boton-principal"
                          onClick={() =>
                            setIntentoCarga((valor) => valor + 1)
                          }
                        >
                          Reintentar
                        </button>
                      </td>
                    </tr>
                  )}

                  {!cargando &&
                    !errorCarga &&
                    productosFiltrados.map((producto) => (
                      <tr key={producto.id}>
                        <td>
                          <div className="catalogo-producto">
                            <ImagenProducto
                              key={`${producto.id}-${producto.foto || "sin-foto"}`}
                              producto={producto}
                            />

                            <div className="catalogo-producto-datos">
                              <strong>{producto.nombre}</strong>
                              <span>
                                {producto.contenido_ml
                                  ? `${producto.contenido_ml} ml`
                                  : "Contenido sin definir"}
                              </span>
                              <span>
                                {producto.categoria_nombre ||
                                  "Sin categoría"}
                                {producto.familias_olfativas_nombres
                                  ?.length
                                  ? ` · ${producto.familias_olfativas_nombres.join(
                                      " · "
                                    )}`
                                  : ""}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          {producto.precio != null
                            ? formatoPrecio(producto.precio)
                            : "Precio por confirmar"}
                        </td>

                        <td>
                          {producto.dias_entrega
                            ? `${producto.dias_entrega} ${
                                producto.dias_entrega === 1
                                  ? "día"
                                  : "días"
                              }`
                            : "Sin definir"}
                        </td>

                        <td>
                          <span
                            className={`catalogo-estado ${
                              producto.activo
                                ? "activo"
                                : "inactivo"
                            }`}
                          >
                            {producto.activo ? "Activo" : "Inactivo"}
                          </span>
                        </td>

                        <td>
                          <div className="catalogo-acciones">
                            <button
                              type="button"
                              className="catalogo-accion editar"
                              title={`Editar ${producto.nombre}`}
                              aria-label={`Editar ${producto.nombre}`}
                              onClick={() =>
                                abrirEditarProducto(producto)
                              }
                            >
                              ✎
                            </button>


                            <button
                              type="button"
                              className={`catalogo-accion estado ${
                                producto.activo
                                  ? "desactivar"
                                  : "activar"
                              }`}
                              title={
                                producto.activo
                                  ? `Desactivar ${producto.nombre}`
                                  : `Activar ${producto.nombre}`
                              }
                              aria-label={
                                producto.activo
                                  ? `Desactivar ${producto.nombre}`
                                  : `Activar ${producto.nombre}`
                              }
                              onClick={() =>
                                alternarActivo(producto)
                              }
                              disabled={
                                accionActivoId === producto.id
                              }
                            >
                              {accionActivoId === producto.id
                                ? "…"
                                : producto.activo
                                  ? "Desactivar"
                                  : "Activar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  {!cargando &&
                    !errorCarga &&
                    productosFiltrados.length === 0 && (
                      <tr>
                        <td colSpan="5" className="catalogo-vacio">
                          <span aria-hidden="true">⌕</span>
                          <strong>
                            {productos.length
                              ? "No encontramos productos"
                              : "Aún no hay productos"}
                          </strong>
                          <p>
                            {productos.length
                              ? "Prueba con otro nombre o filtro."
                              : "Crea el primer producto del catálogo."}
                          </p>
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>

            <footer className="catalogo-pie-tabla">
              <span>
                Mostrando {productosFiltrados.length} de{" "}
                {productos.length} productos
              </span>
              <span className="catalogo-paginacion">
                <span className="catalogo-pagina-activa">1</span>
              </span>
            </footer>
          </section>
        ) : pestana === "familias" ? (
          <section className="catalogo-panel catalogo-categorias">
            <div className="categorias-encabezado">
              <div>
                <h2>Familias olfativas</h2>
                <p>
                  Son clasificaciones aromáticas independientes del
                  público objetivo (Mujer, Hombre y Unisex).
                </p>
              </div>
            </div>

            {cargando ? (
              <p className="catalogo-vacio">
                <strong>Cargando familias olfativas...</strong>
              </p>
            ) : errorCarga ? (
              <div className="catalogo-error" role="alert">
                <p>{errorCarga}</p>
                <button
                  type="button"
                  className="catalogo-boton-secundario"
                  onClick={() =>
                    setIntentoCarga((valor) => valor + 1)
                  }
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <>
                <form
                  className="categorias-formulario"
                  onSubmit={crearFamilia}
                >
                  <label htmlFor="familia-nombre">
                    Nombre de la familia
                  </label>
                  <div>
                    <input
                      id="familia-nombre"
                      type="text"
                      value={familiaNombre}
                      onChange={(evento) => {
                        setFamiliaNombre(evento.target.value);
                        setErrorFamilia("");
                      }}
                      maxLength="100"
                      placeholder="Ej. Floral, Amaderada, Gourmand"
                      disabled={guardandoFamilia}
                      required
                    />
                    <button
                      type="submit"
                      className="catalogo-boton-principal"
                      disabled={
                        guardandoFamilia || !familiaNombre.trim()
                      }
                    >
                      {guardandoFamilia
                        ? "Guardando..."
                        : "Agregar familia"}
                    </button>
                  </div>
                  {errorFamilia && (
                    <p className="catalogo-error" role="alert">
                      {errorFamilia}
                    </p>
                  )}
                </form>

                {familiasConConteo.length === 0 ? (
                  <div className="catalogo-vacio">
                    <strong>
                      No hay familias olfativas registradas.
                    </strong>
                    <p>Crea la primera familia con el formulario.</p>
                  </div>
                ) : (
                  <div className="categorias-grid">
                    {familiasConConteo.map((familia, indice) => (
                      <article
                        className="categoria-card"
                        key={familia.id}
                      >
                        <div className="categoria-card-superior">
                          <div
                            className={`categoria-icono categoria-color-${indice % 4}`}
                          >
                            ✦
                          </div>

                          <div className="categoria-card-acciones">
                            <button
                              type="button"
                              className="categoria-accion editar"
                              title={`Editar ${familia.nombre}`}
                              aria-label={`Editar ${familia.nombre}`}
                              onClick={() =>
                                abrirEditarFamilia(familia)
                              }
                            >
                              <span aria-hidden="true">✎</span>
                            </button>

                            <button
                              type="button"
                              className="categoria-accion eliminar"
                              title={`Eliminar ${familia.nombre}`}
                              aria-label={`Eliminar ${familia.nombre}`}
                              onClick={() =>
                                abrirEliminarFamilia(familia)
                              }
                            >
                              <span aria-hidden="true">✕</span>
                            </button>
                          </div>
                        </div>

                        <h3>{familia.nombre}</h3>
                        <p>
                          {familia.cantidad}{" "}
                          {familia.cantidad === 1
                            ? "producto"
                            : "productos"}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}

            <p className="categorias-nota">
              Las familias olfativas se administran aquí. Los valores
              Mujer, Hombre y Unisex son categorías de público
              objetivo predefinidas por el sistema y no se crean en
              esta sección.
            </p>
          </section>
        ) : null}
      </section>

      {mensajeExito && (
        <p className="catalogo-aviso catalogo-exito" role="status">
          {mensajeExito}
          <button
            type="button"
            onClick={() => setMensajeExito("")}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </p>
      )}

      {error && !modalAbierto && (
        <p className="catalogo-aviso" role="status">
          {error}
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </p>
      )}

      {modalAbierto &&
        createPortal(
          <div
            className="catalogo-modal-fondo"
            onMouseDown={(event) => {
              if (
                !guardando &&
                event.target === event.currentTarget
              ) {
                cerrarModal();
              }
            }}
          >
            <section
              className="catalogo-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="catalogo-modal-titulo"
            >
              <header className="catalogo-modal-encabezado">
                <div>
                  <p className="catalogo-etiqueta">MYC PERFUMES</p>
                  <h2 id="catalogo-modal-titulo">
                    {productoEditando != null
                      ? "Editar producto"
                      : "Agregar producto"}
                  </h2>
                </div>

                <button
                  type="button"
                  className="catalogo-modal-cerrar"
                  onClick={cerrarModal}
                  disabled={guardando}
                  aria-label="Cerrar formulario"
                >
                  ×
                </button>
              </header>

              <form
                className="catalogo-formulario"
                onSubmit={guardarProducto}
                aria-busy={guardando}
              >
                <label>
                  Nombre del producto *
                  <input
                    type="text"
                    value={formulario.nombre}
                    onChange={(event) =>
                      actualizarCampo("nombre", event.target.value)
                    }
                    placeholder="Ej. Perfume Blossom"
                    maxLength={150}
                    required
                  />
                </label>

                <div className="catalogo-formulario-fila">
                  <label>
                    Categoría / público objetivo *
                    <select
                      value={formulario.categoria}
                      onChange={(event) =>
                        actualizarCampo(
                          "categoria",
                          event.target.value
                        )
                      }
                      required
                    >
                      <option value="">Selecciona una categoría</option>
                      {categorias.map((categoria) => (
                        <option
                          key={categoria.id}
                          value={String(categoria.id)}
                        >
                          {categoria.nombre}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalogo-campo-activo">
                    <input
                      type="checkbox"
                      checked={formulario.activo}
                      onChange={(event) =>
                        actualizarCampo(
                          "activo",
                          event.target.checked
                        )
                      }
                    />
                    Producto activo
                  </label>
                </div>

                <label>
                  Descripción
                  <textarea
                    value={formulario.descripcion}
                    onChange={(event) =>
                      actualizarCampo(
                        "descripcion",
                        event.target.value
                      )
                    }
                    placeholder="Descripción o perfil aromático"
                    rows={3}
                    maxLength={1000}
                  />
                </label>

                <label>
                  Familias olfativas
                  <select
                    multiple
                    value={formulario.familias_olfativas}
                    onChange={actualizarFamilias}
                    size={Math.min(6, Math.max(3, familias.length))}
                  >
                    {familias.map((familia) => (
                      <option
                        key={familia.id}
                        value={String(familia.id)}
                      >
                        {familia.nombre}
                      </option>
                    ))}
                  </select>
                  <small>
                    Puedes seleccionar varias familias con Ctrl o Cmd.
                  </small>
                </label>

                <div className="catalogo-formulario-fila">
                  <label>
                    Precio de venta (COP) *
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={formulario.precio}
                      onChange={(event) =>
                        actualizarCampo(
                          "precio",
                          event.target.value
                        )
                      }
                      placeholder="120000"
                      required
                    />
                  </label>

                  <label>
                    Contenido (ml) *
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formulario.contenido_ml}
                      onChange={(event) =>
                        actualizarCampo(
                          "contenido_ml",
                          event.target.value
                        )
                      }
                      placeholder="100"
                      required
                    />
                  </label>
                </div>

                <div className="catalogo-formulario-fila">
                  <label>
                    Días de entrega *
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formulario.dias_entrega}
                      onChange={(event) =>
                        actualizarCampo(
                          "dias_entrega",
                          event.target.value
                        )
                      }
                      placeholder="1"
                      required
                    />
                  </label>

                  <div aria-hidden="true" />
                </div>

                <label className="catalogo-campo-imagen">
                  Foto del producto
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={manejarImagenArchivo}
                    disabled={guardando}
                    aria-label="Seleccionar foto del producto"
                  />
                  <small>
                    JPG, PNG, WebP o GIF. Máximo 10 MB. Si no eliges una
                    imagen nueva, se conserva la foto actual.
                  </small>
                </label>

                <div className="catalogo-imagen-preview">
                  {previewSrc && !errorPreview ? (
                    <img
                      src={previewSrc}
                      alt="Vista previa del producto"
                      onError={() => setErrorPreview(true)}
                    />
                  ) : (
                    <div className="catalogo-imagen-preview-vacia">
                      <span aria-hidden="true">🌸</span>
                      <small>
                        {quitarFoto
                          ? "La foto se quitará al guardar"
                          : "Sin foto"}
                      </small>
                    </div>
                  )}

                  {(archivoFoto ||
                    (fotoActual && !quitarFoto) ||
                    previewSrc) && (
                    <button
                      type="button"
                      className="catalogo-quitar-imagen"
                      onClick={quitarImagen}
                      disabled={guardando}
                    >
                      Quitar foto
                    </button>
                  )}
                </div>

                <small className="catalogo-foto-nota">
                  {archivoFoto
                    ? "Vista previa. La imagen se guardará al guardar el producto."
                    : quitarFoto
                      ? "La foto actual se eliminará al guardar."
                      : fotoActual
                        ? "Foto actual del producto."
                        : "Producto sin foto."}
                </small>

                {Object.keys(erroresCampo).length > 0 && (
                  <div className="catalogo-errores-campo" role="alert">
                    <strong>Revisa estos campos:</strong>
                    <ul>
                      {Object.entries(erroresCampo).map(
                        ([campo, mensaje]) => (
                          <li key={campo}>
                            <b>
                              {ETIQUETAS_CAMPO[campo] || campo}:
                            </b>{" "}
                            {mensaje}
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                {error && (
                  <p className="catalogo-error" role="alert">
                    {error}
                  </p>
                )}

                <p className="catalogo-formulario-nota">
                  * Campos obligatorios. Los productos y las fotografías se
                  guardan al confirmar.
                </p>

                <footer className="catalogo-modal-acciones">
                  <button
                    type="button"
                    className="catalogo-boton-secundario"
                    onClick={cerrarModal}
                    disabled={guardando}
                  >
                    Cancelar
                  </button>

                  <button
                    className="catalogo-boton-principal"
                    type="submit"
                    disabled={guardando}
                  >
                    {guardando
                      ? "Guardando..."
                      : productoEditando != null
                        ? "Guardar cambios"
                        : "Agregar producto"}
                  </button>
                </footer>
              </form>
            </section>
          </div>,
          document.body
        )}

      {familiaEditando &&
        createPortal(
          <div
            className="catalogo-modal-fondo"
            onMouseDown={(event) => {
              if (
                !guardandoEdicionFamilia &&
                event.target === event.currentTarget
              ) {
                cerrarEditarFamilia();
              }
            }}
          >
            <section
              className="catalogo-modal catalogo-modal-compacto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="familia-editar-titulo"
            >
              <header className="catalogo-modal-encabezado">
                <div>
                  <p className="catalogo-etiqueta">MYC PERFUMES</p>
                  <h2 id="familia-editar-titulo">
                    Editar familia olfativa
                  </h2>
                </div>

                <button
                  type="button"
                  className="catalogo-modal-cerrar"
                  onClick={cerrarEditarFamilia}
                  disabled={guardandoEdicionFamilia}
                  aria-label="Cerrar formulario"
                >
                  ×
                </button>
              </header>

              <form
                className="catalogo-formulario"
                onSubmit={guardarEdicionFamilia}
                aria-busy={guardandoEdicionFamilia}
              >
                <label>
                  Nombre de la familia *
                  <input
                    type="text"
                    value={nombreEdicionFamilia}
                    onChange={(evento) => {
                      setNombreEdicionFamilia(evento.target.value);
                      setErrorEdicionFamilia("");
                    }}
                    maxLength={100}
                    placeholder="Ej. Floral, Amaderada, Gourmand"
                    autoFocus
                    required
                  />
                </label>

                <p className="catalogo-formulario-nota">
                  Los productos asociados a esta familia conservarán
                  todas sus relaciones. Solo se actualizará el nombre.
                </p>

                {errorEdicionFamilia && (
                  <p className="catalogo-error" role="alert">
                    {errorEdicionFamilia}
                  </p>
                )}

                <footer className="catalogo-modal-acciones">
                  <button
                    type="button"
                    className="catalogo-boton-secundario"
                    onClick={cerrarEditarFamilia}
                    disabled={guardandoEdicionFamilia}
                  >
                    Cancelar
                  </button>

                  <button
                    className="catalogo-boton-principal"
                    type="submit"
                    disabled={
                      guardandoEdicionFamilia ||
                      !nombreEdicionFamilia.trim()
                    }
                  >
                    {guardandoEdicionFamilia
                      ? "Guardando..."
                      : "Guardar cambios"}
                  </button>
                </footer>
              </form>
            </section>
          </div>,
          document.body
        )}

      {familiaEliminando &&
        createPortal(
          <div
            className="catalogo-modal-fondo"
            onMouseDown={(event) => {
              if (
                !eliminandoFamilia &&
                event.target === event.currentTarget
              ) {
                cerrarEliminarFamilia();
              }
            }}
          >
            <section
              className="catalogo-modal catalogo-modal-compacto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="familia-eliminar-titulo"
            >
              <header className="catalogo-modal-encabezado">
                <div>
                  <p className="catalogo-etiqueta">MYC PERFUMES</p>
                  <h2 id="familia-eliminar-titulo">
                    Eliminar familia olfativa
                  </h2>
                </div>

                <button
                  type="button"
                  className="catalogo-modal-cerrar"
                  onClick={cerrarEliminarFamilia}
                  disabled={eliminandoFamilia}
                  aria-label="Cerrar confirmación"
                >
                  ×
                </button>
              </header>

              <div className="catalogo-confirmacion">
                <p>
                  ¿Deseas eliminar la familia olfativa{" "}
                  <strong>“{familiaEliminando.nombre}”</strong>?
                </p>

                {familiaEliminando.cantidad > 0 ? (
                  <p className="catalogo-error" role="alert">
                    Esta familia tiene {familiaEliminando.cantidad}{" "}
                    {familiaEliminando.cantidad === 1
                      ? "producto asociado"
                      : "productos asociados"}
                    . Reasigna esos productos a otra familia o quítalos
                    de esta antes de eliminarla.
                  </p>
                ) : (
                  <p className="catalogo-confirmacion-nota">
                    Esta familia no tiene productos asociados. No se
                    eliminarán productos, presentaciones, ventas ni
                    pedidos.
                  </p>
                )}

                {errorEliminarFamilia && (
                  <p className="catalogo-error" role="alert">
                    {errorEliminarFamilia}
                  </p>
                )}

                <footer className="catalogo-modal-acciones">
                  <button
                    type="button"
                    className="catalogo-boton-secundario"
                    onClick={cerrarEliminarFamilia}
                    disabled={eliminandoFamilia}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    className="catalogo-boton-peligro"
                    onClick={confirmarEliminarFamilia}
                    disabled={
                      eliminandoFamilia ||
                      familiaEliminando.cantidad > 0
                    }
                  >
                    {eliminandoFamilia
                      ? "Eliminando..."
                      : "Eliminar familia"}
                  </button>
                </footer>
              </div>
            </section>
          </div>,
          document.body
        )}
    </main>
  );
}

export default Catalogo;
