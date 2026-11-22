import { Link } from 'react-router-dom';

export function Privacy() {
  return (
    <article className="prose">
      <h1>Privacy</h1>
      <h2>What we keep</h2>
      <ul>
        <li><strong>Your name and email from Google or Zoho</strong>, so you can sign in. They stay with this site and are never sent to the notification service, which knows you only by a random id.</li>
        <li><strong>The topics, days and times you chose</strong>, and your timezone, so notes arrive when you asked.</li>
        <li><strong>This browser's push address</strong>, which is how a note reaches you. It works only for this site.</li>
        <li><strong>What happened to each note</strong>: sent, shown, opened, closed, and any rating or comment you gave. We use this to improve the notes and to work out your level.</li>
        <li><strong>Your journal</strong>, encrypted with a key that is unique to you. Nobody else can read it, including the people who run this site; they see only how many entries exist and when.</li>
        <li><strong>Referrals</strong>: when someone opens your link, a random id for their browser (not who they are), so each device counts once.</li>
        <li><strong>Purchases</strong>: what you bought, the amount and when. Payments are handled by Razorpay; we never see your card, UPI or bank details.</li>
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
        <li>Export or delete your whole journal at any time on the <Link to="/journal">Journal</Link> page.</li>
        <li><strong>Erase my data</strong> on My notes deletes your account, schedule, device, journal and history from both systems, immediately. Records of purchases are kept for accounting, without your name or email.</li>
        <li>You can also turn notifications off for this site in your browser's settings.</li>
      </ul>
      <h2>Retention</h2>
      <p>Send records are removed after 180 days and activity records after 400 days, or immediately when you erase your data.</p>
      <p>Questions: <Link to="/contact">contact us</Link>.</p>
    </article>
  );
}
