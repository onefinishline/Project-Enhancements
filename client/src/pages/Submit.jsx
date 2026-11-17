import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const EMPTY = {
  name: '', parent_project: '', short_description: '', details: '',
  submitter: '', submitter_email: '', submitter_phone: '',
  people_needed: '', time_needed: '', backend_languages: '', frontend_libraries: '', mobile_languages: '',
  copyright_handling: '', multiple_teams: null, multiple_teams_note: '',
  security_sensitive: null, security_note: '', promo_use: '',
};

export const PROMO_LABELS = {
  both: 'Yes, descriptions and screenshots',
  descriptions: 'Descriptions only',
  screenshots: 'Screenshots only',
  none: 'No',
};

// Yes/No radio pair: a single checkbox can't tell "no" from "not answered yet".
function YesNo({ name, legend, value, onChange }) {
  return (
    <div className="choice-group" role="radiogroup" aria-label={legend}>
      <span className="choice-q">{legend} *</span>
      <div className="choices">
        <label className="check"><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} required /> Yes</label>
        <label className="check"><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> No</label>
      </div>
    </div>
  );
}

// Signed-in users get their name and email filled in (still editable, e.g. when submitting for someone else).
const withUser = (f, user) => (user ? { ...f, submitter: f.submitter || user.name, submitter_email: f.submitter_email || user.email } : f);

export default function Submit({ user }) {
  const [form, setForm] = useState(() => withUser(EMPTY, user));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { if (user) setForm((f) => withUser(f, user)); }, [user]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const setValue = (field) => (v) => setForm({ ...form, [field]: v });

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/projects', { method: 'POST', body: form });
      setDone(true);
      setForm(withUser(EMPTY, user));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined) return <p className="muted">Loading…</p>;

  if (user === null) {
    return (
      <section className="card narrow">
        <h1>Sign in to submit an enhancement</h1>
        <p>
          Submitting needs an SIL account so staff know who to follow up with. Anyone with an @sil.org email
          address can create one in a minute. Your name and email are then filled in for you.
        </p>
        <div className="hero-actions">
          <Link to="/signin" className="btn btn-p">Sign in</Link>
          <Link to="/signin?mode=register" className="btn">Create an account</Link>
        </div>
        <p className="muted small">
          Just looking? <Link to="/projects">Browse submitted projects</Link>. No account needed.
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="card narrow">
        <h1>Thank you!</h1>
        <p>Your enhancement has been submitted. Staff will review it and mark it verified when it is ready to be picked up.</p>
        <div className="hero-actions">
          <Link to="/projects" className="btn btn-p">View all projects</Link>
          <button className="btn" onClick={() => setDone(false)}>Submit another</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card narrow">
      <h1>Submit an enhancement</h1>
      <p className="muted">Fields marked * are required.</p>
      <form onSubmit={onSubmit} className="form">
        <fieldset>
          <legend>The project</legend>
          <label>Project name *
            <input value={form.name} onChange={set('name')} required maxLength={200} />
          </label>
          <label>Larger project it is connected to
            <input value={form.parent_project} onChange={set('parent_project')} maxLength={200}
              placeholder="e.g. the program or product this enhancement belongs to" />
          </label>
          <label>Short project description *
            <input value={form.short_description} onChange={set('short_description')} required maxLength={300}
              placeholder="One or two sentences shown at the top of the project listing" />
          </label>
          <label>Full project description *
            <textarea value={form.details} onChange={set('details')} required maxLength={5000} rows={7}
              placeholder="What should it do? Who asked for it, and what will it change for the people who use the tool? Any links, constraints or acceptance criteria?" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Teams, rights and sensitivity</legend>
          <YesNo name="multiple_teams" legend="Can more than one team work on this project?"
            value={form.multiple_teams} onChange={setValue('multiple_teams')} />
          <label>Explain *
            <textarea value={form.multiple_teams_note} onChange={set('multiple_teams_note')} required maxLength={2000} rows={3}
              placeholder={form.multiple_teams === false
                ? 'e.g. the work touches one shared codebase, so two teams would collide'
                : 'e.g. teams can each take a different module, or build competing prototypes'} />
          </label>

          <YesNo name="security_sensitive" legend="Is this project security-sensitive?"
            value={form.security_sensitive} onChange={setValue('security_sensitive')} />
          {form.security_sensitive === true && (
            <p className="muted small prefill-note">
              Security-sensitive projects are hidden from the public: only signed-in users and staff will see this project.
            </p>
          )}
          {form.security_sensitive === true && (
            <label>What makes it security-sensitive? *
              <textarea value={form.security_note} onChange={set('security_note')} required maxLength={2000} rows={3}
                placeholder="e.g. handles personal data, authentication, or location information about language communities" />
            </label>
          )}

          <label>How should copyrights be handled? *
            <textarea value={form.copyright_handling} onChange={set('copyright_handling')} required maxLength={2000} rows={3}
              placeholder="e.g. SIL holds copyright; released under the MIT license; contributors sign a contributor agreement" />
          </label>

          <label>Can descriptions and/or screenshots of the completed project be used in promotional material? *
            <select value={form.promo_use} onChange={set('promo_use')} required>
              <option value="" disabled>Choose one</option>
              {Object.entries(PROMO_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Effort</legend>
          <div className="row-2">
            <label>Potential number of people
              <input type="number" min={1} max={10000} value={form.people_needed} onChange={set('people_needed')} />
            </label>
            <label>Time needed to complete
              <input value={form.time_needed} onChange={set('time_needed')} maxLength={200}
                placeholder="e.g. 3 days, 2 weeks, one weekend hackathon" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Technology</legend>
          <label>Desktop and backend languages needed
            <input value={form.backend_languages} onChange={set('backend_languages')} maxLength={500}
              placeholder="e.g. C#, Python, Node.js, SQL" />
          </label>
          <label>Front-end libraries used
            <input value={form.frontend_libraries} onChange={set('frontend_libraries')} maxLength={500}
              placeholder="e.g. React, Vue, jQuery, Bootstrap" />
          </label>
          <label>Mobile languages (if applicable)
            <input value={form.mobile_languages} onChange={set('mobile_languages')} maxLength={500}
              placeholder="e.g. Kotlin, Swift, Flutter/Dart, React Native" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Submitter</legend>
          <p className="muted small prefill-note">Filled in from your account. Change them if you're submitting for someone else.</p>
          <div className="row-2">
            <label>Your name *
              <input value={form.submitter} onChange={set('submitter')} required maxLength={200} />
            </label>
            <label>Your email (visible only to staff)
              <input type="email" value={form.submitter_email} onChange={set('submitter_email')} maxLength={254} />
            </label>
          </div>
          <label>Your phone number (visible only to staff)
            <input type="tel" value={form.submitter_phone} onChange={set('submitter_phone')} maxLength={40}
              placeholder="Include the country code, e.g. +1 972 555 0100" />
          </label>
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-p" disabled={busy}>{busy ? 'Submitting…' : 'Submit enhancement'}</button>
      </form>
    </section>
  );
}
