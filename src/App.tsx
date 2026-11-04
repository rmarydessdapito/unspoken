import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { Background } from './components/Background';
import { BottomNav } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { useOnboarded } from './hooks/useSettings';
import { CollectionDetail } from './screens/CollectionDetail';
import { Customize } from './screens/Customize';
import { Detail } from './screens/Detail';
import { Drafts } from './screens/Drafts';
import { Echoes } from './screens/Echoes';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { Onboarding } from './screens/Onboarding';
import { Record } from './screens/Record';
import { You } from './screens/You';

function Layout() {
  const onboarded = useOnboarded();
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/record') || loc.pathname === '/welcome' || loc.pathname.endsWith('/customize');
  if (onboarded === undefined) return <div className="app" />;
  if (!onboarded && loc.pathname !== '/welcome' && !(loc.state as { fromOnboarding?: boolean } | null)?.fromOnboarding)
    return <Navigate to="/welcome" replace />;
  return (
    <div className={`app ${immersive ? 'is-immersive' : ''}`}>
      <div className="room-light" aria-hidden="true" />
      <Outlet />
      {!immersive && <MiniPlayer />}
      {!immersive && <BottomNav />}
      <Background />
    </div>
  );
}

function RouteError() {
  return (
    <div className="fatal">
      <p className="wordmark">unspoken</p>
      <p>something went quiet for a second. your voicemails are safe on this device.</p>
      <a className="btn btn-gold" href="/">
        take me home
      </a>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/welcome', element: <Onboarding /> },
      { path: '/record', element: <Record /> },
      { path: '/library', element: <Library /> },
      { path: '/drafts', element: <Drafts /> },
      { path: '/echoes', element: <Echoes /> },
      { path: '/you', element: <You /> },
      { path: '/voicemail/:id', element: <Detail /> },
      { path: '/voicemail/:id/customize', element: <Customize /> },
      { path: '/collection/:id', element: <CollectionDetail /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
