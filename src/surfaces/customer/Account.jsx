import { useEffect, useState } from 'react';
import {
  User, Lock, AlertTriangle, Save, KeyRound, Trash2, Phone, Mail, AtSign,
  Building2, Shield, Eye, EyeOff, ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';

// Initials for the avatar disc — derived from the name we already have, since
// the API exposes no avatar/photo field (see publicUser in server/index.js).
const initialsOf = (user) => {
  const src = (user?.name || user?.username || user?.email || '').trim();
  if (!src) return '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
};

// Small labeled input with a leading icon — used throughout both panels so
// every field in the form gets the same premium, icon-adorned treatment.
function IconField({ icon: Icon, label, help, ...inputProps }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="acct-input-wrap">
        <Icon size={15} className="acct-input-icon" />
        <input className="input acct-input-icon-pad" {...inputProps} />
      </div>
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3">
      <div className="acct-section-icon"><Icon size={16} /></div>
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-sm text-mute">{desc}</div>
      </div>
    </div>
  );
}

export default function Account() {
  const { currentUser, updateCurrentUser, changePassword, deleteCurrentAccount, authError, setAuthError } = useApp();

  const [tab, setTab] = useState('profile'); // 'profile' | 'security'

  const [profile, setProfile] = useState({
    name: '', company: '', email: '', username: '', phone: '',
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwVisible, setPwVisible] = useState({ current: false, next: false, confirm: false });

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
      setPwVisible({ current: false, next: false, confirm: false });
      setPwMsg('✓ Password changed.');
    }
  };

  const togglePwVisible = (key) => setPwVisible((v) => ({ ...v, [key]: !v[key] }));

  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: 'var(--primary)' }}>
        Account settings
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
        Manage your profile, login, and contact details.
      </p>

      {/* ===== IDENTITY HERO ===== */}
      <div className="acct-hero form-card mt-6">
        <div className="acct-avatar">{initialsOf(currentUser)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
            <h2 className="text-xl font-bold truncate">{currentUser.name || currentUser.username}</h2>
            <span className="acct-role-pill">{currentUser.userType || currentUser.role}</span>
          </div>
          <div className="acct-meta-row">
            <span className="acct-meta-item"><Mail size={13} />{currentUser.email}</span>
            <span className="acct-meta-item"><AtSign size={13} />{currentUser.username}</span>
            {currentUser.phone && <span className="acct-meta-item"><Phone size={13} />{currentUser.phone}</span>}
          </div>
        </div>
      </div>

      {/* ===== SECTION TABS ===== */}
      <div className="acct-tabs mt-6">
        <button type="button" className={`acct-tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>
          <User size={14} /> Profile
        </button>
        <button type="button" className={`acct-tab${tab === 'security' ? ' active' : ''}`} onClick={() => setTab('security')}>
          <Shield size={14} /> Security
        </button>
      </div>

      {tab === 'profile' && (
        <div className="mt-4 form-card animate-fade-up">
          <SectionHeading icon={User} title="Personal information" desc="Your name and company, as shown across the app." />
          <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-4">
            <IconField icon={User} label="Full name" value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <IconField icon={Building2} label="Company name" value={profile.company}
              onChange={(e) => setProfile({ ...profile, company: e.target.value })} />
            <IconField icon={Mail} label="Email" type="email" value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            <IconField icon={AtSign} label="Username" help="Your sign-in handle." value={profile.username}
              onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
          </div>

          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line-2)' }}>
            <SectionHeading icon={Phone} title="Contact details" desc="Update how we can reach you." />
            <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-4">
              <IconField icon={Phone} label="Phone" placeholder="+1 ..." help="Used for SMS alerts and verification."
                value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
          </div>

          {/* Action bar for the profile form — Cancel discards edits, Save
              commits them. Password below keeps its own submit because it
              hits a different endpoint with different validation. */}
          <div className="mt-6 pt-5 border-t flex flex-wrap items-center justify-end gap-2" style={{ borderColor: 'var(--line-2)' }}>
            {profileMsg && <div className="mr-auto text-xs font-semibold" style={{ color: '#15803d' }}>{profileMsg}</div>}
            <button type="button" className="btn-ghost" onClick={resetProfile} disabled={profileBusy}>Cancel</button>
            <button className="btn-teal inline-flex items-center gap-1.5" onClick={saveProfile} disabled={profileBusy}>
              <Save size={14} /> {profileBusy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="mt-4 form-card animate-fade-up">
          <SectionHeading icon={KeyRound} title="Password" desc="Choose a strong password you don't use elsewhere." />

          <form onSubmit={submitPassword}>
            <div className="mt-5 grid sm:grid-cols-3 gap-x-4 gap-y-4">
              <div>
                <label className="field-label">Current password</label>
                <div className="acct-input-wrap">
                  <Lock size={15} className="acct-input-icon" />
                  <input
                    className="input acct-input-icon-pad acct-input-icon-pad-r"
                    type={pwVisible.current ? 'text' : 'password'}
                    value={pw.current}
                    onChange={(e) => setPw({ ...pw, current: e.target.value })}
                    autoComplete="current-password"
                  />
                  <button type="button" className="acct-input-eye" onClick={() => togglePwVisible('current')} tabIndex={-1}>
                    {pwVisible.current ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="field-label">New password</label>
                <div className="acct-input-wrap">
                  <Lock size={15} className="acct-input-icon" />
                  <input
                    className="input acct-input-icon-pad acct-input-icon-pad-r"
                    type={pwVisible.next ? 'text' : 'password'}
                    value={pw.next}
                    onChange={(e) => setPw({ ...pw, next: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button type="button" className="acct-input-eye" onClick={() => togglePwVisible('next')} tabIndex={-1}>
                    {pwVisible.next ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div className="field-help">At least 8 characters.</div>
              </div>
              <div>
                <label className="field-label">Confirm new password</label>
                <div className="acct-input-wrap">
                  <Lock size={15} className="acct-input-icon" />
                  <input
                    className="input acct-input-icon-pad acct-input-icon-pad-r"
                    type={pwVisible.confirm ? 'text' : 'password'}
                    value={pw.confirm}
                    onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button type="button" className="acct-input-eye" onClick={() => togglePwVisible('confirm')} tabIndex={-1}>
                    {pwVisible.confirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-teal inline-flex items-center gap-1.5" disabled={pwBusy}>
                <KeyRound size={14} /> {pwBusy ? 'Updating…' : 'Change password'}
              </button>
              {pwMsg && <div className="text-xs font-semibold" style={{ color: '#15803d' }}>{pwMsg}</div>}
            </div>
          </form>

          {authError && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {authError}
            </div>
          )}

          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide font-semibold text-red-600 mb-3">
              <AlertTriangle size={13} /> Danger zone
            </div>
            <div className="acct-danger-card">
              <div className="flex items-start gap-3">
                <div className="acct-section-icon acct-section-icon-danger"><Trash2 size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm">Delete account</div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
                    Cancels your subscription, deletes your agent, and releases your phone number. This cannot be undone.
                  </p>

                  {!confirmDelete ? (
                    <button className="btn-red text-sm mt-3 inline-flex items-center gap-1.5" onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={14} /> Delete account &amp; release number
                    </button>
                  ) : (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                      <div className="text-sm text-red-900 font-medium">Really delete your account? This cannot be undone.</div>
                      <div className="mt-3 flex gap-2">
                        <button className="btn-red text-sm inline-flex items-center gap-1.5" onClick={deleteCurrentAccount}>
                          <Trash2 size={14} /> Yes, delete forever
                        </button>
                        <button className="btn-ghost text-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-4)' }}>
            <ShieldCheck size={13} /> Your credentials are never shared with third parties.
          </div>
        </div>
      )}
    </div>
  );
}
