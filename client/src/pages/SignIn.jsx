import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

// One page, three modes: sign in, create an account, forgot password (?mode=register|forgot).
// Signing in always lands on the Home page.

export default function SignIn({ user, domain, onSignIn }) {
  const [params, setParams] = useSearchParams();
  const mode = ['register', 'forgot'].includes(params.get('mode')) ? params.get('mode') : 'signin';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);

  function switchMode(m) {
    setError('');
    setSent('');
    const p = new URLSearchParams(params);
    if (m === 'signin') p.delete('mode'); else p.set('mode', m);
    setParams(p, { replace: true });
  }

  if (user) {
    return (
      <section className="card narrow">
        <h1>You're signed in</h1>
        <p>Signed in as {user.name} ({user.email}).</p>
        <div className="hero-actions">
          <Link to="/submit" className="btn btn-p">Submit an enhancement</Link>
          <Link to="/projects" className="btn">Browse projects</Link>
        </div>
      </section>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if ((mode === 'register' || mode === 'forgot') && !email.trim().toLowerCase().endsWith(`@${domain}`)) {
      setError(`Use your @${domain} email address.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const d = await api('/auth/login', { method: 'POST', body: { email, password } });
        onSignIn(d.user);
        navigate('/', { replace: true });
      } else {
        const d = await api(mode === 'register' ? '/auth/register' : '/auth/forgot', {
          method: 'POST', body: mode === 'register' ? { name, email } : { email },
        });
        setSent(d.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="card narrow">
        <h1>Check your email</h1>
        <p>
          If <strong>{email}</strong> can be used here, we've sent it a link.{' '}
          {mode === 'register' ? 'Open it to choose your password and finish creating your account.' : 'Open it to choose a new password.'}
        </p>
        <p className="muted small">The link may take a minute to arrive. Check your junk folder if you don't see it.</p>
        <button className="btn" onClick={() => switchMode('signin')}>Back to sign in</button>
      </section>
    );
  }

  const titles = { signin: 'Sign in', register: 'Create an account', forgot: 'Forgot your password?' };
  return (
    <section className="card narrow">
      <h1>{titles[mode]}</h1>
      {mode === 'signin' && (
        <p className="muted">Anyone with an @{domain} email address can sign in. Your name and email are filled in for you when you submit or request a project.</p>
      )}
      {mode === 'register' && (
        <p className="muted">Enter your name and @{domain} email. We'll email you a link to choose your password; that confirms the address is yours.</p>
      )}
      {mode === 'forgot' && (
        <p className="muted">Enter your @{domain} email and we'll send you a link to choose a new password.</p>
      )}

      <form onSubmit={onSubmit} className="form">
        {mode === 'register' && (
          <label>Your name
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
        )}
        <label>Email
          <input type="email" autoComplete="username" placeholder={`you@${domain}`} value={email}
            onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </label>
        {mode === 'signin' && (
          <label>Password
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-p" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Email me a link' : 'Send reset link'}
        </button>
      </form>

      <p className="auth-switch small">
        {mode === 'signin' && (
          <>
            <button type="button" className="link" onClick={() => switchMode('forgot')}>Forgot password?</button>
            <span aria-hidden="true"> · </span>
            New here? <button type="button" className="link" onClick={() => switchMode('register')}>Create an account</button>
          </>
        )}
        {mode !== 'signin' && (
          <>Already have an account? <button type="button" className="link" onClick={() => switchMode('signin')}>Sign in</button></>
        )}
      </p>
    </section>
  );
}
