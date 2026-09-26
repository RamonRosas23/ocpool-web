import { ChevronLeft, ChevronRight } from 'lucide-react';

export type PrivatePaginationProps = {
  page: number;
  totalPages: number;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export function PrivatePagination({ page, totalPages, disabled = false, onPrevious, onNext }: PrivatePaginationProps) {
  return (
    <div className="private-pagination">
      <button type="button" className="private-pagination__button" disabled={disabled || page <= 1} onClick={onPrevious}><ChevronLeft size={15} aria-hidden="true" />Anterior</button>
      <span className="private-pagination__status" aria-live="polite">Página {page} de {Math.max(totalPages, 1)}</span>
      <button type="button" className="private-pagination__button" disabled={disabled || page >= totalPages} onClick={onNext}>Siguiente<ChevronRight size={15} aria-hidden="true" /></button>
    </div>
  );
}
