import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { filtrarSugerencias } from "../services/busquedaPresentaciones.js";
import "./BuscadorSugerencias.css";

export default function BuscadorSugerencias({
  id,
  value,
  onChange,
  onSelect,
  items = [],
  placeholder = "Buscar...",
  noResultsText = "No hay coincidencias.",
  disabled = false,
  selectedId = "",
  ariaLabel,
  limite = 8,
}) {
  const idLista = useId();
  const contenedorRef = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(-1);

  const sugerencias = useMemo(
    () => filtrarSugerencias(items, value, limite),
    [items, value, limite],
  );

  useEffect(() => {
    function cerrarSiEsFuera(evento) {
      if (
        contenedorRef.current &&
        !contenedorRef.current.contains(evento.target)
      ) {
        setAbierto(false);
        setResaltado(-1);
      }
    }

    document.addEventListener("pointerdown", cerrarSiEsFuera);

    return () => {
      document.removeEventListener("pointerdown", cerrarSiEsFuera);
    };
  }, []);

  function seleccionar(item) {
    onSelect(item);
    setAbierto(false);
    setResaltado(-1);
  }

  function manejarTecla(evento) {
    if (evento.key === "Escape") {
      setAbierto(false);
      setResaltado(-1);
      return;
    }

    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setAbierto(true);

      if (!sugerencias.length) return;

      setResaltado((actual) =>
        actual < sugerencias.length - 1 ? actual + 1 : 0,
      );
      return;
    }

    if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setAbierto(true);

      if (!sugerencias.length) return;

      setResaltado((actual) =>
        actual > 0 ? actual - 1 : sugerencias.length - 1,
      );
      return;
    }

    if (evento.key === "Enter" && abierto) {
      const indice =
        resaltado >= 0 && resaltado < sugerencias.length
          ? resaltado
          : sugerencias.length === 1
            ? 0
            : -1;

      if (indice >= 0) {
        evento.preventDefault();
        seleccionar(sugerencias[indice]);
      }
    }
  }

  const sugerenciaResaltada =
    resaltado >= 0 ? sugerencias[resaltado] : null;
  const opcionActiva = sugerenciaResaltada
    ? `${idLista}-${sugerenciaResaltada.id}`
    : undefined;

  return (
    <div className="buscador-sugerencias" ref={contenedorRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-activedescendant={opcionActiva}
        autoComplete="off"
        value={value}
        onChange={(evento) => {
          onChange(evento.target.value);
          setAbierto(true);
          setResaltado(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={(evento) => {
          if (
            !contenedorRef.current?.contains(evento.relatedTarget)
          ) {
            setAbierto(false);
            setResaltado(-1);
          }
        }}
        onKeyDown={manejarTecla}
        placeholder={placeholder}
        disabled={disabled}
      />

      {abierto && !disabled && (
        <ul
          id={idLista}
          className="buscador-sugerencias-lista"
          role="listbox"
        >
          {sugerencias.length ? (
            sugerencias.map((item, indice) => {
              const esResaltada = indice === resaltado;
              const esSeleccionada =
                String(item.id) === String(selectedId);

              return (
                <li
                  id={`${idLista}-${item.id}`}
                  key={item.id}
                  role="option"
                  aria-selected={esSeleccionada}
                  className={[
                    "buscador-sugerencias-opcion",
                    esResaltada ? "resaltada" : "",
                    esSeleccionada ? "seleccionada" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={() => seleccionar(item)}
                  onMouseEnter={() => setResaltado(indice)}
                >
                  <span className="buscador-sugerencias-principal">
                    {item.label}
                  </span>
                  <span className="buscador-sugerencias-descripcion">
                    {item.description}
                  </span>
                </li>
              );
            })
          ) : (
            <li className="buscador-sugerencias-vacio">
              {noResultsText}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
