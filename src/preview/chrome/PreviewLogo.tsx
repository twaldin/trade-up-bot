export function PreviewLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" fill="#1a1a1a" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#b5f63d" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="#b5f63d" strokeWidth="1.5" />
      <line x1="16" y1="4" x2="16" y2="10" stroke="#b5f63d" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="22" x2="16" y2="28" stroke="#b5f63d" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="16" x2="10" y2="16" stroke="#b5f63d" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="22" y1="16" x2="28" y2="16" stroke="#b5f63d" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.5" fill="#b5f63d" />
    </svg>
  );
}
