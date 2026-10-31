import "./Header.css";
import logoMYC from "../../assets/logo-myc.png";

function Header() {
  return (
    <header className="header">
      <a href="/" className="header__logo">
        <img src={logoMYC} alt="MYC Perfumes" />
      </a>

      <nav className="header__nav">
        <a href="/">Inicio</a>
        <a href="/catalogo">Catálogo</a>
        <a href="/contacto">Contacto</a>
      </nav>
    </header>
  );
}

export default Header;
