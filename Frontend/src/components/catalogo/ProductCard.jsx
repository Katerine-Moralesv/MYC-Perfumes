import "./ProductCard.css";

function ProductCard({
  imagen,
  nombre,
  presentacion,
  precio,
}) {
  return (
    <article className="product-card">
      <div className="product-card__image">
        <img src={imagen} alt={nombre} />
      </div>

      <div className="product-card__info">
        <h3>{nombre}</h3>

        <p>{presentacion}</p>

        {precio && (
          <span className="product-card__price">
            ${precio.toLocaleString("es-CO")}
          </span>
        )}

        <button
          className="product-card__button"
          type="button"
          aria-label={`Ver ${nombre}`}
        >
          🛍
        </button>
      </div>
    </article>
  );
}

export default ProductCard;
