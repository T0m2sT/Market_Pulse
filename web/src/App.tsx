import { useRef, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import Today from "./views/Today";
import News from "./views/News";
import Earnings from "./views/Earnings";
import Returns from "./views/Returns";
import Dividends from "./views/Dividends";
import Holdings from "./views/Holdings";
import Settings from "./views/Settings";
import Briefing from "./views/Briefing";
import { TodayIcon, NewsIcon, EarningsIcon, ReturnsIcon, DividendsIcon } from "./components/TabIcons";
import "./App.css";

const TABS = [
  { to: "/", label: "Today", end: true, Icon: TodayIcon },
  { to: "/news", label: "News", Icon: NewsIcon },
  { to: "/earnings", label: "Earnings", Icon: EarningsIcon },
  { to: "/returns", label: "Returns", Icon: ReturnsIcon },
  { to: "/dividends", label: "Dividends", Icon: DividendsIcon },
];

// Detail screens pushed from a tab (not top-level destinations) hide the top bar's tabs,
// so they read as "back to where I came from" rather than a tab switch.
const DETAIL_PREFIXES = ["/holdings", "/briefing/", "/settings"];

function isDetailRoute(pathname: string): boolean {
  return DETAIL_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const detail = isDetailRoute(location.pathname);

  return (
    <header className="top-bar">
      {detail ? (
        <button className="top-bar-back" onClick={() => navigate(-1)}>
          ← Back
        </button>
      ) : (
        <div className="brand">
          <img src="/apple-touch-icon.png" alt="" className="brand-icon" />
          <span className="brand-name">Market Pulse</span>
        </div>
      )}
      <button className="settings-gear" onClick={() => navigate("/settings")} aria-label="Settings">
        ⚙
      </button>
    </header>
  );
}

function BottomNav() {
  const location = useLocation();
  if (isDetailRoute(location.pathname)) return null;

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `bottom-nav-item${isActive ? " bottom-nav-item--active" : ""}`}
        >
          <tab.Icon />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const SWIPE_THRESHOLD_PX = 60;
const SWIPE_MAX_VERTICAL_PX = 50;

function SwipeableContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const tabIndex = TABS.findIndex((t) => (t.end ? location.pathname === t.to : location.pathname.startsWith(t.to)));
  const detail = isDetailRoute(location.pathname);
  const swipeable = tabIndex !== -1 || detail;

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeable) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    // Only detail screens get the drag-to-go-back follow effect.
    if (!detail || !touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    if (dx > 0 && Math.abs(dy) < Math.abs(dx)) {
      setDragging(true);
      setDragX(dx);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    setDragging(false);
    setDragX(0);
    if (!swipeable || !touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;

    // On a detail screen, a rightward swipe (mostly horizontal, past threshold) goes back.
    if (detail) {
      if (dx > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) navigate(-1);
      return;
    }

    if (Math.abs(dy) > SWIPE_MAX_VERTICAL_PX || Math.abs(dx) < SWIPE_THRESHOLD_PX) return;

    const nextIndex = dx < 0 ? tabIndex + 1 : tabIndex - 1;
    if (nextIndex >= 0 && nextIndex < TABS.length) navigate(TABS[nextIndex].to);
  };

  return (
    <main
      className="app-content"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={
        dragX > 0
          ? {
              transform: `translateX(${dragX}px)`,
              opacity: Math.max(0.4, 1 - dragX / 400),
              transition: dragging ? "none" : "transform 200ms ease-out, opacity 200ms ease-out",
            }
          : undefined
      }
    >
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/news" element={<News />} />
        <Route path="/briefing/:ticker/:weekStart" element={<Briefing />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/dividends" element={<Dividends />} />
        <Route path="/holdings" element={<Holdings />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <TopBar />
        <SwipeableContent />
        <BottomNav />
      </div>
    </BrowserRouter>
  );
}
