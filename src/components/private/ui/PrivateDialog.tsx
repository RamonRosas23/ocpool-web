'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export type PrivateDialogProps = {
  open: boolean;
  onClose: () => void;
  modal?: boolean;
  id?: string;
  labelledBy: string;
  describedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  overlayClassName?: string;
  children: ReactNode;
};

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// Incluye textarea y select: con formularios largos dentro del diálogo (p. ej. "Editar datos"), el
// último control podía ser un textarea y el Tab se escapaba del modal.
function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
}

export function PrivateDialog({ open, onClose, modal = true, id, labelledBy, describedBy, initialFocusRef, className, overlayClassName, children }: PrivateDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocusRef?.current ?? containerRef.current;
    target?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialFocusRef is read only once per open transition
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    if (modal) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Un control anidado (combobox, calendario, select) que ya consumió Escape para cerrar su
        // propio desplegable lo marca con preventDefault: ese Escape no debe cerrar además el diálogo
        // y tirar lo que el usuario llevaba capturado.
        if (event.defaultPrevented) return;
        onClose();
        return;
      }
      if (!modal || event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (modal) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal, onClose, open]);

  if (!open) return null;

  const content = (
    <div id={id} ref={containerRef} className={joinClasses(className)} role="dialog" aria-modal={modal} aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1}>
      {children}
    </div>
  );

  if (!modal) return content;

  return (
    <div className={joinClasses(overlayClassName)} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {content}
    </div>
  );
}
