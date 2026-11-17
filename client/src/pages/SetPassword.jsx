import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const MIN = 10;

// Opened from the emailed link: finish creating an account, or reset a forgotten password.
export default function SetPassword({ onSignIn }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError('This link is missing its code. Please use the link from your email.'); return; }
    api(`/auth/token?token=${encodeURIComponent(token)}`)
      .then((d) => { setInfo(d); setName(d.name || ''); })
      .catch((e) => setLoadError(e.message));
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < MIN) return setError(`Password must be at least ${MIN} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const d = await api('/auth/set-password', {
        method: 'POST',
        body: { token, password, name: info.purpose === 'verify' ? name : undefined },
      });
      onSignIn(d.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="card narrow">
        <h1>Link not valid</h1>
        <p className="error" role="alert">{loadError}</p>
        <p>Links work once and expire after a while.</p>
        <div className="hero-actions">
          <Link to="/signin?mode=forgot" className="btn btn-p">Send a new link</Link>
          <Link to="/signin" className="btn">Sign in</Link>
        </div>
      </section>
    );
  }
  if (!info) return <p className="muted">Checking your link…</p>;

  const creating = info.purpose === 'verify';
  return (
    <section className="card narrow">
      <h1>{creating ? 'Finish creating your account' : 'Choose a new password'}</h1>
      <p className="muted">For <strong>{info.email}</strong></p>
      <form onSubmit={onSubmit} className="form">
        {/* Lets password managers save the right username */}
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        {creating && (
          <label>Your name
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
        )}
        <label>Password (at least {MIN} characters)
          <input type="password" autoComplete="new-password" value={password} minLength={MIN}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>Confirm password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-p" disabled={busy}>
          {busy ? 'Saving…' : creating ? 'Create account and sign in' : 'Save password and sign in'}
        </button>
      </form>
    </section>
  );
}
