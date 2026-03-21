import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

export default function CreateEventPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', description: '', date: '', location: '',
    price: 0, capacity: 100, category: 'conference',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = ['conference', 'concert', 'workshop', 'sports', 'other'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // datetime-local gives '2026-03-21T10:00' — convert to full ISO8601 for Lambda validation
      const isoDate = form.date ? new Date(form.date).toISOString() : '';
      await apiClient.post('/v1/events', {
        ...form,
        date: isoDate,
        price: Number(form.price),
        capacity: Number(form.capacity),
      });
      navigate('/my-events');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  const field = (label: string, key: keyof typeof form, type = 'text', extra?: object) => (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input type={type} value={String(form[key])}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
        required className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        {...extra} />
    </div>
  );

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create New Event</h1>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        {field('Event Title', 'name')}
        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            required rows={4}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {field('Date & Time', 'date', 'datetime-local')}
        {field('Location', 'location')}
        {field('Price (in cents, 0 = free)', 'price', 'number', { min: 0 })}
        {field('Total Capacity', 'capacity', 'number', { min: 1 })}
        <div>
          <label className="block text-sm font-medium text-gray-700">Category</label>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Creating...' : 'Create Event'}
        </button>
      </form>
    </div>
  );
}
