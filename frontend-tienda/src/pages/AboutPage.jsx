import { Link } from "react-router-dom";

const AboutPage = () => (
  <div className="container py-5">
    <h1 className="h3 fw-bold mb-4">Sobre Nosotros</h1>
    <div className="row">
      <div className="col-lg-8">
        <p className="text-secondary">
          Somos una tienda de tecnología en Honduras: vendemos computadoras,
          laptops, impresoras, monitores, accesorios, componentes y redes.
          Además reparamos equipos y damos soporte técnico remoto, en tienda
          o a domicilio.
        </p>
        <p className="text-secondary">
          Puedes <Link to="/productos">explorar la tienda</Link>,
          <Link to="/reparaciones"> solicitar una reparación</Link> o
          <Link to="/soporte"> pedir soporte técnico</Link>, y dar seguimiento
          a tu solicitud en <Link to="/seguimiento">Seguimiento</Link>.
        </p>
      </div>
    </div>
  </div>
);

export default AboutPage;
