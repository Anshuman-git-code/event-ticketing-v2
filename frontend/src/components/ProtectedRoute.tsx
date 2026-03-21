import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  requireOrganizer?: boolean;
}

export default function ProtectedRoute({ children, requireOrganizer = false }: Props) {
  const { user, loading, isOrganizer } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireOrganizer && !isOrganizer) return <Navigate to="/" replace />;

  return <>{children}</>;
}
