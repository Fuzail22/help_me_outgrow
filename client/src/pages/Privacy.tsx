import { Link } from 'react-router-dom';

export function Privacy() {
  return (
    <article className="prose">
      <h1>Privacy</h1>
      <p className="draft-flag">Draft wording for the first cut. It describes what the software does; have it reviewed before public launch.</p>
      <h2>What we keep</h2>
      <ul>
        <li><strong>Your Google name and email</strong>, so you can sign in. They stay with this site and are never sent to the notification service.</li>
        <li><strong>The topic, days and times you chose</strong>, and your timezone, so notes arrive when you asked.</li>
        <li><strong>This browser's push address</strong>, which is how a note reaches you. It works only for this site.</li>
        <li><strong>What happened to each note</strong>: sent, shown, opened, closed, and any rating or comment you gave. We use this to improve the notes.</li>
      </ul>
      <h2>What we do not do</h2>
      <ul>
        <li>No advertising, and no third-party analytics scripts.</li>
        <li>We do not sell or share your data.</li>
        <li>The topic you choose can say something personal about you. We treat it as sensitive and keep it only to send your notes.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>Pause, change or stop your notes at any time under <Link to="/manage">My notes</Link>.</li>
        <li><strong>Erase my data</strong> on that page deletes your account, schedule, device and history from both systems, immediately.</li>
        <li>You can also turn notifications off for this site in your browser's settings.</li>
      </ul>
      <h2>Retention</h2>
      <p>Send records are removed after 180 days and activity records after 400 days, or immediately when you erase your data.</p>
    </article>
  );
}
