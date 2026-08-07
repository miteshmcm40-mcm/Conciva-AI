import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Headphones, TrendingUp, Calendar, UserPlus, HelpCircle, Package,
  Home, UtensilsCrossed, LifeBuoy, ShieldCheck, Wallet, PartyPopper,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';

// "Browse Templates" isn't a real feature yet — there's no template table or
// start-from-template endpoint in the backend, and this product only has one
// voice-agent slot per account. "Use template" is still real, though: it
// opens the actual agent editor (same PATCH /api/numbers/:id save path
// KbAgent/AgentDetail already use) with the system prompt and greeting
// pre-filled from the template, so the user reviews real fields and saves
// through the real flow — nothing here fakes a new backend capability.
export const TEMPLATES = [
  {
    id: 'support', Icon: Headphones, title: 'Customer Support',
    desc: 'Answers FAQs, troubleshoots, and escalates to a human when stuck.',
    greeting: 'Hi, thanks for calling support — how can I help you today?',
    prompt: 'You are a customer support agent. Answer questions using the knowledge base, troubleshoot common issues step by step, and offer to transfer to a human agent if the caller is frustrated or the issue is unresolved after two attempts.',
  },
  {
    id: 'sales', Icon: TrendingUp, title: 'Sales Qualifier',
    desc: 'Asks discovery questions and scores leads before handing off.',
    greeting: "Hi, thanks for your interest — mind if I ask a couple of quick questions?",
    prompt: 'You are a sales development agent. Ask about the caller\'s budget, timeline, and use case, then summarize their needs and let them know a sales rep will follow up. Be curious and friendly, never pushy.',
  },
  {
    id: 'scheduling', Icon: Calendar, title: 'Appointment Booking',
    desc: 'Finds open slots and books meetings straight into your calendar.',
    greeting: "Hi! I can help you book an appointment — what day works best for you?",
    prompt: 'You are a scheduling agent. Collect the caller\'s preferred date, time, and reason for the appointment, confirm an available slot, and read back the confirmed details before ending the call.',
  },
  {
    id: 'lead-capture', Icon: UserPlus, title: 'Lead Capture',
    desc: 'Collects name, contact info, and intent from every caller.',
    greeting: "Hi, thanks for calling! Can I grab your name and the best number to reach you?",
    prompt: 'You are a lead-capture agent. Collect the caller\'s name, phone number, email if offered, and what they\'re interested in. Keep it brief — the goal is a clean handoff, not a full sales conversation.',
  },
  {
    id: 'faq', Icon: HelpCircle, title: 'FAQ Bot',
    desc: 'Answers common questions from your knowledge base only.',
    greeting: "Hi! Ask me anything about our products or services.",
    prompt: 'You are an FAQ agent. Only answer using information in the knowledge base. If the answer isn\'t there, say you don\'t know and offer to connect the caller with a human instead of guessing.',
  },
  {
    id: 'order-status', Icon: Package, title: 'Order Status',
    desc: 'Looks up an order number and reads back its current status.',
    greeting: "Hi! I can check your order status — what's your order number?",
    prompt: 'You are an order-status agent. Ask for the order number, look it up, and read back the current status and expected delivery date in plain language. Offer to transfer to support for anything beyond a status check.',
  },
  {
    id: 'real-estate', Icon: Home, title: 'Real Estate Inquiries',
    desc: 'Qualifies buyers/renters and books property viewings.',
    greeting: "Hi, thanks for calling about the listing — are you looking to buy or rent?",
    prompt: 'You are a real-estate intake agent. Find out whether the caller is buying or renting, their budget and preferred area, and offer to book a viewing at an available time.',
  },
  {
    id: 'restaurant', Icon: UtensilsCrossed, title: 'Restaurant Reservations',
    desc: 'Takes bookings, party size, and special requests by phone.',
    greeting: "Hi, thanks for calling! What date and time would you like to book for?",
    prompt: 'You are a restaurant reservations agent. Collect date, time, party size, and any dietary or seating requests, confirm availability, and read the booking back to the caller.',
  },
  {
    id: 'it-helpdesk', Icon: LifeBuoy, title: 'IT Helpdesk',
    desc: 'Logs tickets, walks through common fixes, and escalates outages.',
    greeting: "Hi, IT helpdesk — what issue are you running into?",
    prompt: 'You are an IT helpdesk agent. Ask what system or device is affected, walk through basic troubleshooting steps first, and log a ticket with full details if the issue isn\'t resolved. Escalate immediately if it sounds like a wider outage.',
  },
  {
    id: 'insurance', Icon: ShieldCheck, title: 'Insurance Claims Intake',
    desc: 'Collects policy number, incident details, and next steps.',
    greeting: "Hi, I'm sorry to hear you need to file a claim — can I get your policy number to start?",
    prompt: 'You are an insurance claims intake agent. Collect the policy number, date and description of the incident, and any other parties involved. Be calm and reassuring, and explain that a claims adjuster will follow up within 2 business days.',
  },
  {
    id: 'payments', Icon: Wallet, title: 'Payment Reminders',
    desc: 'Calls out overdue balances and offers payment options.',
    greeting: "Hi, this is a courtesy call about your account balance — do you have a moment?",
    prompt: 'You are a payment-reminder agent. Politely state the outstanding balance and due date, and offer to take a payment or set up a payment plan. Stay respectful and non-confrontational at all times.',
  },
  {
    id: 'events', Icon: PartyPopper, title: 'Event RSVP',
    desc: 'Confirms attendance, headcount, and dietary requirements.',
    greeting: "Hi! I'm calling to confirm your RSVP for the event — will you be attending?",
    prompt: 'You are an event RSVP agent. Confirm whether the caller is attending, how many guests, and note any dietary requirements. Thank them and let them know a confirmation will follow by email.',
  },
];

export default function Templates() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!currentUser) return null;

  const isAdminTier =
    currentUser.userType === 'superadmin'
    || currentUser.userType === 'admin'
    || currentUser.role === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  return (
    <div>
      <Link to={`${basePath}/agents`} className="inline-flex items-center gap-1.5 text-sm text-lime-700 hover:underline">
        <ArrowLeft size={14} /> All agents
      </Link>

      {/* "Browse Templates" title now lives in the sticky top bar instead of here. */}
      <div className="mt-4 flex items-start justify-between gap-3 flex-wrap">
        <p className="font-semibold text-base tracking-wide" style={{ color: 'var(--ink-2)' }}>Start from a saved knowledge base and prompt instead of a blank agent.</p>
        {notice && (
          <span className="pill text-xs" style={{ background: 'var(--ink)', color: '#fff' }}>{notice}</span>
        )}
      </div>

      <div className="mt-3">
        <span className="pill" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
          Applies the template's greeting + prompt to your agent — review and save on the next screen
        </span>
      </div>

      <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TEMPLATES.map((t) => (
          <div key={t.id} className="form-card flex flex-col">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-tint)' }}>
              <t.Icon size={18} style={{ color: 'var(--primary)' }} />
            </span>
            <div className="mt-3 font-semibold text-sm">{t.title}</div>
            <p className="mt-1 text-xs text-mute flex-1">{t.desc}</p>
            <button
              type="button"
              className="btn-ghost btn-ghost-accent text-xs mt-4 self-start"
              onClick={() => navigate(`${basePath}/agent-detail?template=${t.id}`)}
            >
              Use template
            </button>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-mute">
        Prefer a blank agent?{' '}
        <button type="button" className="text-lime-700 hover:underline font-medium" onClick={() => navigate(`${basePath}/numbers`)}>
          Create a voice agent
        </button>{' '}
        instead.
      </p>
    </div>
  );
}
