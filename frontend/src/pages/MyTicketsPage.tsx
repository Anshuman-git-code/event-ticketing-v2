import { useEffect, useState } from 'react';
import apiClient from '../api/client';

interface Registration {
  registrationId: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  status: string;
  ticketId?: string;
  registeredAt: string;
}

export default function MyTicketsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/v1/registrations/my')
      .then(res => setRegistrations(res.data.registrations))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = async (ticketId: string) => {
    try {
      const res = await apiClient.get(`/v1/tickets/${ticketId}/download`);
      window.open(res.data.downloadUrl, '_blank');
    } catch {
      alert('Failed to get download link. Please try again.');
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading your tickets...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">My Tickets</h1>
      {registrations.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>You haven't registered for any events yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {registrations.map(reg => (
            <div key={reg.registrationId} className="bg-white rounded-lg shadow p-5 flex justify-between items-center">
              <div>
                <h2 className="font-semibold">{reg.eventTitle}</h2>
                <p className="text-sm text-gray-500">📅 {new Date(reg.eventDate).toLocaleDateString()}</p>
                <p className="text-xs text-gray-400 mt-1">Registered {new Date(reg.registeredAt).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  reg.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>{reg.status}</span>
                {reg.ticketId && (
                  <button onClick={() => handleDownload(reg.ticketId!)}
                    className="block mt-2 text-sm text-blue-600 hover:underline">
                    Download Ticket
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
