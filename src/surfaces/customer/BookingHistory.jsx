import Meetings from './Meetings.jsx';

// Booking History is the same "scheduled meetings" feature (calendar +
// list, backed by /api/scheduled-meetings) surfaced under its new home in
// the Call Activity dropdown — just relabeled to match the sidebar entry.
export default function BookingHistory() {
  return (
    <Meetings
      title="Booking History"
      description="Every meeting your AI agent booked through Google Calendar."
    />
  );
}
