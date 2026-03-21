import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';

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
}

export default function BrowseEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get('/v1/events')
      .then(res => setEvents(res.data.events))
      .catch(() => setError('Failed to load events'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading events...</div>;
  if (error) return <div className="text-center py-12 text-red-500">{error}</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Upcoming Events</h1>
      {events.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No events yet.</p>
          <p className="text-sm mt-2">Check back soon or create one if you're an organizer.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map(event => (
            <Link key={event.eventId} to={`/events/${event.eventId}`}
              className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-5 block">
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{event.category}</span>
                <span className="text-sm font-semibold text-green-600">
                  {event.price === 0 ? 'Free' : `$${event.price}`}
                </span>
              </div>
              <h2 className="text-lg font-semibold mt-2 mb-1">{event.name}</h2>
              <p className="text-gray-500 text-sm mb-3 line-clamp-2">{event.description}</p>
              <div className="text-xs text-gray-400 space-y-1">
                <p>📅 {new Date(event.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <p>📍 {event.location}</p>
                <p>🎟 {event.availableCapacity} / {event.capacity} spots left</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
