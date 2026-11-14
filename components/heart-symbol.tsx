// One silhouette for every heart: colorless is the same path with no fill.
// This is a simple original UI symbol, not an official card image.
export function HeartSymbol({ color, className = '' }: { color: string; className?: string }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={`heart heart-symbol ${className}`}>
    <path d="M12 21C10 19 2 13.5 2 7.5C2 2.5 8 1 12 6C16 1 22 2.5 22 7.5C22 13.5 14 19 12 21Z"
      fill={color === 'any' ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}
