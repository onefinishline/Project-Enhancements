import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { PROMO_LABELS } from './Submit.jsx';

const yesNoText = (v) => (v === 1 ? 'Yes' : v === 0 ? 'No' : '');

// SQLite timestamps are UTC ("YYYY-MM-DD HH:MM:SS"); plain dates ("YYYY-MM-DD") are calendar days in local time.
const fmtDate = (s) => {
  if (!s) return '';
  const d = s.length > 10 ? new Date(s.replace(' ', 'T') + 'Z') : new Date(s + 'T00:00');
  return d.toLocaleDateString();
};

export default function Projects({ user }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const isStaff = !!(user && user.is_staff);

  const load = useCallback(() => {
    api('/projects').then((d) => setProjects(d.projects)).catch((e) => setError(e.message));
  }, []);
  // Reload when sign-in state changes: staff see contact emails others don't.
  useEffect(load, [load, user && user.id, isStaff]);

  const shown = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter === 'verified' && !p.verified) return false;
      if (filter === 'unverified' && p.verified) return false;
      if (!q) return true;
      return [p.name, p.parent_project, p.short_description, p.details,p.backend_languages, p.frontend_libraries, p.mobile_languages, p.submitter]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }, [projects, search, filter]);

  return (
    <>
      <div className="page-head">
        <h1>Submitted projects</h1>
        <Link to="/submit" className="btn btn-p">Submit an enhancement</Link>
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search name, project, technology…" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search projects" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by verification">
          <option value="all">All projects</option>
          <option value="verified">Verified only</option>
          <option value="unverified">Awaiting verification</option>
        </select>
      </div>

      {!isStaff && (
        <p className="muted small">
          Only authorized staff can verify projects.
          {user === null && <> <Link to="/signin">Sign in</Link> to see all projects (some are shown only to signed-in users) and to have your details filled in when you request a project.</>}
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {projects === null && !error && <p className="muted">Loading…</p>}
      {projects && shown.length === 0 && (
        <p className="muted">{projects.length ? 'No projects match your search.' : 'No projects have been submitted yet.'}</p>
      )}

      <div className="project-list">
        {shown.map((p) => <ProjectCard key={p.id} project={p} user={user} isStaff={isStaff} onChanged={load} />)}
      </div>
    </>
  );
}

function ProjectCard({ project: p, user, isStaff, onChanged }) {
  const [requesting, setRequesting] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  async function toggleVerified(e) {
    const verified = e.target.checked;
    setVerifyBusy(true);
    setVerifyError('');
    try {
      await api(`/projects/${p.id}/verify`, { method: 'POST', body: { verified } });
      onChanged();
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifyBusy(false);
    }
  }

  const tech = [
    ['Desktop / backend', p.backend_languages],
    ['Front-end libraries', p.frontend_libraries],
    ['Mobile', p.mobile_languages],
  ].filter(([, v]) => v);

  return (
    <article className={`card project ${p.verified ? 'is-verified' : ''}`}>
      <header className="project-head">
        <div>
          <h2>{p.name}</h2>
          {p.parent_project && <p className="muted small">Part of <strong>{p.parent_project}</strong></p>}
        </div>
        <div className="badges">
          {p.security_sensitive === 1 && (
            <span className="badge badge-private" title="Hidden from the public; only signed-in users can see this project">
              Not public
            </span>
          )}
          {p.verified && <span className="badge">Verified</span>}
        </div>
      </header>

      {p.short_description ? (
        <>
          <p className="details summary">{p.short_description}</p>
          <details className="full-desc">
            <summary>Full description</summary>
            <p className="details">{p.details}</p>
          </details>
        </>
      ) : (
        <p className="details">{p.details}</p>
      )}

      <dl className="facts">
        {p.people_needed && <><dt>People</dt><dd>{p.people_needed}</dd></>}
        {p.time_needed && <><dt>Time</dt><dd>{p.time_needed}</dd></>}
        {tech.map(([k, v]) => <FragmentRow key={k} k={k} v={v} />)}
        {p.multiple_teams != null && (
          <FragmentRow k="More than one team" v={[yesNoText(p.multiple_teams), p.multiple_teams_note].filter(Boolean).join(': ')} />
        )}
        {p.security_sensitive != null && (
          <FragmentRow k="Security-sensitive" v={[yesNoText(p.security_sensitive), p.security_note].filter(Boolean).join(': ')} />
        )}
        {p.copyright_handling && <FragmentRow k="Copyright" v={p.copyright_handling} />}
        {p.promo_use && <FragmentRow k="Promotional use" v={PROMO_LABELS[p.promo_use]} />}
        <dt>Submitted by</dt>
        <dd>
          {p.submitter}
          {p.submitter_email && <> · <a href={`mailto:${p.submitter_email}`}>{p.submitter_email}</a></>}
          {p.submitter_phone && <> · <a href={`tel:${p.submitter_phone.replace(/[^\d+]/g, '')}`}>{p.submitter_phone}</a></>}
          {' '}on {fmtDate(p.created_at)}
        </dd>
      </dl>

      <div className="checks">
        <label className={`check ${!isStaff ? 'disabled' : ''}`}
          title={isStaff ? '' : 'Only authorized staff can verify projects'}>
          <input type="checkbox" checked={p.verified} disabled={!isStaff || verifyBusy} onChange={toggleVerified} />
          Verified
          {p.verified && p.verified_by_name && (
            <span className="muted small"> by {p.verified_by_name}, {fmtDate(p.verified_at)}</span>
          )}
        </label>
        <label className="check">
          <input type="checkbox" checked={requesting} onChange={(e) => setRequesting(e.target.checked)} />
          Request to work on this project
        </label>
      </div>
      {verifyError && <p className="error" role="alert">{verifyError}</p>}

      {requesting && (
        <RequestForm projectId={p.id} user={user} onDone={() => { setRequesting(false); onChanged(); }} />
      )}

      {p.requests.length > 0 && (
        <div className="requests">
          <h3>Teams interested ({p.requests.length})</h3>
          <ul>
            {p.requests.map((r) => (
              <li key={r.id}>
                <strong>{r.organization}</strong>
                <span className="muted small"> · {describeWhen(r)}</span>
                <div className="small">Participants: {r.participants}</div>
                {r.contact_email && (
                  <div className="small">Contact: <a href={`mailto:${r.contact_email}`}>{r.contact_email}</a></div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function FragmentRow({ k, v }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function describeWhen(r) {
  const parts = [];
  if (r.start_date && r.end_date) parts.push(`${fmtDate(r.start_date)} to ${fmtDate(r.end_date)}`);
  else if (r.start_date) parts.push(`from ${fmtDate(r.start_date)}`);
  else if (r.end_date) parts.push(`until ${fmtDate(r.end_date)}`);
  if (r.timeframe) parts.push(r.timeframe);
  return parts.join(' · ');
}

const EMPTY_REQ = { organization: '', participants: '', start_date: '', end_date: '', timeframe: '', contact_email: '' };

// Signed-in users start with their email as the contact and their name as the first participant (editable).
function RequestForm({ projectId, user, onDone }) {
  const [form, setForm] = useState(() =>
    user ? { ...EMPTY_REQ, participants: user.name, contact_email: user.email } : EMPTY_REQ);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.start_date && !form.end_date && !form.timeframe.trim()) {
      setError('Give the event dates or describe the timeframe.');
      return;
    }
    setBusy(true);
    try {
      await api(`/projects/${projectId}/requests`, { method: 'POST', body: form });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form request-form" onSubmit={onSubmit}>
      <h3>Request to work on this project</h3>
      <label>Team or organization working on it *
        <input value={form.organization} onChange={set('organization')} required maxLength={200} />
      </label>
      <label>Participants' names *
        <textarea value={form.participants} onChange={set('participants')} required maxLength={2000} rows={3}
          placeholder="One name per line, or separated by commas" />
      </label>
      <div className="row-2">
        <label>Event start date
          <input type="date" value={form.start_date} onChange={set('start_date')} />
        </label>
        <label>Event end date
          <input type="date" value={form.end_date} min={form.start_date || undefined} onChange={set('end_date')} />
        </label>
      </div>
      <label>Or describe the timeframe participants have available
        <input value={form.timeframe} onChange={set('timeframe')} maxLength={500}
          placeholder="e.g. Saturdays in March, about 40 hours total" />
      </label>
      <label>Contact email (visible only to staff)
        <input type="email" value={form.contact_email} onChange={set('contact_email')} maxLength={254} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-p" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
    </form>
  );
}
