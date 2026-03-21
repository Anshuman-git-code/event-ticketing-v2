import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';

interface Event {
  eventId: string;
  name: string;
  date: string;
  location: string;
  availableCapacity: number;
  capacity: number;
  status: string;
}

export default function MyEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/v1/events')
      .then(res => setEvents(res.data.events))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (eventId: string) => {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/v1/events/${eventId}`);
      setEvents(events.filter(e => e.eventId !== eventId));
    } catch {
      alert('Failed to delete event. It may have registrations.');
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Events</h1>
        <Link to="/create-event" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">
          + Create Event
        </Link>
      </div>
      {events.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>You haven't created any events yet.</p>
          <Link to="/create-event" className="text-blue-600 hover:underline mt-2 block">Create your first event →</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <div key={event.eventId} className="bg-white rounded-lg shadow p-5 flex justify-between items-center">
              <div>
                <h2 className="font-semibold">{event.name}</h2>
                <p className="text-sm text-gray-500">📅 {new Date(event.date).toLocaleDateString()} · 📍 {event.location}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {event.capacity - event.availableCapacity} registered / {event.capacity} capacity
                </p>
              </div>
              <div className="flex gap-2">
                <Link to={`/events/${event.eventId}/registrants`}
                  className="text-sm text-blue-600 hover:underline">View Registrants</Link>
                <button onClick={() => handleDelete(event.eventId)}
                  className="text-sm text-red-500 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
