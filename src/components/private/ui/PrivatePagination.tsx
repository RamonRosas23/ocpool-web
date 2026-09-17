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
      <button type="button" className="private-pagination__button" disabled={disabled || page <= 1} onClick={onPrevious}>Anterior</button>
      <button type="button" className="private-pagination__button" disabled={disabled || page >= totalPages} onClick={onNext}>Siguiente</button>
    </div>
  );
}
