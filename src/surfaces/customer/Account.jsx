import { useEffect, useState } from 'react';
import { User, Lock, AlertTriangle, Save, KeyRound, Trash2, Phone, Mail, AtSign } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';

// Card surface for this page. The avatar/section discs sit on top of it, so
// they go white to stay legible against the tinted card.
const CARD_BG = '#EEF8D4';
const DISC_BG = '#FFFFFF';
// Ring around the white discs so they read as deliberate badges against the
// tinted card instead of looking like punched-out holes. The border itself
// and its hover glow live in the `.disc-ring` class (src/index.css).

// Initials for the avatar disc — derived from the name we already have, since
// the API exposes no avatar/photo field (see publicUser in server/index.js).
const initialsOf = (user) => {
  const src = (user?.name || user?.username || user?.email || '').trim();
  if (!src) return '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
};

export default function Account() {
  const { currentUser, updateCurrentUser, changePassword, deleteCurrentAccount, authError, setAuthError } = useApp();

  const [profile, setProfile] = useState({
    name: '', company: '', email: '', username: '', phone: '',
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setProfile({
      name: currentUser.name || '',
      company: currentUser.company || '',
      email: currentUser.email || '',
      username: currentUser.username || '',
      phone: currentUser.phone || '',
    });
  }, [currentUser]);

  if (!currentUser) return null;

  const saveProfile = async () => {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileMsg('');
    setAuthError('');
    const ok = await updateCurrentUser(profile);
    setProfileBusy(false);
    setProfileMsg(ok ? '✓ Profile saved.' : '');
  };

  // Discard in-progress edits and snap the fields back to the saved user.
  const resetProfile = () => {
    setProfile({
      name: currentUser.name || '',
      company: currentUser.company || '',
      email: currentUser.email || '',
      username: currentUser.username || '',
      phone: currentUser.phone || '',
    });
    setProfileMsg('');
    setAuthError('');
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwMsg('');
    setAuthError('');
    if (pw.next.length < 8) { setAuthError('Password must be 8+ chars'); return; }
    if (pw.next !== pw.confirm) { setAuthError('New passwords do not match'); return; }
    setPwBusy(true);
    const ok = await changePassword({ current: pw.current, next: pw.next });
    setPwBusy(false);
    if (ok) {
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg('✓ Password changed.');
    }
  };

  return (
    <div>
      {/* "Account" title now lives in the sticky top bar instead of here. */}
      <p className="font-semibold text-base tracking-wide" style={{ color: 'var(--ink-2)' }}>Manage your profile, login, and contact details.</p>

      {/* Summary card on the left, editable form on the right. Only fields the
          API actually returns are shown (see publicUser in server/index.js) —
          no avatar upload, "last login", or "member since", because nothing in
          this project stores them. */}
      <div className="mt-6 grid lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* ===== SUMMARY ===== */}
        <div className="form-card text-center" style={{ background: CARD_BG }}>
          <div
            className="disc-ring mx-auto grid place-items-center rounded-full text-2xl font-bold"
            style={{ width: 116, height: 116, background: DISC_BG, color: 'var(--primary)' }}
          >
            {initialsOf(currentUser)}
          </div>
          <div className="mt-4 text-lg font-bold">{currentUser.name || currentUser.username}</div>
          {/* Role pill keeps the static outline but not `.disc-ring` — it's a
              label, not one of the icon badges, so it stays still. */}
          <div className="mt-1.5 inline-block rounded-full px-2.5 py-1 text-xs font-semibold capitalize"
               style={{ background: DISC_BG, color: 'var(--primary)', border: '1px solid #4D7C0F' }}>
            {currentUser.userType || currentUser.role}
          </div>

          <div className="mt-5 pt-5 border-t space-y-3 text-left" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center gap-2.5 text-sm min-w-0">
              <Mail size={15} className="shrink-0" style={{ color: 'var(--primary)' }} />
              <span className="truncate">{currentUser.email}</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm min-w-0">
              <AtSign size={15} className="shrink-0" style={{ color: 'var(--primary)' }} />
              <span className="truncate">{currentUser.username}</span>
            </div>
            {currentUser.phone && (
              <div className="flex items-center gap-2.5 text-sm min-w-0">
                <Phone size={15} className="shrink-0" style={{ color: 'var(--primary)' }} />
                <span className="truncate">{currentUser.phone}</span>
              </div>
            )}
          </div>
        </div>

        {/* ===== EDITABLE FORM ===== */}
        <div className="min-w-0 form-card" style={{ background: CARD_BG }}>
          <div className="flex items-start gap-3">
            <div className="disc-ring grid place-items-center rounded-full shrink-0"
                 style={{ width: 40, height: 40, background: DISC_BG, color: 'var(--primary)' }}>
              <User size={18} />
            </div>
            <div>
              <div className="font-bold">Profile details</div>
              <div className="text-sm text-mute">Update your personal and company details.</div>
            </div>
          </div>

          <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-4">
            <div>
              <label className="field-label">Full name</label>
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Company name</label>
              <input className="input" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Username</label>
              <input className="input" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
              <div className="field-help">Your sign-in handle.</div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-start gap-3">
              <div className="disc-ring grid place-items-center rounded-full shrink-0"
                   style={{ width: 40, height: 40, background: DISC_BG, color: 'var(--primary)' }}>
                <Phone size={18} />
              </div>
              <div>
                <div className="font-bold">Contact details</div>
                <div className="text-sm text-mute">Update how we can reach you.</div>
              </div>
            </div>
            <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <label className="field-label">Phone</label>
                <input className="input" placeholder="+1 ..." value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                <div className="field-help">Used for SMS alerts and verification.</div>
              </div>
            </div>
          </div>

          {/* Action bar for the profile form — Cancel discards edits, Save
              commits them. Password below keeps its own submit because it
              hits a different endpoint with different validation. */}
          <div className="mt-6 pt-5 border-t flex flex-wrap items-center justify-end gap-2" style={{ borderColor: 'var(--line-2)' }}>
            {profileMsg && <div className="mr-auto text-xs font-semibold text-lime-700">{profileMsg}</div>}
            <button type="button" className="btn-ghost btn-hover-green" onClick={resetProfile} disabled={profileBusy}>Cancel</button>
            <button className="btn-ghost btn-hover-green inline-flex items-center gap-1.5" onClick={saveProfile} disabled={profileBusy}>
              <Save size={14} /> {profileBusy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Password + danger zone stay in their own card below the two columns. */}
      <div className="mt-4 form-card" style={{ background: CARD_BG }}>
        <div>
          <div className="text-xs font-mono uppercase tracking-widest font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--primary)' }}>
            <Lock size={12} /> Password
          </div>
          {/* Three across instead of three stacked full-width inputs — this
              card spans the full page width, so one field per row left a lot
              of dead space and pushed the submit far down the page. */}
          <form onSubmit={submitPassword}>
            <div className="mt-5 grid sm:grid-cols-3 gap-x-4 gap-y-4">
              <div>
                <label className="field-label">Current password</label>
                <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
              </div>
              <div>
                <label className="field-label">New password</label>
                <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
              </div>
              <div>
                <label className="field-label">Confirm new password</label>
                <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
              </div>
            </div>
            <button type="submit" className="btn-ghost btn-hover-green mt-4 inline-flex items-center gap-1.5" disabled={pwBusy}>
              <KeyRound size={14} /> {pwBusy ? 'Updating…' : 'Change password'}
            </button>
            {pwMsg && <div className="mt-2 text-xs font-semibold text-lime-700">{pwMsg}</div>}
          </form>

          {authError && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {authError}
            </div>
          )}
        </div>

        <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line-2)' }}>
          {/* `flex`, not `inline-flex` — inline-flex let the delete button sit
              on the same line as the heading. Block-level keeps the heading on
              its own row with the button beneath it. */}
          <div className="text-xs font-mono uppercase tracking-wide font-semibold text-red-600 mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Danger zone
          </div>
          {!confirmDelete ? (
            <button className="btn-red text-sm inline-flex items-center gap-1.5" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete account &amp; release number
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="text-sm text-red-900">Really delete your account? This cannot be undone.</div>
              <div className="mt-3 flex gap-2">
                <button className="btn-red text-sm inline-flex items-center gap-1.5" onClick={deleteCurrentAccount}>
                  <Trash2 size={14} /> Yes, delete forever
                </button>
                <button className="btn-ghost btn-hover-green text-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          )}
          <p className="text-xs text-mute mt-2">Cancels your subscription, deletes your agent, and releases your phone number. Cannot be undone.</p>
        </div>
      </div>
    </div>
  );
}
