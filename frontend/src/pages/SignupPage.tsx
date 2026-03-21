import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

type Step = 'signup' | 'confirm';

export default function SignupPage() {
  const { register, confirmAccount } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('signup');
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'Attendees' as 'Attendees' | 'Organizers' });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form.email, form.password, form.name, form.role);
      setStep('confirm'); // Move to OTP step
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmAccount(form.email, code);
      navigate('/login', { state: { message: 'Account confirmed! Please sign in.' } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Confirmation failed. Check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: OTP confirmation screen
  if (step === 'confirm') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
          <h1 className="text-2xl font-bold text-center mb-2">Check Your Email</h1>
          <p className="text-gray-500 text-sm text-center mb-6">
            We sent a 6-digit verification code to <span className="font-medium text-gray-700">{form.email}</span>
          </p>
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <form onSubmit={handleConfirm} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Verification Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.trim())}
                required
                maxLength={6}
                placeholder="123456"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Confirming...' : 'Confirm Account'}
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 mt-4">
            Didn't receive it? Check your spam folder. Code expires in 24 hours.
          </p>
        </div>
      </div>
    );
  }

  // Step 1: Signup form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Create Account</h1>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required minLength={8}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">I am an</label>
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value as 'Attendees' | 'Organizers'})}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Attendees">Attendee (I want to attend events)</option>
              <option value="Organizers">Organizer (I want to create events)</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
