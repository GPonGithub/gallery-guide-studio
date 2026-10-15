/**
 * The solid, filled ▼ used on every dropdown in the studio (Start at, Music,
 * Voice), so they read as menus. Points up while its menu is open.
 */
export function DropdownArrow({ open = false, className = '' }: { open?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 6"
      width="10"
      height="6"
      aria-hidden="true"
      className={`inline-block shrink-0 fill-current transition-transform duration-150 ${open ? 'rotate-180' : ''} ${className}`}
    >
      <path d="M0 0h10L5 6z" />
    </svg>
  );
}
