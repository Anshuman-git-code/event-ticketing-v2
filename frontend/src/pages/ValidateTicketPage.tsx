import { useState } from 'react';
import apiClient from '../api/client';

export default function ValidateTicketPage() {
  const [ticketId, setTicketId] = useState('');
  const [eventId, setEventId] = useState('');
  const [result, setResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await apiClient.post('/v1/tickets/validate', { ticketId, eventId });
      setResult({ valid: true, message: res.data.message ?? 'Ticket is valid!' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setResult({ valid: false, message: msg ?? 'Invalid ticket' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Validate Ticket</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleValidate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Ticket ID</label>
            <input type="text" value={ticketId} onChange={e => setTicketId(e.target.value)} required
              placeholder="Enter ticket ID from QR code"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Event ID</label>
            <input type="text" value={eventId} onChange={e => setEventId(e.target.value)} required
              placeholder="Enter event ID"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Validating...' : 'Validate Ticket'}
          </button>
        </form>
        {result && (
          <div className={`mt-4 p-4 rounded-md ${result.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <p className="font-medium">{result.valid ? '✅ Valid' : '❌ Invalid'}</p>
            <p className="text-sm mt-1">{result.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
