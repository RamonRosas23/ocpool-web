export type ProjectStatus = 'Entregado' | 'En desarrollo';
export type ProjectCategory = 'Residencial' | 'Hospitalidad';
export type MediaKind = 'render' | 'obra' | 'final';

export type ProjectMedia = {
  src: string;
  alt: string;
  label: string;
  kind: MediaKind;
};

export type ProjectPhase = {
  label: string;
  image: string;
  alt: string;
};

export type Project = {
  id: string;
  title: string;
  location: string;
  year: string;
  status: ProjectStatus;
  category: ProjectCategory;
  summary: string;
  image: string;
  imageAlt: string;
  phases: ProjectPhase[];
  gallery: ProjectMedia[];
  capabilities: string[];
};

export type Service = {
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

export type ProcessStep = {
  number: string;
  focus: string;
  title: string;
  description: string;
  outcome: string;
};

export type ProofItem = {
  src: string;
  alt: string;
  label: string;
  caption: string;
};

export const contactDetails = {
  email: 'info@ocpool.com',
  phone: '667 453 2567',
  phoneHref: 'tel:+526674532567',
  whatsappHref: 'https://wa.me/526674532567',
  website: 'https://www.ocpool.com',
};

const cdpGallery: ProjectMedia[] = [
  { src: '/proyectos/cdp/gallery/render-01.jpg', alt: 'Render general del Club de Playa CDP', label: 'Propuesta 01', kind: 'render' },
  { src: '/proyectos/cdp/gallery/render-02.jpg', alt: 'Render de la alberca del Club de Playa CDP', label: 'Propuesta 02', kind: 'render' },
  { src: '/proyectos/cdp/gallery/render-03.jpg', alt: 'Render de terrazas y áreas exteriores del Club de Playa CDP', label: 'Propuesta 03', kind: 'render' },
  { src: '/proyectos/cdp/gallery/render-04.jpg', alt: 'Render nocturno del Club de Playa CDP', label: 'Propuesta 04', kind: 'render' },
  { src: '/proyectos/cdp/gallery/obra-01.jpg', alt: 'Preparación de obra para la alberca del Club de Playa CDP', label: 'Obra 01', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-02.jpg', alt: 'Construcción de la alberca del Club de Playa CDP', label: 'Obra 02', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-03.jpg', alt: 'Avance de obra en la estructura de la alberca del Club de Playa CDP', label: 'Obra 03', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-04.jpg', alt: 'Instalaciones de la alberca del Club de Playa CDP', label: 'Obra 04', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-05.jpg', alt: 'Proceso constructivo del Club de Playa CDP', label: 'Obra 05', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-06.jpg', alt: 'Acabados en proceso del Club de Playa CDP', label: 'Obra 06', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-13.png', alt: 'Excavación de la alberca del Club de Playa CDP', label: 'Excavación', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-18.jpg', alt: 'Armado estructural de la alberca del Club de Playa CDP', label: 'Estructura', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/obra-20.jpeg', alt: 'Instalación del acabado interior de la alberca del Club de Playa CDP', label: 'Acabado en obra', kind: 'obra' },
  { src: '/proyectos/cdp/gallery/final-01.png', alt: 'Detalle terminado de la alberca del Club de Playa CDP', label: 'Entrega 01', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-02.png', alt: 'Vista terminada del Club de Playa CDP', label: 'Entrega 02', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-03.png', alt: 'Alberca terminada del Club de Playa CDP', label: 'Entrega 03', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-04.jpeg', alt: 'Alberca del Club de Playa CDP frente al océano', label: 'Entrega 04', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-05.jpeg', alt: 'Terraza y alberca terminadas del Club de Playa CDP', label: 'Entrega 05', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-06.jpeg', alt: 'Espacio exterior terminado del Club de Playa CDP', label: 'Entrega 06', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-07.jpeg', alt: 'Vista lateral de la alberca terminada del Club de Playa CDP', label: 'Entrega 07', kind: 'final' },
  { src: '/proyectos/cdp/gallery/final-08.jpeg', alt: 'Vista amplia de la obra terminada del Club de Playa CDP', label: 'Entrega 08', kind: 'final' },
];

const closterGallery: ProjectMedia[] = [
  { src: '/proyectos/closter/gallery/render-01.jpeg', alt: 'Render general de la Alberca Closter', label: 'Propuesta 01', kind: 'render' },
  { src: '/proyectos/closter/gallery/render-02.jpeg', alt: 'Render de la sala hundida de la Alberca Closter', label: 'Propuesta 02', kind: 'render' },
  { src: '/proyectos/closter/gallery/render-03.jpeg', alt: 'Render nocturno de la Alberca Closter', label: 'Propuesta 03', kind: 'render' },
  { src: '/proyectos/closter/gallery/final-01.png', alt: 'Vista terminada de la Alberca Closter', label: 'Entrega 01', kind: 'final' },
  { src: '/proyectos/closter/gallery/final-02.png', alt: 'Alberca Closter con palapas y vegetación', label: 'Entrega 02', kind: 'final' },
  { src: '/proyectos/closter/gallery/final-03.jpeg', alt: 'Áreas exteriores terminadas de la Alberca Closter', label: 'Entrega 03', kind: 'final' },
  { src: '/proyectos/closter/gallery/final-04.jpeg', alt: 'Sala hundida junto a la Alberca Closter', label: 'Entrega 04', kind: 'final' },
  { src: '/proyectos/closter/gallery/final-05.jpeg', alt: 'Detalle de acabados de la Alberca Closter', label: 'Entrega 05', kind: 'final' },
  { src: '/proyectos/closter/gallery/final-06.jpeg', alt: 'Paisaje y área de convivencia de la Alberca Closter', label: 'Entrega 06', kind: 'final' },
];

export const projects: Project[] = [
  {
    id: 'cdp', title: 'Club de Playa CDP', location: 'Islas Marías, Nayarit', year: '2024', status: 'Entregado', category: 'Hospitalidad',
    summary: 'Club de playa con alberca, terrazas e iluminación integradas al frente marítimo.',
    image: '/proyectos/cdp/gallery/final-14.jpeg', imageAlt: 'Piscina terminada del Club de Playa CDP frente al mar',
    phases: [
      { label: 'Propuesta', image: '/proyectos/cdp/gallery/render-01.jpg', alt: 'Render arquitectónico del Club de Playa CDP' },
      { label: 'Obra', image: '/proyectos/cdp/gallery/obra-13.png', alt: 'Proceso de construcción de la piscina del Club de Playa CDP' },
      { label: 'Entrega final', image: '/proyectos/cdp/gallery/final-04.jpeg', alt: 'Entrega final de la piscina del Club de Playa CDP' },
    ],
    gallery: cdpGallery, capabilities: ['Construcción integral', 'Equipamiento', 'Iluminación subacuática'],
  },
  {
    id: 'closter', title: 'Alberca Closter', location: 'Puerto Balleto, Islas Marías', year: '2024', status: 'Entregado', category: 'Hospitalidad',
    summary: 'Alberca, sala hundida, fogatero y palapas organizan las áreas de convivencia.',
    image: '/proyectos/closter/gallery/final-06.jpeg', imageAlt: 'Alberca terminada del proyecto Closter con palapas y paisaje tropical',
    phases: [
      { label: 'Propuesta', image: '/proyectos/closter/gallery/render-01.jpeg', alt: 'Render de la alberca Closter' },
      { label: 'Entrega final', image: '/proyectos/closter/gallery/final-06.jpeg', alt: 'Entrega final de la alberca Closter' },
    ],
    gallery: closterGallery, capabilities: ['Diseño de espacio exterior', 'Acabados para áreas húmedas', 'Paisajismo'],
  },
  {
    id: 'asipona', title: 'Casa habitación ASIPONA', location: 'Coatzacoalcos, Veracruz', year: '2024', status: 'Entregado', category: 'Residencial',
    summary: 'Alberca residencial con iluminación nocturna y relación directa entre interior y exterior.',
    image: '/proyectos/asipona/hero.png', imageAlt: 'Piscina residencial ASIPONA iluminada durante la noche',
    phases: [{ label: 'Entrega final', image: '/proyectos/asipona/gallery/final-01.png', alt: 'Vista nocturna de la piscina terminada en Casa habitación ASIPONA' }],
    gallery: [
      { src: '/proyectos/asipona/gallery/final-01.png', alt: 'Piscina residencial ASIPONA iluminada durante la noche', label: 'Entrega 01', kind: 'final' },
      { src: '/proyectos/asipona/gallery/final-02.png', alt: 'Detalle de iluminación de la piscina ASIPONA', label: 'Entrega 02', kind: 'final' },
      { src: '/proyectos/asipona/gallery/final-03.png', alt: 'Área exterior de la casa ASIPONA', label: 'Entrega 03', kind: 'final' },
      { src: '/proyectos/asipona/gallery/final-04.png', alt: 'Vista general de la piscina ASIPONA', label: 'Entrega 04', kind: 'final' },
    ],
    capabilities: ['Construcción', 'Equipamiento', 'Iluminación arquitectónica'],
  },
  {
    id: 'caleras', title: 'Alberca Caleras', location: 'Caleras, Islas Marías', year: '2025', status: 'En desarrollo', category: 'Hospitalidad',
    summary: 'Propuesta de alberca escalonada con borde infinito y vistas hacia el mar.',
    image: '/proyectos/caleras/hero.jpg', imageAlt: 'Render de alberca con borde infinito y vista al mar en Caleras',
    phases: [{ label: 'Propuesta', image: '/proyectos/caleras/gallery/render-01.jpeg', alt: 'Propuesta renderizada de la Alberca Caleras' }],
    gallery: [
      { src: '/proyectos/caleras/gallery/render-01.jpeg', alt: 'Render general de la Alberca Caleras', label: 'Propuesta 01', kind: 'render' },
      { src: '/proyectos/caleras/gallery/render-02.jpeg', alt: 'Planos de agua de la Alberca Caleras', label: 'Propuesta 02', kind: 'render' },
      { src: '/proyectos/caleras/gallery/render-03.jpeg', alt: 'Borde infinito y horizonte de la Alberca Caleras', label: 'Propuesta 03', kind: 'render' },
    ],
    capabilities: ['Diseño arquitectónico', 'Borde infinito', 'Piedra natural'],
  },
  {
    id: 'boca-de-chila', title: 'Club de Playa Boca de Chila', location: 'Boca de Chila, Nayarit', year: '2026', status: 'En desarrollo', category: 'Hospitalidad',
    summary: 'Propuesta de club de playa que integra alberca, palapa y áreas de descanso al paisaje.',
    image: '/proyectos/boca-de-chila/hero-v2.jpg', imageAlt: 'Render de club de playa con alberca y palapa en Boca de Chila',
    phases: [{ label: 'Propuesta', image: '/proyectos/boca-de-chila/gallery/render-01.jpeg', alt: 'Propuesta renderizada del club de playa Boca de Chila' }],
    gallery: [
      { src: '/proyectos/boca-de-chila/gallery/render-01.jpeg', alt: 'Render general del Club de Playa Boca de Chila', label: 'Propuesta 01', kind: 'render' },
      { src: '/proyectos/boca-de-chila/gallery/render-02.jpeg', alt: 'Detalle de la alberca del Club de Playa Boca de Chila', label: 'Propuesta 02', kind: 'render' },
    ],
    capabilities: ['Diseño de club de playa', 'Integración con paisaje', 'Áreas de descanso'],
  },
  {
    id: 'casa-nogal', title: 'Casa Nogal', location: 'Proyecto residencial', year: '—', status: 'En desarrollo', category: 'Residencial',
    summary: 'Alberca rectangular que ordena patio, terrazas, barra exterior y vegetación.',
    image: '/proyectos/casa-nogal/hero.jpg', imageAlt: 'Render de Casa Nogal con piscina, terrazas y vegetación tropical',
    phases: [{ label: 'Propuesta', image: '/proyectos/casa-nogal/gallery/render-01.jpeg', alt: 'Propuesta renderizada para Casa Nogal' }],
    gallery: [
      { src: '/proyectos/casa-nogal/gallery/render-01.jpeg', alt: 'Render general de Casa Nogal', label: 'Propuesta 01', kind: 'render' },
      { src: '/proyectos/casa-nogal/gallery/render-02.jpeg', alt: 'Piscina y terraza de Casa Nogal', label: 'Propuesta 02', kind: 'render' },
      { src: '/proyectos/casa-nogal/gallery/render-03.jpeg', alt: 'Área de descanso de Casa Nogal', label: 'Propuesta 03', kind: 'render' },
      { src: '/proyectos/casa-nogal/gallery/render-04.jpeg', alt: 'Barra exterior y piscina de Casa Nogal', label: 'Propuesta 04', kind: 'render' },
    ],
    capabilities: ['Diseño residencial', 'Paisajismo tropical', 'Iluminación exterior'],
  },
  {
    id: 'casa-salina-cruz', title: 'Casa Salina Cruz', location: 'Salina Cruz, Oaxaca', year: '2025', status: 'En desarrollo', category: 'Residencial',
    summary: 'Alberca longitudinal que conecta las áreas sociales y terrazas de la vivienda.',
    image: '/proyectos/casa-salina-cruz/hero.jpg', imageAlt: 'Render de Casa Salina Cruz con alberca longitudinal y arquitectura contemporánea',
    phases: [{ label: 'Propuesta', image: '/proyectos/casa-salina-cruz/gallery/render-01.jpeg', alt: 'Propuesta renderizada para Casa Salina Cruz' }],
    gallery: [
      { src: '/proyectos/casa-salina-cruz/gallery/render-01.jpeg', alt: 'Render general de Casa Salina Cruz', label: 'Propuesta 01', kind: 'render' },
      { src: '/proyectos/casa-salina-cruz/gallery/render-02.jpeg', alt: 'Alberca longitudinal de Casa Salina Cruz', label: 'Propuesta 02', kind: 'render' },
      { src: '/proyectos/casa-salina-cruz/gallery/render-03.jpeg', alt: 'Terraza y alberca de Casa Salina Cruz', label: 'Propuesta 03', kind: 'render' },
      { src: '/proyectos/casa-salina-cruz/gallery/render-04.jpeg', alt: 'Vista de la arquitectura de Casa Salina Cruz', label: 'Propuesta 04', kind: 'render' },
      { src: '/proyectos/casa-salina-cruz/gallery/render-05.jpeg', alt: 'Vista exterior de Casa Salina Cruz', label: 'Propuesta 05', kind: 'render' },
    ],
    capabilities: ['Diseño residencial', 'Geometría longitudinal', 'Áreas de convivencia'],
  },
];

export const services: Service[] = [
  { eyebrow: '01 / Proyectar', title: 'Diseño y construcción', description: 'Definimos ubicación, geometría, materiales y ejecución de la alberca de acuerdo con la arquitectura y el uso previsto.', image: '/proyectos/cdp/gallery/render-01.jpg', imageAlt: 'Render del diseño integral del Club de Playa CDP' },
  { eyebrow: '02 / Rehabilitar', title: 'Rehabilitación y remodelación', description: 'Revisamos el estado de la alberca existente y definimos las intervenciones necesarias en estructura, acabados y equipos.', image: '/proyectos/cdp/gallery/obra-09.png', imageAlt: 'Instalación de acabado en una alberca en proceso' },
  { eyebrow: '03 / Equipar', title: 'Sistemas hidráulicos', description: 'Especificamos circulación, filtración y equipos para una operación estable y un mantenimiento claro.', image: '/proyectos/cdp/gallery/obra-04.jpg', imageAlt: 'Instalaciones hidráulicas en proceso para una alberca' },
  { eyebrow: '04 / Iluminar', title: 'Iluminación arquitectónica y subacuática', description: 'Definimos puntos y niveles de luz para mejorar seguridad, recorridos y uso nocturno.', image: '/proyectos/asipona/gallery/final-04.png', imageAlt: 'Iluminación subacuática de la piscina ASIPONA' },
  { eyebrow: '05 / Especificar', title: 'Acabados y materiales', description: 'Seleccionamos superficies y componentes según humedad, tránsito, clima y mantenimiento.', image: '/proyectos/cdp/gallery/final-01.png', imageAlt: 'Detalle de acabado terminado en una alberca' },
];

export const processSteps: ProcessStep[] = [
  { number: '01', focus: 'Diagnóstico', title: 'Levantamos el punto de partida', description: 'Revisamos ubicación, terreno, arquitectura, instalaciones existentes y objetivo de uso.', outcome: 'Alcance de intervención' },
  { number: '02', focus: 'Proyecto', title: 'Definimos la propuesta', description: 'Aterrizamos geometría, materiales, sistema hidráulico, iluminación y alcance de obra.', outcome: 'Criterios y especificaciones' },
  { number: '03', focus: 'Coordinación', title: 'Coordinamos la ejecución', description: 'Damos seguimiento a contratistas, instalaciones, acabados y ajustes necesarios en sitio.', outcome: 'Avance controlado' },
  { number: '04', focus: 'Entrega', title: 'Entregamos el sistema', description: 'Verificamos que la alberca y sus equipos queden listos para operar.', outcome: 'Sistema listo para operar' },
];

export const visualProof: ProofItem[] = [
  { src: '/proyectos/cdp/hero.jpg', alt: 'Alberca terminada frente al mar', label: 'Entrega', caption: 'Espacio terminado y listo para operar.' },
  { src: '/proyectos/cdp/obra.jpg', alt: 'Proceso de construcción de una alberca', label: 'Obra', caption: 'Estructura e instalaciones en proceso.' },
  { src: '/proyectos/cdp/gallery/final-01.png', alt: 'Detalle de acabado de una alberca terminada', label: 'Acabado', caption: 'Materiales elegidos para humedad y uso.' },
  { src: '/proyectos/cdp/gallery/final-02.png', alt: 'Alberca iluminada durante la noche', label: 'Iluminación', caption: 'Iluminación prevista para el uso nocturno.' },
];

export const constructionStory: ProofItem[] = [
  { src: '/proyectos/cdp/gallery/render-01.jpg', alt: 'Propuesta renderizada del Club de Playa CDP', label: '01 / Propuesta', caption: 'Definición de volumetría, recorridos y relación con el entorno.' },
  { src: '/proyectos/cdp/gallery/obra-18.jpg', alt: 'Construcción del Club de Playa CDP', label: '02 / Construcción', caption: 'Estructura, instalaciones y acabados coordinados en sitio.' },
  { src: '/proyectos/cdp/hero.jpg', alt: 'Entrega del Club de Playa CDP', label: '03 / Entrega', caption: 'Alberca terminada e integrada al conjunto.' },
];
