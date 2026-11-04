import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function PageHeader({ title, back, right, eyebrow }: { title: string; back?: boolean; right?: ReactNode; eyebrow?: string }) {
  const nav = useNavigate();
  return (
    <header className="page-head">
      {back && (
        <button className="icon-btn" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))} aria-label="back">
          <Icon name="back" />
        </button>
      )}
      <div className="page-head-text">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="page-title serif">{title}</h1>
      </div>
      {right && <div className="page-head-right">{right}</div>}
    </header>
  );
}
