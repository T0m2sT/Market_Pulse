function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function TodayIcon() {
  return (
    <IconBase>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <circle cx="8" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function NewsIcon() {
  return (
    <IconBase>
      <path d="M5 4.5h11a2 2 0 0 1 2 2V18a1.5 1.5 0 0 0 1.5 1.5H7A2 2 0 0 1 5 17.5z" />
      <path d="M8 8.5h6M8 12h6M8 15.5h3.5" />
    </IconBase>
  );
}

export function EarningsIcon() {
  return (
    <IconBase>
      <rect x="4" y="12" width="3.4" height="7.5" rx="1" />
      <rect x="10.3" y="7.5" width="3.4" height="12" rx="1" />
      <rect x="16.6" y="4" width="3.4" height="15.5" rx="1" />
    </IconBase>
  );
}

export function ReturnsIcon() {
  return (
    <IconBase>
      <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
      <path d="M14.5 7H20v5.5" />
    </IconBase>
  );
}

export function DividendsIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10a2 2 0 0 1 2-2h1a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h1a2 2 0 0 0 2-2" />
    </IconBase>
  );
}
