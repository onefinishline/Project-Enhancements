import { Link } from 'react-router-dom';

// Copy follows the SIL Brand Manual (essence: people + languages + life; voice: competent, caring, engaging).
export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>Better tools for the people behind every language</h1>
        <p className="lead">
          SIL teams build and maintain software that language communities, translators, teachers and
          SIL staff use every day. Each of these projects has improvements its users have asked for and
          its team hasn't had time to build. This site gathers those enhancements in one place and
          connects them with teams who have the skills and time to build them.
        </p>
        <div className="hero-actions">
          <Link to="/submit" className="btn btn-p">Submit an enhancement</Link>
          <Link to="/projects" className="btn">Browse projects</Link>
        </div>
      </section>

      <section className="grid-3">
        <div className="card">
          <h3>Why this exists</h3>
          <p>
            Project teams know what their tools are missing but rarely have spare capacity. Volunteer
            groups, hackathon teams, partner organizations and student cohorts have capacity and want
            well-defined work that matters. This is where the two meet.
          </p>
        </div>
        <div className="card">
          <h3>What makes a good submission</h3>
          <p>
            A focused improvement to an existing project. Describe what it should do, who asked for it,
            and what it will change for the people who use the tool. Then list the technologies involved
            and roughly how many people or how much time it would take.
          </p>
        </div>
        <div className="card">
          <h3>How verification works</h3>
          <p>
            Authorized SIL staff review each submission and mark it <strong>Verified</strong> when it is
            useful, well scoped and approved to be worked on. Teams looking for a project should start
            with the verified ones.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li><strong>Submit:</strong> anyone with an @sil.org account describes an enhancement and the larger project it belongs to.</li>
          <li><strong>Verify:</strong> SIL staff confirm the enhancement is useful and ready to be picked up.</li>
          <li><strong>Request:</strong> a team or organization asks to work on it, listing participants and when they are available.</li>
          <li><strong>Build:</strong> the project team follows up to get the work started, and users get a tool that serves them better.</li>
        </ol>
      </section>
    </>
  );
}
