import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reiniciar = this.reiniciar.bind(this);
    this.recargar = this.recargar.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Error de renderizado en MYC Perfumes:", error, info);

    if (typeof window !== "undefined") {
      window.__mycReactMounted = true;
      window.dispatchEvent(new Event("myc:ready"));
    }
  }

  reiniciar() {
    this.setState({ error: null });
    window.location.assign("/");
  }

  recargar() {
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error" role="alert">
          <p className="app-error-etiqueta">MYC PERFUMES</p>
          <h1>No pudimos mostrar esta página</h1>
          <p>
            Ocurrió un error inesperado al preparar el contenido. Puedes volver
            al inicio o recargar la página para intentarlo de nuevo.
          </p>
          <div className="app-error-acciones">
            <button type="button" onClick={this.reiniciar}>
              Volver al inicio
            </button>
            <button type="button" onClick={this.recargar}>
              Recargar
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
