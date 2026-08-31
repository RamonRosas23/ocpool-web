'use client';

import Image from 'next/image';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, DirectionalIcon } from '@/components/DirectionalIcon';
import { projects, type Project } from '@/lib/pool-content';

type ProjectFilter = 'Todos' | 'Entregados' | 'Con etapas' | 'En desarrollo';

const filters: ProjectFilter[] = ['Todos', 'Entregados', 'Con etapas', 'En desarrollo'];

function matchesFilter(project: Project, filter: ProjectFilter) {
  if (filter === 'Todos') return true;
  if (filter === 'Entregados') return project.status === 'Entregado';
  if (filter === 'En desarrollo') return project.status === 'En desarrollo';
  return project.phases.length > 1;
}

function getCardLayout(index: number) {
  const position = index % 3;
  if (position === 0) return 'project-card--wide';
  if (position === 1) return 'project-card--compact';
  return '';
}

function ProjectCard({ project, index, featured, onOpen }: { project: Project; index: number; featured: boolean; onOpen: (project: Project, button: HTMLButtonElement) => void }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const animationDelay = Math.min(index * 70, 360) / 1000;

  if (featured) {
    return (
      <motion.article ref={cardRef} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.62, delay: animationDelay, ease: [0.2, 0.65, 0.3, 1] }} className="project-card project-card--featured">
        <div className="project-card__feature-media">
          <Image src={project.image} alt={project.imageAlt} fill sizes="(max-width: 800px) 100vw, 66vw" className="media-cover" />
          <div className="project-card__feature-stamp"><span>01</span><span>Caso documentado</span></div>
          <div className="project-card__feature-caption">CDP: de la propuesta a la entrega.</div>
        </div>
        <div className="project-card__feature-panel">
          <div className="project-card__feature-meta"><span>{project.category}</span><span>{project.status}</span></div>
          <p className="project-card__location">{project.location} · {project.year}</p>
          <h3>{project.title}</h3>
          <p className="project-card__summary">{project.summary}</p>
          <div className="project-card__phase-line">
            <span>Registro incluido</span>
            <ol>
              {project.phases.map((phase, phaseIndex) => (
                <li key={phase.label}><b>{String(phaseIndex + 1).padStart(2, '0')}</b>{phase.label}</li>
              ))}
            </ol>
          </div>
          <button className="text-link" type="button" onClick={(event) => onOpen(project, event.currentTarget)}>
            Ver ficha del proyecto <DirectionalIcon />
          </button>
        </div>
      </motion.article>
    );
  }

  return (
    <motion.article ref={cardRef} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.62, delay: animationDelay, ease: [0.2, 0.65, 0.3, 1] }} className={`project-card ${getCardLayout(index)}`}>
      <div className="project-card__media">
        <Image src={project.image} alt={project.imageAlt} fill sizes="(max-width: 800px) 100vw, 33vw" className="media-cover" />
        <div className="project-card__shade" />
        <div className="project-card__topline"><span>{project.category}</span><span>{project.status}</span></div>
      </div>
      <div className="project-card__copy">
        <p className="project-card__location">{project.location} {project.year !== '—' ? `· ${project.year}` : ''}</p>
        <h3>{project.title}</h3>
        <p className="project-card__summary">{project.summary}</p>
        <button className="text-link text-link--card" type="button" onClick={(event) => onOpen(project, event.currentTarget)}>
          Ver ficha del proyecto <DirectionalIcon />
        </button>
      </div>
    </motion.article>
  );
}

export default function ProjectShowcase() {
  const [activeFilter, setActiveFilter] = useState<ProjectFilter>('Todos');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const visibleProjects = projects.filter((project) => matchesFilter(project, activeFilter));

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const closeProject = useCallback((restoreFocus = true) => {
    setActiveProject(null);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const backgroundNodes = Array.from(document.body.children)
      .filter((element) => element !== dialog.closest('.project-dialog-layer'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    const previousInert = new Map<HTMLElement, string | null>();
    backgroundNodes.forEach((element) => {
      previousInert.set(element, element.getAttribute('inert'));
      element.setAttribute('inert', '');
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeProject();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        firstElement.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      previousInert.forEach((value, element) => {
        if (value === null) element.removeAttribute('inert');
        else element.setAttribute('inert', value);
      });
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeProject, closeProject]);

  const openProject = (project: Project, button: HTMLButtonElement) => {
    triggerRef.current = button;
    setActiveProject(project);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="project-showcase">
      <div className="project-index-bar"><span>Selecciona una ficha para revisar imágenes, alcance y referencias</span><span aria-live="polite">{String(visibleProjects.length).padStart(2, '0')} fichas</span></div>
      <div className="project-filters" role="group" aria-label="Filtrar proyectos">
        {filters.map((filter) => (
          <button key={filter} type="button" className={`filter-button ${activeFilter === filter ? 'filter-button--active' : ''}`} aria-pressed={activeFilter === filter} onClick={() => setActiveFilter(filter)}>
            {activeFilter === filter && <motion.span className="filter-button__active" layoutId="active-project-filter" aria-hidden="true" />}
            <span className="filter-button__label">{filter}</span>
          </button>
        ))}
      </div>

      <div className="project-grid">
        <AnimatePresence mode="popLayout" initial={false}>
          {visibleProjects.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} featured={activeFilter === 'Todos' && index === 0} onOpen={openProject} />
          ))}
        </AnimatePresence>
      </div>

      {visibleProjects.length === 0 && <p className="project-empty">No hay casos publicados en esta categoría.</p>}

      {portalTarget && createPortal(
          <AnimatePresence>
            {activeProject && (
              <motion.div
                key={activeProject.id}
                className="project-dialog-layer"
                role="presentation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closeProject();
                }}
              >
                <motion.section
                  ref={dialogRef}
                  className="project-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`project-dialog-title-${activeProject.id}`}
                  tabIndex={-1}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.26, ease: [0.2, 0.65, 0.3, 1] }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="project-dialog__header">
                    <div>
                      <p className="section-kicker section-kicker--dark">{activeProject.category} / {activeProject.status}</p>
                      <h2 id={`project-dialog-title-${activeProject.id}`}>{activeProject.title}</h2>
                      <p>{activeProject.location} {activeProject.year !== '—' ? `· ${activeProject.year}` : ''}</p>
                    </div>
                    <button ref={closeButtonRef} className="dialog-close" type="button" onClick={() => closeProject()} aria-label="Cerrar proyecto"><CloseIcon /></button>
                  </div>
                  <div className="project-dialog__body">
                    <div className="project-dialog__intro"><p>{activeProject.summary}</p><div className="capability-list" aria-label="Capacidades del proyecto">{activeProject.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div></div>
                    <div className="phase-list">{activeProject.phases.map((phase) => <figure className="project-dialog__phase" key={phase.label}><div className="project-dialog__phase-media"><Image src={phase.image} alt={phase.alt} fill sizes="(max-width: 800px) 100vw, 45vw" className="media-cover" /></div><figcaption><span>{phase.label}</span><DirectionalIcon /></figcaption></figure>)}</div>
                    <div className="gallery-heading"><p className="section-kicker section-kicker--dark">Registro del proyecto</p><span>{activeProject.gallery.length} vistas disponibles</span></div>
                    <div className="project-gallery" aria-label={`Registro visual de ${activeProject.title}`}>
                      {activeProject.gallery.map((media) => (
                        <figure className={`project-gallery__item project-gallery__item--${media.kind}`} key={media.src}>
                          <div className="project-gallery__media"><Image src={media.src} alt={media.alt} fill sizes="(max-width: 800px) 100vw, 33vw" className="media-cover" /></div>
                          <figcaption><span>{media.label}</span><DirectionalIcon /></figcaption>
                        </figure>
                      ))}
                    </div>
                    <a className="button button--dark" href="#contacto" onClick={() => closeProject(false)}>Solicitar un proyecto similar <DirectionalIcon /></a>
                  </div>
                </motion.section>
              </motion.div>
            )}
          </AnimatePresence>,
        portalTarget,
      )}
      </div>
    </MotionConfig>
  );
}
