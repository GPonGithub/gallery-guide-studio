/** A small spinning wheel, for buttons whose work is under way. Takes the text colour. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={`inline-block shrink-0 animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
