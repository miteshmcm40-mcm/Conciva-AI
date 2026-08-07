import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Footer from '../components/Footer.jsx';
import Logo from '../components/Logo.jsx';

const LAST_UPDATED = '17 June 2026';

const SECTIONS = [
  { id: 's1', label: '1. Acceptance and Modification' },
  { id: 's2', label: '2. Description of Services' },
  { id: 's3', label: '3. Account Registration' },
  { id: 's4', label: '4. Service Duration and Renewal' },
  { id: 's5', label: '5. Fees, Payments, and Billing' },
  { id: 's6', label: '6. User Conduct and Restrictions' },
  { id: 's7', label: '7. Service-Specific Terms' },
  { id: 's8', label: '8. Privacy and Data Protection' },
  { id: 's9', label: '9. Intellectual Property Rights' },
  { id: 's10', label: '10. Emergency Services' },
  { id: 's11', label: '11. Termination and Suspension' },
  { id: 's12', label: '12. Limitation of Liability' },
  { id: 's13', label: '13. Indemnification' },
  { id: 's14', label: '14. Dispute Resolution' },
  { id: 's15', label: '15. Miscellaneous' },
  { id: 's16', label: '16. Warranties and Contact' },
];

function TocLinks() {
  return (
    <ul className="space-y-1.5">
      {SECTIONS.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className="block text-sm text-slate-500 hover:text-lime-700 transition-colors py-0.5"
          >
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Terms() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div id="top" className="min-h-screen bg-white text-slate-800">
      <header className="glass sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/" aria-label="kallus.io home" className="cursor-pointer flex items-center gap-2 min-w-0">
            <Logo size={36} showWordmark={false} />
            <span className="font-mono text-sm lowercase text-mute tracking-tight whitespace-nowrap">kallus.io</span>
          </Link>
          <Link to="/dashboard/overview" className="btn-teal text-sm py-2 px-4">Open dashboard</Link>
        </div>
      </header>

      <div className="bg-gradient-to-b from-lime-50/70 to-white border-b border-slate-100">
        <div className="mx-auto max-w-5xl px-6 pt-14 pb-10">
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-lime-700 bg-lime-100 rounded-full px-3 py-1 mb-4">
            Legal
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            Terms of Service
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            The rules for using KallUS's AI voice-agent platform — plans, billing, acceptable use, and your
            rights as a customer.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
              Last updated <strong className="text-slate-800 font-semibold">{LAST_UPDATED}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
              Company <strong className="text-slate-800 font-semibold">TKOS</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-12 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-12">
        <nav aria-label="Table of contents" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              On this page
            </p>
            <TocLinks />
          </div>
        </nav>

        <details className="lg:hidden -mt-2 rounded-xl border border-slate-200 bg-slate-50 open:bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700">
            Jump to a section
          </summary>
          <div className="px-4 pb-4">
            <TocLinks />
          </div>
        </details>

        <main className="prose prose-slate prose-sm max-w-none prose-headings:font-display prose-h2:scroll-mt-24 prose-h2:text-slate-900 prose-h3:text-slate-700 prose-a:text-lime-700 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-800">
          <h2 id="s1">1. Acceptance and Modification of Terms</h2>
          <h3>1.1 Acceptance</h3>
          <p>By accessing the platform, dashboard, APIs, or website, you acknowledge agreement to these Terms of Service. Use of the Services is expressly conditioned on accepting all terms and conditions.</p>
          <h3>1.2 Modification</h3>
          <p>TKOS reserves the right to modify this Agreement at its sole discretion.</p>
          <h3>1.3 Notification of Changes</h3>
          <p>The company will make reasonable efforts to notify users of material changes through website updates, dashboard notices, or email notifications.</p>
          <h3>1.4 Effective Date</h3>
          <p>Changes become effective immediately upon posting unless otherwise stated.</p>
          <h3>1.5 Consent to Updated Terms</h3>
          <p>New processing or materially new terms require user consent where legally required.</p>
          <h3>1.6 Continued Use Constitutes Acceptance</h3>
          <p>Continued use after changes are posted constitutes acceptance of revised terms.</p>
          <h3>1.7 Review Terms Regularly</h3>
          <p>Users are responsible for periodically reviewing this Agreement.</p>

          <h2 id="s2">2. Description of Services</h2>
          <h3>2.1 General</h3>
          <p>The platform enables businesses to build, launch, and scale AI voice agents handling inbound and outbound calls with audio-native conversation support, interruption handling, and multilingual capabilities.</p>
          <h3>2.2 Service Provision</h3>
          <p>Services operate through a self-hosted control panel, web dashboard, and APIs. Users configure agents, prompts, guardrails, knowledge sources, and integrations.</p>
          <h3>2.3 Service Nature</h3>
          <p>kallus.io is a software and connectivity platform. We do not sell phone numbers. Phone numbers and call termination come from user-connected carrier accounts.</p>
          <h3>2.4 Features and Limitations</h3>
          <p>Features, capacity, latency, and language coverage may vary and change. The company may add, modify, or remove features.</p>
          <h3>2.5 "As Is" Provision</h3>
          <p>Services are provided on an "as is" and "as available" basis except as expressly stated.</p>
          <h3>2.6 Geographic Availability</h3>
          <p>Services may not be available in all jurisdictions. Users must ensure lawful use in relevant jurisdictions.</p>
          <h3>2.7 Service Availability Disclaimer</h3>
          <p>While the company strives for high availability, it does not guarantee uninterrupted or error-free operation.</p>
          <h3>2.8 Service Testing</h3>
          <p>The company may test, monitor, and diagnose services, including temporarily processing or recording call audio for troubleshooting.</p>
          <h3>2.9 Third-Party Carriers and Providers</h3>
          <p>Services depend on third-party carriers and providers. The company is not responsible for their acts, omissions, or charges.</p>
          <h3>2.10 Data Storage and Backup</h3>
          <p>The company stores account data, configurations, logs, and recordings according to the Privacy Policy. Users maintain responsibility for critical content backups.</p>
          <h3>2.11 Call Recording and Transcription</h3>
          <p>Users are solely responsible for providing legally required notices and obtaining consent from call participants in applicable jurisdictions.</p>

          <h2 id="s3">3. Account Registration and Management</h2>
          <h3>3.1 Eligibility</h3>
          <p>Users must be at least 18 years old (or majority age in their jurisdiction) and capable of forming binding contracts.</p>
          <h3>3.2 Account Creation</h3>
          <p>Users must create accounts and provide accurate, current, complete information.</p>
          <h3>3.3 Information Required</h3>
          <p>The company may require additional information or identity/business verification to comply with telecommunications and regulatory requirements.</p>
          <h3>3.4 Account Security and Responsibility</h3>
          <p>Users are responsible for safeguarding credentials and account activity, and must notify the company of unauthorized use.</p>
          <h3>3.5 Account Ownership</h3>
          <p>Accounts belong to the legal person who registered them and cannot be transferred without company consent.</p>
          <h3>3.6 Third-Party Logins and Integrations</h3>
          <p>Users authorize data access and exchange with connected third-party services as needed.</p>
          <h3>3.7 Activation</h3>
          <p>Account activation is typically immediate but may be delayed pending verification or carrier documentation.</p>

          <h2 id="s4">4. Service Duration and Renewal</h2>
          <h3>4.1 Term</h3>
          <p>This Agreement applies while users access Services or maintain an account.</p>
          <h3>4.2 Voice Credit and Top-Ups</h3>
          <p>The Services operate on a prepaid voice-credit model. There are no long-term contracts or minimum commitments beyond your chosen top-up.</p>
          <h3>4.3 No Automatic Renewal of Credit</h3>
          <p>Voice credit does not automatically renew. Auto-recharge features may be enabled or disabled by users.</p>

          <h2 id="s5">5. Fees, Payments, and Billing</h2>
          <h3>5.1 General Fees</h3>
          <p>Voice usage is charged per-minute by plan tier (Starter: $0.15/min, Growth: $0.12/min, Scale: $0.10/min). Top-ups determine tier and concurrent agent availability.</p>
          <h3>5.2 Payment Methods</h3>
          <p>Users provide valid payment methods and authorize charges for applicable fees.</p>
          <h3>5.3 Payment Information Storage</h3>
          <p>Third-party payment processors handle payment information securely without direct full card storage.</p>
          <h3>5.4 Pricing Changes</h3>
          <p>The company may change pricing and tiers for future purchases. Previously purchased credit follows original terms.</p>
          <h3>5.5 Usage Billing</h3>
          <p>Voice usage is deducted real-time or shortly after calls based on duration and applicable rates. Carrier charges are billed separately.</p>
          <h3>5.6 No Hidden Fees</h3>
          <p>There are no setup fees, contracts, or minimums beyond top-ups, with taxes as additional.</p>
          <h3>5.7 Currency</h3>
          <p>Fees are quoted and charged in US dollars unless otherwise stated.</p>
          <h3>5.8 Insufficient Balance and Non-Payment</h3>
          <p>Services may be suspended if credit is exhausted or charges fail.</p>
          <h3>5.9 Chargebacks</h3>
          <p>Users must contact support before initiating chargebacks. Bad-faith chargebacks may result in suspension or termination.</p>
          <h3>5.10 Credit Expiration</h3>
          <p>Unused voice credit expires at the end of its validity period (currently 60 days from purchase) and is not recoverable or refundable after expiry.</p>
          <h3>5.11 Taxes / VAT</h3>
          <p>Fees exclude taxes. Users are responsible for applicable VAT, GST, and sales taxes.</p>
          <h3>5.12 Refund Policy</h3>
          <p>Voice credit and fees are non-refundable except where required by law.</p>

          <h2 id="s6">6. User Conduct and Restrictions on Use</h2>
          <h3>6.1 Lawful and Ethical Use</h3>
          <p>Users must use Services only for lawful purposes in compliance with telecommunications, telemarketing, robocall, anti-spam, and data-protection laws (including TCPA, TSR, GDPR).</p>
          <h3>6.2 AI Disclosure and Consent</h3>
          <p>Users must disclose automated/AI interactions where required and obtain necessary consents for calling, recording, or messaging.</p>
          <h3>6.3 Prohibited Content and Activities</h3>
          <p>Users cannot make fraudulent, deceptive, harassing, or spam calls; impersonate others unlawfully; transmit unlawful or infringing content; violate privacy; distribute malware; or engage in illegal activities.</p>
          <h3>6.4 Specific Use Restrictions</h3>
          <p>Users cannot resell, sublicense, or commercially exploit Services; circumvent usage limits; or build competing products.</p>
          <h3>6.5 Investigation and Enforcement</h3>
          <p>The company may investigate violations and suspend, limit, or terminate accounts engaged in prohibited conduct.</p>
          <h3>6.6 Reporting Violations</h3>
          <p>Users may report suspected abuse to <a href="mailto:support@kallus.io">support@kallus.io</a>.</p>
          <h3>6.7 Acceptable Use Policy</h3>
          <p>An Acceptable Use Policy may be published and forms part of this Agreement.</p>

          <h2 id="s7">7. Service-Specific Terms</h2>
          <h3>7.1 Bring Your Own Carrier and Numbers</h3>
          <p>The company does not sell or assign phone numbers. Users connect their own carrier accounts; numbers remain with carriers.</p>
          <h3>7.2 Number and Routing Responsibility</h3>
          <p>Users configure routing and ensure they have rights to use connected numbers.</p>
          <h3>7.3 AI Agent Content and Knowledge Base</h3>
          <p>Users are responsible for agent prompts, personas, guardrails, and knowledge sources, ensuring compliance with applicable law.</p>
          <h3>7.4 Third-Party Platforms and Integrations</h3>
          <p>Integration use is subject to third-party terms for which users are responsible for compliance.</p>

          <h2 id="s8">8. Privacy, Data Protection, and Content</h2>
          <h3>8.1 Privacy Policy</h3>
          <p>Personal information collection and use are described in the <Link to="/privacy">Privacy Policy</Link>, incorporated into this Agreement.</p>
          <h3>8.2 Roles</h3>
          <p>For call participant data, users generally act as controllers and the company as processor/service provider.</p>
          <h3>8.3 Data Security</h3>
          <p>The company implements appropriate technical and organizational protective measures. Self-hosted control panels require user environment security responsibility.</p>
          <h3>8.4 User Rights</h3>
          <p>Data-subject rights and choices are described in the Privacy Policy.</p>
          <h3>8.5 Your Content</h3>
          <p>Users retain ownership of provided content (prompts, knowledge bases, recordings). Users grant a limited license for hosting, processing, and use.</p>
          <h3>8.6 Disclosure of Personal Information</h3>
          <p>Information may be disclosed to comply with legal obligations or lawful requests.</p>
          <h3>8.7 Cooperation with Investigations and Fraud Prevention</h3>
          <p>Information may be shared to prevent fraud and cooperate with lawful investigations.</p>
          <h3>8.8 Monitoring</h3>
          <p>The company may monitor Services to maintain security and prevent abuse.</p>
          <h3>8.9 Promotional Use of Customer Name/Logo</h3>
          <p>With user consent, customers may be identified in marketing materials. Users may opt out.</p>
          <h3>8.10 Recording and Messaging Consent</h3>
          <p>Users are solely responsible for obtaining all consents for call recording and automated messaging.</p>

          <h2 id="s9">9. Intellectual Property Rights</h2>
          <h3>9.1 Ownership</h3>
          <p>The company and licensors own all rights in the Services, software, and platform, excluding user content.</p>
          <h3>9.2 License to You</h3>
          <p>Users receive a limited, non-exclusive, non-transferable, revocable license for internal business purposes.</p>
          <h3>9.3 Restrictions</h3>
          <p>Users cannot resell, sublicense, or exploit Services; modify, reverse engineer, or decompile components; use scrapers; or remove proprietary notices.</p>
          <h3>9.4 No Implied Rights</h3>
          <p>Only expressly granted rights are provided.</p>
          <h3>9.5 Future Releases</h3>
          <p>The company has no obligation to provide updates or features.</p>
          <h3>9.6 Reservation of Rights</h3>
          <p>All non-granted rights are reserved.</p>
          <h3>9.7 Feedback</h3>
          <p>User feedback grants the company perpetual, royalty-free unrestricted use rights.</p>

          <h2 id="s10">10. Emergency Services</h2>
          <h3>10.1 No Emergency Calling</h3>
          <p>The Services are not intended or designed to support emergency calls (such as 911, 112, 999, or equivalent).</p>
          <h3>10.2 Recommendation for Alternatives</h3>
          <p>Users must maintain alternative emergency contact means.</p>
          <h3>10.3 Disclaimer of Liability</h3>
          <p>The company disclaims liability for inability to reach emergency services.</p>
          <h3>10.4 Notice to Users</h3>
          <p>Users must inform call participants of these limitations where relevant.</p>

          <h2 id="s11">11. Termination and Suspension</h2>
          <h3>11.1 Termination by You</h3>
          <p>Users may stop Services and close accounts anytime. Unused or expired credit is non-refundable except by law.</p>
          <h3>11.2 Termination or Suspension by Us</h3>
          <p>The company may suspend or terminate access for agreement violation, fraud, non-payment, legal reasons, or risk concerns.</p>
          <h3>11.3 Effects of Termination</h3>
          <p>Upon termination, all data including agents, logs, recordings, and credit may be deleted with no recovery option.</p>
          <h3>11.4 Survival</h3>
          <p>Sections 5, 8, 9, 12, 13, 14, and 15 survive termination.</p>

          <h2 id="s12">12. Limitation of Liability</h2>
          <h3>12.1 General Limitation</h3>
          <p>To the fullest extent permitted by law, we and our affiliates, suppliers, and licensors will not be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages.</p>
          <h3>12.2 Aggregate Liability</h3>
          <p>Total liability will not exceed amounts paid in the three months preceding the claim event.</p>
          <h3>12.3 No Liability for Certain Matters</h3>
          <p>The company is not liable for losses from third-party carriers, user configuration, AI output accuracy, user conduct, or uncontrolled events.</p>
          <h3>12.4 Basis of the Bargain</h3>
          <p>Limitations reflect risk allocation and form an essential agreement basis.</p>

          <h2 id="s13">13. Indemnification</h2>
          <h3>13.1 Indemnity Obligation</h3>
          <p>Users indemnify the company, affiliates, and personnel from claims arising from Service use, user content, calls, violation of this Agreement or applicable law (including telemarketing and recording laws), or third-party right infringement.</p>

          <h2 id="s14">14. Dispute Resolution and Arbitration</h2>
          <h3>14.1 Informal Resolution</h3>
          <p>Users must contact <a href="mailto:support@kallus.io">support@kallus.io</a> before initiating formal proceedings to resolve disputes informally.</p>
          <h3>14.2 Binding Arbitration</h3>
          <p>Disputes that cannot be resolved informally will be resolved by binding arbitration administered in Singapore in accordance with the rules of the Singapore International Arbitration Centre (SIAC).</p>
          <h3>14.3 Class Action Waiver</h3>
          <p>Disputes are resolved individually and users waive class action participation rights.</p>
          <h3>14.4 Exceptions</h3>
          <p>Either party may seek injunctive relief to protect intellectual property or confidential information.</p>

          <h2 id="s15">15. Miscellaneous</h2>
          <h3>15.1 Entire Agreement</h3>
          <p>This Agreement, Privacy Policy, and referenced policies constitute the entire agreement regarding Services.</p>
          <h3>15.2 Governing Law</h3>
          <p>This Agreement is governed by Singapore law without regard to conflict-of-laws principles.</p>
          <h3>15.3 Language</h3>
          <p>The English version controls in conflicts with translations.</p>
          <h3>15.4 Severability</h3>
          <p>Invalid provisions do not affect remaining provisions' full force and effect.</p>
          <h3>15.5 Headings</h3>
          <p>Headings are for convenience only and do not affect interpretation.</p>
          <h3>15.6 Relationship</h3>
          <p>No partnership, agency, or employment relationship is created.</p>
          <h3>15.7 Waiver</h3>
          <p>Failure to enforce provisions does not waive future enforcement rights.</p>
          <h3>15.8 Electronic Communications</h3>
          <p>Users consent to electronic communications satisfying written communication requirements.</p>
          <h3>15.9 Force Majeure</h3>
          <p>The company is not liable for delays from events beyond reasonable control including carrier outages or natural disasters.</p>
          <h3>15.10 Notice</h3>
          <p>Notices are provided via dashboard, website, or email.</p>
          <h3>15.11 Export Control</h3>
          <p>Users must comply with export-control and sanctions laws.</p>
          <h3>15.12 Assignment</h3>
          <p>Users cannot assign without company consent. The company may assign for mergers or sales.</p>
          <h3>15.13 Survival</h3>
          <p>Sections surviving by nature survive termination.</p>

          <h2 id="s16">16. Warranties, Disclaimers, and Contact</h2>
          <h3>16.1 "As Is"</h3>
          <p>The Services are provided "AS IS" and "AS AVAILABLE," without warranties of any kind, whether express, implied, or statutory.</p>
          <h3>16.2 No Guarantee of Results</h3>
          <p>The company does not warrant uninterrupted, error-free, or secure Services or accurate AI outputs.</p>
          <h3>16.3 Contact Us</h3>
          <ul>
            <li><strong>Company Name:</strong> TKOS</li>
            <li><strong>Address:</strong> 1 Scotts Road #24-10 Shaw Centre, Singapore 228208, Singapore</li>
            <li><strong>Support Email:</strong> <a href="mailto:support@kallus.io">support@kallus.io</a></li>
            <li><strong>Sales &amp; Partnerships:</strong> <a href="mailto:sales@kallus.io">sales@kallus.io</a></li>
            <li><strong>Voice:</strong> +1 347-474-4009</li>
          </ul>

          <p className="not-prose mt-10">
            <a href="#top" className="text-sm font-medium text-lime-700 hover:underline">
              ↑ Back to top
            </a>
          </p>
        </main>
      </div>

      <Footer />
    </div>
  );
}
