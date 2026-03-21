import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';

interface Event {
  eventId: string;
  name: string;
  description: string;
  date: string;
  location: string;
  price: number;
  availableCapacity: number;
  capacity: number;
  category: string;
  organizerName: string;
}

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiClient.get(`/v1/events/${eventId}`)
      .then(res => setEvent(res.data))
      .catch(() => setMessage('Event not found'))
      .finally(() => setLoading(false));
  }, [eventId]);

  const handleRegister = async () => {
    if (!user) { navigate('/login'); return; }
    setRegistering(true);
    setMessage('');
    try {
      await apiClient.post('/v1/registrations', { eventId }, {
        headers: { 'X-Idempotency-Key': uuidv4() },
      });
      setMessage('✅ Registration successful! Your ticket will be emailed to you shortly.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setMessage(msg ?? 'Registration failed. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!event) return <div className="text-center py-12 text-red-500">{message || 'Event not found'}</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline mb-4 block">← Back</button>
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-start mb-4">
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{event.category}</span>
          <span className="text-xl font-bold text-green-600">{event.price === 0 ? 'Free' : `$${event.price}`}</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">{event.name}</h1>
        <p className="text-gray-600 mb-4">{event.description}</p>
        <div className="space-y-2 text-sm text-gray-500 mb-6">
          <p>📅 {new Date(event.date).toLocaleString()}</p>
          <p>📍 {event.location}</p>
          <p>👤 Organized by {event.organizerName}</p>
          <p>🎟 {event.availableCapacity} of {event.capacity} spots remaining</p>
        </div>
        {message && (
          <p className={`text-sm mb-4 ${message.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{message}</p>
        )}
        {event.availableCapacity > 0 ? (
          <button onClick={handleRegister} disabled={registering}
            className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {registering ? 'Registering...' : user ? 'Register for this Event' : 'Sign in to Register'}
          </button>
        ) : (
          <div className="w-full bg-gray-100 text-gray-500 py-3 rounded-md text-center font-medium">Sold Out</div>
        )}
      </div>
    </div>
  );
}
