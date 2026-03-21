import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import BrowseEventsPage from './pages/BrowseEventsPage';
import EventDetailPage from './pages/EventDetailPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import CreateEventPage from './pages/CreateEventPage';
import MyEventsPage from './pages/MyEventsPage';
import EventRegistrantsPage from './pages/EventRegistrantsPage';
import MyTicketsPage from './pages/MyTicketsPage';
import ValidateTicketPage from './pages/ValidateTicketPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<BrowseEventsPage />} />
            <Route path="/events/:eventId" element={<EventDetailPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />

            {/* Organizer routes */}
            <Route path="/create-event" element={
              <ProtectedRoute requireOrganizer><CreateEventPage /></ProtectedRoute>
            } />
            <Route path="/my-events" element={
              <ProtectedRoute requireOrganizer><MyEventsPage /></ProtectedRoute>
            } />
            <Route path="/events/:eventId/registrants" element={
              <ProtectedRoute requireOrganizer><EventRegistrantsPage /></ProtectedRoute>
            } />
            <Route path="/validate-ticket" element={
              <ProtectedRoute requireOrganizer><ValidateTicketPage /></ProtectedRoute>
            } />

            {/* Attendee routes */}
            <Route path="/my-tickets" element={
              <ProtectedRoute><MyTicketsPage /></ProtectedRoute>
            } />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}
