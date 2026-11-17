import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Home from './pages/Home.jsx';
import Submit from './pages/Submit.jsx';
import Projects from './pages/Projects.jsx';
import SignIn from './pages/SignIn.jsx';
import SetPassword from './pages/SetPassword.jsx';

const PAGE_NAMES = {
  '/submit': 'Submit an Enhancement',
  '/projects': 'Projects',
  '/signin': 'Sign In',
  '/set-password': 'Choose a Password',
};

function Breadcrumbs() {
  const { pathname } = useLocation();
  const current = PAGE_NAMES[pathname.replace(/\/+$/, '')] || (pathname === '/' ? null : 'Page Not Found');
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="wrap">
        {current ? (
          <>
            <li><Link to="/">Home</Link></li>
            <li aria-current="page">{current}</li>
          </>
        ) : (
          <li aria-current="page">Home</li>
        )}
      </ol>
    </nav>
  );
}

export default function App() {
  // undefined = still checking, null = signed out, object = signed in
  const [user, setUser] = useState(undefined);
  const [domain, setDomain] = useState('sil.org');
  const navigate = useNavigate();

  useEffect(() => {
    api('/auth/me')
      // Anything other than a user object (e.g. an older server's reply) counts as signed out, never "still loading".
      .then((d) => { setUser(d && d.user ? d.user : null); if (d && d.domain) setDomain(d.domain); })
      .catch(() => setUser(null));
  }, []);

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    // Always land on the sign-in page; replace so Back doesn't return to the signed-in view.
    navigate('/signin', { replace: true });
  }

  return (
    <>
      {/* Header modeled on software.sil.org (light header): logo + title bar, menu row, breadcrumbs. */}
      <header className="site-header">
        <div className="wrap header-top">
          <div className="header-brand">
            {/* Official SIL logo artwork as published on software.sil.org. Never redraw or recolor it. */}
            <Link to="/" className="header-logo" title="Home">
              <img src="/sil-logo-glyph.png" alt="SIL" width="78" height="42" />
            </Link>
            <div className="header-titles">
              <Link to="/" className="header-title">Project Enhancements</Link>
              <span className="header-subtitle">SIL Software Projects</span>
            </div>
          </div>
          <div className="header-actions">
            {user ? (
              <>
                <span className="header-user" title={user.email}>
                  {user.name}{user.is_staff && <span className="header-role">Staff</span>}
                </span>
                <button className="header-pill" onClick={signOut}>Sign out</button>
              </>
            ) : user === null ? (
              <Link to="/signin" className="header-pill">Sign in</Link>
            ) : null}
          </div>
        </div>
        <nav className="header-menu" aria-label="Main">
          <div className="wrap">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/submit">Submit</NavLink>
            <NavLink to="/projects">Projects</NavLink>
          </div>
        </nav>
      </header>
      <Breadcrumbs />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/submit" element={<Submit user={user} />} />
          <Route path="/projects" element={<Projects user={user} />} />
          <Route path="/signin" element={<SignIn user={user} domain={domain} onSignIn={setUser} />} />
          <Route path="/set-password" element={<SetPassword onSignIn={setUser} />} />
          <Route path="/staff" element={<Navigate to="/signin" replace />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
      <footer className="site-footer wrap muted">
        <p className="tagline">Language for Good</p>
        <p>
          SIL is a global faith-based nonprofit that partners with local language communities to develop
          language solutions that expand their possibilities for a better life.
        </p>
      </footer>
    </>
  );
}
