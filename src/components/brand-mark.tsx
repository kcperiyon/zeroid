export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0a2463" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="#ffffff" strokeWidth="2.6" />
      <path d="M11 21 21 11" stroke="#5b8cff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
