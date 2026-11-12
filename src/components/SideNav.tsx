import { NavLink, useNavigate } from 'react-router-dom';
import { tabs } from './BottomNav';
import { Icon } from './Icon';

/** Left-hand navigation for laptops and desktops. Hidden on phones and tablets (see global.css). */
export function SideNav() {
  const nav = useNavigate();
  return (
    <aside className="side-nav" aria-label="main">
      <div className="side-brand">
        <p className="wordmark">unspoken</p>
        <p className="tagline">for everything left unsaid.</p>
      </div>
      <button className="side-record" onClick={() => nav('/record?start=1')}>
        <span className="side-record-icon" aria-hidden="true">
          <Icon name="mic" size={20} />
        </span>
        leave a voicemail
      </button>
      <nav className="side-links">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        <NavLink to="/drafts" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
          <Icon name="draft" />
          <span>unfinished thoughts</span>
        </NavLink>
      </nav>
      <p className="side-foot">
        <Icon name="lock" size={14} /> private by default. everything stays on this device.
      </p>
    </aside>
  );
}
