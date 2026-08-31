import Image from 'next/image';
import Navbar from '@/components/Navbar';
import ProjectShowcase from '@/components/ProjectShowcase';
import QuoteForm from '@/components/QuoteForm';
import RevealObserver from '@/components/RevealObserver';
import { DirectionalIcon } from '@/components/DirectionalIcon';
import { constructionStory, processSteps, services, visualProof, contactDetails } from '@/lib/pool-content';

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'ProfessionalService',
  name: 'OCPOOL',
  url: 'https://www.ocpool.com/',
  email: 'info@ocpool.com',
  telephone: '+52 667 453 2567',
  description: 'Diseño y construcción de albercas, jacuzzis y espacios acuáticos.',
  areaServed: 'MX',
  serviceType: ['Diseño y construcción de albercas', 'Rehabilitación de albercas', 'Sistemas hidráulicos', 'Iluminación arquitectónica y subacuática'],
};

function Arrow() {
  return <DirectionalIcon />;
}

type ProfileIconType = 'residencial' | 'hospitalidad' | 'existente';

function ProfileIcon({ type }: { type: ProfileIconType }) {
  const iconProps = {
    className: 'manifesto__profile-icon',
    'data-profile-icon': type,
    viewBox: '0 0 96 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.2',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };

  if (type === 'residencial') {
    return (
      <svg {...iconProps}>
        <path d="M10 37h76M16 33V17h25v16M41 17V10h29v23M70 33V23h11v10" />
        <path d="M16 22h25M29 17v16M52 17v16M61 17v16M15 41h66" />
      </svg>
    );
  }

  if (type === 'hospitalidad') {
    return (
      <svg {...iconProps}>
        <path d="M8 36h80M13 31h70M18 31v-8h19v8M37 23h29v8M66 31v-6h13v6" />
        <path d="M21 23v-8h12v8M50 23V12h10v11M70 25v-6h8" />
        <path d="M14 12h68M20 8h56" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <path d="M9 37h78M15 33V19l14-10 14 10v14M43 33V19l14-10 14 10v14" />
      <path d="M16 41h68M23 24h12M50 24h12M29 9v-4M57 9v-4" />
      <path d="M75 14l7-7M82 7l-2 5M82 7l-5-1" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <Navbar />
      <RevealObserver />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <main id="contenido" tabIndex={-1}>
        <section id="inicio" className="hero">
          <Image
            src="/proyectos/cdp/gallery/final-02.png"
            alt="Piscina terminada del Club de Playa CDP frente al mar"
            fill
            priority
            fetchPriority="high"
            sizes="100vw"
            className="hero__image"
          />
          <div className="hero__veil" />
          <div className="hero__grain" />
          <div className="hero__content page-shell">
            <div className="hero__copy" data-reveal="hero-copy">
              <p className="eyebrow eyebrow--light" data-reveal="hero-kicker"><span className="eyebrow__line" /> OCPOOL / Diseño y construcción</p>
              <h1 data-reveal="hero-title">Albercas diseñadas para <em>durar y funcionar.</em></h1>
              <p className="hero__lede" data-reveal="hero-lede">Diseñamos y construimos albercas para residencias, hoteles y clubes de playa.</p>
              <div className="hero__actions" data-reveal="hero-actions">
                <a className="button button--light" href="#proyectos">Ver proyectos <Arrow /></a>
                <a className="button button--text-light" href="#contacto">Solicitar cotización <Arrow /></a>
              </div>
            </div>
            <div className="hero__rail" data-reveal="hero-rail">
              <div className="hero__rail-item"><strong>10+</strong><span>años de experiencia<br />del equipo</span></div>
              <div className="hero__rail-item"><strong>05</strong><span>especialidades integradas<br />en cada proyecto</span></div>
              <p className="hero__location">CDP · Islas Marías<br />Nayarit / 2024</p>
            </div>
          </div>
          <a className="hero__scroll" data-reveal="hero-scroll" href="#manifiesto"><span className="hero__scroll-dot" /> Ver alcance</a>
        </section>

        <section id="manifiesto" className="manifesto page-section" data-section-motif="field-notes">
          <div className="page-shell manifesto__grid" data-reveal="section">
            <div className="manifesto__mark" aria-hidden="true"><DirectionalIcon direction="down-right" className="manifesto__mark-icon" /></div>
            <div>
              <p className="eyebrow">Alcance completo</p>
              <h2>Una sola coordinación para resolver la <em>alberca.</em></h2>
            </div>
            <div className="manifesto__body">
              <p>Definimos el diseño, la obra, el sistema hidráulico y la iluminación desde el principio. Así se reducen decisiones improvisadas y cada especialidad responde al mismo proyecto.</p>
              <p className="manifesto__aside">Cada decisión considera el uso y el mantenimiento.</p>
            </div>
          </div>
          <div className="page-shell manifesto__profile" aria-label="Tipos de proyecto" data-reveal="section">
            <article data-reveal="card">
              <div className="manifesto__profile-side">
                <p>Residencial</p>
                <ProfileIcon type="residencial" />
              </div>
              <div className="manifesto__profile-copy"><strong>Casas habitación</strong><span>Diseño y ejecución integrados a la arquitectura.</span></div>
            </article>
            <article data-reveal="card">
              <div className="manifesto__profile-side">
                <p>Hospitalidad</p>
                <ProfileIcon type="hospitalidad" />
              </div>
              <div className="manifesto__profile-copy"><strong>Clubes de playa y hoteles</strong><span>Albercas pensadas para flujo, operación y mantenimiento.</span></div>
            </article>
            <article data-reveal="card">
              <div className="manifesto__profile-side">
                <p>Existente</p>
                <ProfileIcon type="existente" />
              </div>
              <div className="manifesto__profile-copy"><strong>Rehabilitación de albercas existentes</strong><span>Corrección de acabados, equipos y funcionamiento.</span></div>
            </article>
          </div>
        </section>

        <section className="proof-section page-section page-section--mist" data-section-motif="bathymetry" aria-labelledby="proof-title">
          <div className="page-shell section-heading" data-reveal="section">
            <div>
              <p className="eyebrow"><span className="eyebrow__line" /> Evidencia de ejecución</p>
              <h2 id="proof-title">La ejecución, en <em>imágenes.</em></h2>
            </div>
            <p>Revisa el resultado, la obra y los detalles que sostienen cada proyecto. Una referencia concreta del nivel de ejecución de OCPOOL.</p>
          </div>
          <div className="page-shell proof-grid" data-reveal="section">
            {visualProof.map((item, index) => (
              <figure className={`proof-card proof-card--${index + 1}`} data-reveal="card" key={item.label}>
                <div className="proof-card__media"><Image src={item.src} alt={item.alt} fill sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 25vw" className="media-cover" /></div>
                <figcaption><span>{item.label}</span><strong>{item.caption}</strong></figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="proyectos" className="projects-section page-section page-section--dark" data-section-motif="orbit">
          <div className="page-shell section-heading section-heading--dark" data-reveal="section">
            <div>
              <p className="eyebrow eyebrow--light"><span className="eyebrow__line" /> Portafolio</p>
              <h2>Proyectos residenciales y de <em>hospitalidad.</em></h2>
            </div>
            <p>Compara el resultado final, el nivel de avance y el tipo de intervención antes de pedir una cotización.</p>
          </div>
          <div className="page-shell" data-reveal="section"><ProjectShowcase /></div>
        </section>

        <section className="construction-section page-section" data-section-motif="datum" aria-labelledby="construction-title">
          <div className="page-shell section-heading" data-reveal="section">
            <div>
              <p className="eyebrow"><span className="eyebrow__line" /> Caso CDP / Alcance</p>
              <h2 id="construction-title">Del diseño a la puesta en <em>operación.</em></h2>
            </div>
            <p>CDP permite ver tres momentos del trabajo: propuesta, construcción y entrega final. La secuencia muestra qué se resuelve en cada etapa.</p>
          </div>
          <div className="page-shell construction-grid" data-reveal="section" tabIndex={0} aria-label="Secuencia visual del caso CDP: propuesta, obra y entrega">
            {constructionStory.map((item) => (
              <figure className="construction-card" key={item.label}>
                <div className="construction-card__media"><Image src={item.src} alt={item.alt} fill sizes="(max-width: 720px) 100vw, 33vw" className="media-cover" /></div>
                <figcaption><span>{item.label}</span><strong>{item.caption}</strong></figcaption>
              </figure>
            ))}
          </div>
          <div className="page-shell construction-note" data-reveal="section">
            <div>
              <p className="section-kicker">Qué permite revisar este caso</p>
              <h3>La propuesta, la estructura y el acabado final se leen como un solo alcance.</h3>
            </div>
            <div>
              <p>En un proyecto de hospitalidad, la alberca debe responder a la experiencia del lugar y a su operación diaria. Por eso el seguimiento continúa hasta verificar sistema, acabados y entrega.</p>
              <a className="text-link" href="#proyectos">Revisar proyectos <Arrow /></a>
            </div>
          </div>
          <div className="page-shell construction-hint" data-reveal="section">Desliza para revisar propuesta, obra y entrega <DirectionalIcon direction="right" className="construction-hint__icon" /></div>
        </section>

        <section id="servicios" className="services-section page-section" data-section-motif="hydraulic-plan">
          <div className="page-shell section-heading" data-reveal="section">
            <div>
              <p className="eyebrow"><span className="eyebrow__line" /> Servicios</p>
              <h2>Una solución completa para la <em>alberca.</em></h2>
            </div>
            <p>Desde una obra nueva hasta una alberca existente: coordinamos diseño, estructura, agua, iluminación y acabados para que el resultado funcione y se mantenga claro.</p>
          </div>
          <div className="page-shell services-outcomes" data-reveal="section">
            <div className="services-outcomes__intro">
              <p className="section-kicker">Lo que queda resuelto</p>
              <h3>La estética y la operación se deciden juntas.</h3>
            </div>
            <div className="services-outcomes__items">
              <article>
                <span>01</span>
                <div><strong>Decisiones alineadas</strong><p>Geometría, materiales y uso parten del mismo criterio.</p></div>
              </article>
              <article>
                <span>02</span>
                <div><strong>Sistema especificado</strong><p>Circulación, filtración e iluminación se resuelven para operar y mantener.</p></div>
              </article>
              <article>
                <span>03</span>
                <div><strong>Entrega verificable</strong><p>La alberca se prueba y se entrega lista para integrarse a la rutina del espacio.</p></div>
              </article>
            </div>
          </div>
          <div className="page-shell services-list" data-reveal="section">
            {services.map((service) => (
              <article className="service-row" key={service.title}>
                <p className="service-row__eyebrow">{service.eyebrow}</p>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
                <div className="service-row__media"><Image src={service.image} alt={service.imageAlt} fill sizes="(max-width: 720px) calc(100vw - 32px), 176px" className="media-cover" /></div>
                <a href="#contacto" aria-label={`Cotizar ${service.title}`}><span className="service-row__cta-label">Cotizar servicio</span><Arrow /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="process-section page-section page-section--mist" data-section-motif="route">
          <div className="page-shell process-layout" data-reveal="section">
            <div className="process-intro">
              <p className="eyebrow"><span className="eyebrow__line" /> Cómo se desarrolla</p>
              <h2>Un proceso que evita <em>sorpresas.</em></h2>
              <p>Antes de construir dejamos claro el alcance, el sistema y las decisiones que afectan costo, funcionamiento y mantenimiento.</p>
              <div className="process-intro__note">
                <span>Antes de empezar</span>
                <strong>Qué se construye, cómo funcionará y quién coordina cada parte.</strong>
              </div>
              <figure className="process-proof"><div className="process-proof__media"><Image src="/proyectos/cdp/gallery/obra-02.jpg" alt="Avance de estructura en el Club de Playa CDP" fill sizes="(max-width: 720px) 100vw, 36vw" className="media-cover" /></div><figcaption>En sitio · estructura y preparación de instalaciones</figcaption></figure>
            </div>
            <div className="process-list">
              {processSteps.map((step) => (
                <article className="process-step" key={step.number}>
                  <span className="process-step__number">{step.number}</span>
                  <div className="process-step__content">
                    <div className="process-step__topline"><span>{step.focus}</span><span>Se define: {step.deliverable}</span></div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="nosotros" className="about-section page-section" data-section-motif="ripples">
          <div className="page-shell about-grid" data-reveal="section">
            <div className="about-image">
              <Image src="/proyectos/asipona/hero.png" alt="Piscina residencial ASIPONA iluminada durante la noche" fill sizes="(max-width: 800px) 100vw, 50vw" className="media-cover" />
              <span>Casa habitación ASIPONA · entrega nocturna.</span>
            </div>
            <div className="about-copy">
              <p className="eyebrow"><span className="eyebrow__line" /> OCPOOL</p>
              <h2>Un equipo técnico para proyectos <em>exigentes.</em></h2>
              <p>OCPOOL desarrolla y construye albercas para espacios residenciales y de hospitalidad. Combinamos diseño, ingeniería y ejecución para que las decisiones estéticas no queden separadas de la operación.</p>
              <div className="about-note">
                <span className="about-note__eyebrow">Coordinación integral</span>
                <strong>Diseño · obra · sistemas</strong>
                <span className="about-note__copy">Un mismo alcance para que cada decisión llegue completa a la obra.</span>
              </div>
              <a className="text-link" href="#contacto">Solicitar una valoración <Arrow /></a>
            </div>
          </div>
        </section>

        <section id="contacto" className="contact-section page-section page-section--sand" data-section-motif="coordinates">
          <div className="page-shell section-heading section-heading--contact" data-reveal="section">
            <div>
              <p className="eyebrow"><span className="eyebrow__line" /> Cotización</p>
              <h2>Cuéntanos qué necesitas <em>construir.</em></h2>
            </div>
            <p>Indica ubicación, tipo de obra y estado actual. Con esos datos podemos revisar el alcance y orientarte sobre la cotización.</p>
          </div>
          <div className="page-shell" data-reveal="section"><QuoteForm /></div>
        </section>
      </main>

      <footer className="site-footer" data-section-motif="horizon">
        <div className="page-shell footer-main">
          <div className="footer-intro" data-reveal="section">
            <div>
              <p className="footer-kicker"><span className="eyebrow__line" /> OCPOOL / Siguiente proyecto</p>
              <h2>Cada proyecto acuático bien pensado <em>se nota.</em></h2>
            </div>
            <a className="footer-cta" href="#contacto">Iniciar conversación <Arrow /></a>
          </div>
          <div className="footer-columns">
            <div className="footer-brand">
              <div className="footer-wordmark"><Image src="/brand/ocpool-logo-white.png" alt="OCPOOL" width={222} height={166} className="footer-wordmark__logo" /><span><strong>OCPOOL</strong><small>Albercas / Ingeniería</small></span></div>
              <p>Diseño, obra y sistemas coordinados.</p>
            </div>
            <div className="footer-nav">
              <p className="footer-label">Explorar</p>
              <a href="#proyectos">Proyectos</a><a href="#servicios">Servicios</a><a href="#nosotros">Nosotros</a><a href="#contacto">Cotizar</a>
            </div>
            <div className="footer-contact">
              <p className="footer-label">Contacto</p>
              <a href={`mailto:${contactDetails.email}`}>{contactDetails.email}</a>
              <a href={contactDetails.phoneHref}>{contactDetails.phone}</a>
              <a href={contactDetails.website} target="_blank" rel="noreferrer">ocpool.com <Arrow /></a>
              <a href={contactDetails.whatsappHref} target="_blank" rel="noreferrer">WhatsApp <Arrow /></a>
            </div>
          </div>
        </div>
        <div className="page-shell footer-bottom"><span>© 2026 OCPOOL</span><span>Diseño, obra y sistemas.</span></div>
      </footer>
    </>
  );
}
