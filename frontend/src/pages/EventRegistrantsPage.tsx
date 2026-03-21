import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

interface Registrant {
  registrationId: string;
  userId: string;
  userEmail: string;
  userName: string;
  registeredAt: string;
  status: string;
}

export default function EventRegistrantsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [registrants, setRegistrants] = useState<Registrant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get(`/v1/events/${eventId}/registrations`)
      .then(res => setRegistrants(res.data.registrations))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline mb-4 block">← Back to My Events</button>
      <h1 className="text-2xl font-bold mb-6">Registrants ({registrants.length})</h1>
      {registrants.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No registrations yet.</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Registered</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {registrants.map(r => (
                <tr key={r.registrationId}>
                  <td className="px-4 py-3">{r.userName}</td>
                  <td className="px-4 py-3 text-gray-500">{r.userEmail}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(r.registeredAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      r.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
