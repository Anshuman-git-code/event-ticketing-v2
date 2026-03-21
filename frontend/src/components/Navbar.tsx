import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout, isOrganizer } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-blue-600">EventTickets</Link>

        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-600 hover:text-blue-600">Browse Events</Link>

          {user && isOrganizer && (
            <>
              <Link to="/my-events" className="text-gray-600 hover:text-blue-600">My Events</Link>
              <Link to="/create-event" className="bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700 text-sm">
                + Create Event
              </Link>
            </>
          )}

          {user && !isOrganizer && (
            <Link to="/my-tickets" className="text-gray-600 hover:text-blue-600">My Tickets</Link>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{user.email}</span>
              <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-red-600">Logout</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Link to="/login" className="text-gray-600 hover:text-blue-600">Login</Link>
              <Link to="/signup" className="bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700 text-sm">Sign Up</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
