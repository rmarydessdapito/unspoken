import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

const tabs = [
  { to: '/', label: 'home', icon: 'home', end: true },
  { to: '/library', label: 'my unspoken', icon: 'library' },
  { to: '/echoes', label: 'little echoes', icon: 'echo' },
  { to: '/you', label: 'you', icon: 'you' },
];

export function BottomNav() {
  const nav = useNavigate();
  const tab = (t: (typeof tabs)[number]) => (
    <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon name={t.icon} />
      <span>{t.label}</span>
    </NavLink>
  );
  return (
    <nav className="bottom-nav" aria-label="main">
      {tab(tabs[0])}
      {tab(tabs[1])}
      <button className="nav-record" onClick={() => nav('/record?start=1')} aria-label="leave a voicemail">
        <Icon name="mic" size={26} />
      </button>
      {tab(tabs[2])}
      {tab(tabs[3])}
    </nav>
  );
}
