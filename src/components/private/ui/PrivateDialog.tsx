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

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex="0"]'));
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
    if (modal) document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
      if (modal) document.body.style.overflow = previousOverflow;
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
