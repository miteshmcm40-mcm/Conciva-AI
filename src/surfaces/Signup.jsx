import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext.jsx';
import Logo from '../components/Logo.jsx';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30; // seconds before "Resend code" is clickable again

export default function Signup() {
  const { signupSendOtp, signupVerifyOtp, signupResendOtp, authError, setAuthError } = useApp();

  const [step, setStep] = useState('details'); // 'details' | 'otp'
  const [busy, setBusy] = useState(false);

  // Step 1 fields
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  // Step 2 fields
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState(''); // shown only when the backend couldn't actually email a code
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMsg, setResendMsg] = useState('');
  const otpInputRef = useRef(null);

  useEffect(() => {
    if (step !== 'otp' || resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendCooldown]);

  useEffect(() => {
    if (step === 'otp') otpInputRef.current?.focus();
  }, [step]);

  const submitDetails = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!name.trim() || !email.trim() || !password) {
      setAuthError('Name, email, and password are required');
      return;
    }
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match');
      return;
    }
    setBusy(true);
    const result = await signupSendOtp({ name, company, email, password });
    setBusy(false);
    if (result.ok) {
      setDevOtp(result.devOtp || '');
      setOtp('');
      setResendCooldown(RESEND_COOLDOWN);
      setResendMsg('');
      setStep('otp');
    }
  };

  const submitOtp = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (otp.trim().length !== OTP_LENGTH) {
      setAuthError(`Enter the ${OTP_LENGTH}-digit code`);
      return;
    }
    setBusy(true);
    await signupVerifyOtp({ email, otp: otp.trim() });
    setBusy(false);
    // On success, AppContext already navigates away — nothing else to do here.
  };

  const resend = async () => {
    if (resendCooldown > 0 || busy) return;
    setBusy(true);
    const result = await signupResendOtp({ email });
    setBusy(false);
    if (result.ok) {
      setDevOtp(result.devOtp || '');
      setResendCooldown(RESEND_COOLDOWN);
      setResendMsg('A new code was sent.');
      setTimeout(() => setResendMsg(''), 4000);
    }
  };

  const backToDetails = () => {
    setAuthError('');
    setOtp('');
    setStep('details');
  };

  return (
    <div className="auth-lime min-h-screen flex items-center justify-center px-5 animate-fade-up">
      <section className="w-full">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Logo size={38} showWordmark={false} />
          </div>

          {step === 'details' ? (
            <>
              <div className="mb-7 text-center">
                <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-[var(--ink)]">
                  Create your{' '}
                  <span className="italic text-lime-700">account.</span>
                </h1>
                <p className="text-mute mt-2 text-[15px]">
                  We'll email you a code to verify it's really you.
                </p>
              </div>

              <form onSubmit={submitDetails} className="space-y-5">
                <div>
                  <label className="field-label">Full name</label>
                  <input
                    className="input input-lg"
                    placeholder="Jane Cooper"
                    value={name}
                    onChange={(e) => { setName(e.target.value); if (authError) setAuthError(''); }}
                    autoComplete="name"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="field-label">Company <span className="text-mute font-normal normal-case">(optional)</span></label>
                  <input
                    className="input input-lg"
                    placeholder="Acme Inc."
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    autoComplete="organization"
                  />
                </div>

                <div>
                  <label className="field-label">Email</label>
                  <input
                    className="input input-lg"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (authError) setAuthError(''); }}
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="field-label">Password</label>
                  <div className="relative">
                    <input
                      className="input input-lg pr-12"
                      type={showPwd ? 'text' : 'password'}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (authError) setAuthError(''); }}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-mute hover:text-[var(--ink)] px-2 py-1 rounded"
                    >
                      {showPwd ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="field-label">Confirm password</label>
                  <input
                    className="input input-lg"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); if (authError) setAuthError(''); }}
                    autoComplete="new-password"
                  />
                </div>

                {authError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <span className="text-red-500">⚠</span>
                    <span>{authError}</span>
                  </div>
                )}

                <button type="submit" className="btn-teal w-full py-3.5 text-[15px]" disabled={busy}>
                  {busy ? 'Sending code…' : 'Continue →'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-mute">
                Already have an account?{' '}
                <Link to="/signin" className="font-semibold text-lime-700 hover:underline">Sign in</Link>
              </p>
            </>
          ) : (
            <>
              <div className="mb-7 text-center">
                <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-[var(--ink)]">
                  Check your{' '}
                  <span className="italic text-lime-700">inbox.</span>
                </h1>
                <p className="text-mute mt-2 text-[15px]">
                  We sent a {OTP_LENGTH}-digit code to <span className="font-semibold text-[var(--ink)]">{email}</span>.
                </p>
              </div>

              {devOtp && (
                <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                  ✉ Email delivery isn't configured here — your code is{' '}
                  <span className="font-mono font-bold tracking-widest">{devOtp}</span>.
                </div>
              )}

              <form onSubmit={submitOtp} className="space-y-5">
                <div>
                  <label className="field-label">Verification code</label>
                  <input
                    ref={otpInputRef}
                    className="input input-lg text-center text-2xl font-mono tracking-[0.5em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_LENGTH}
                    placeholder={'•'.repeat(OTP_LENGTH)}
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH));
                      if (authError) setAuthError('');
                    }}
                  />
                </div>

                {authError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
                    <span className="text-red-500">⚠</span>
                    <span>{authError}</span>
                  </div>
                )}

                {resendMsg && (
                  <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                    ✓ {resendMsg}
                  </div>
                )}

                <button type="submit" className="btn-teal w-full py-3.5 text-[15px]" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify & create account →'}
                </button>
              </form>

              <div className="mt-6 flex items-center justify-between text-sm">
                <button type="button" onClick={backToDetails} className="text-mute hover:text-[var(--ink)]">
                  ← Use a different email
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={resendCooldown > 0 || busy}
                  className="font-semibold text-lime-700 hover:underline disabled:text-mute disabled:no-underline disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}