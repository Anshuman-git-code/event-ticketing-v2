# Phase 5 Implementation Guide: Frontend Rebuild

## Overview

This guide covers Phase 5 (Week 5) of the Event Ticketing System V2 project. Each step follows the same What / Why / How / Expected Result format as previous guides.

**Duration**: Week 5 (5-7 days)  
**Goal**: Build a React + Vite frontend, connect it to your live API, deploy it to S3 + CloudFront, and protect it with WAF.

**What Phase 4 gave us**:
- ✅ All 7 CDK stacks deployed and healthy
- ✅ CI/CD workflows committed (dormant until billing fixed)
- ✅ CloudWatch dashboard live with 4 alarms
- ✅ X-Ray active tracing on all 11 Lambda functions
- ✅ 5 Logs Insights saved queries
- ✅ API live at `https://u03i82lg6g.execute-api.us-east-1.amazonaws.com`

**What Phase 5 will give us**:
- React + TypeScript frontend with Vite
- AWS Amplify for Cognito authentication (login, signup, logout)
- Organizer portal: create events, view registrations, validate tickets
- Attendee portal: browse events, register, download tickets
- Deployed to S3 + CloudFront with WAF protection
- Custom domain ready (optional)

---

## Important: Frontend Architecture Overview

Before we start, here is how the frontend fits into the system.

```
Browser
  │
  ▼
CloudFront (CDN + WAF)
  │  serves static files from S3
  │  proxies /v1/* to API Gateway
  ▼
S3 Frontend Bucket
  (React build output: HTML, JS, CSS)
  │
  ▼
API Gateway → Lambda → DynamoDB
```

**Why CloudFront?**
- Serves your React app from edge locations worldwide (fast for all users)
- Handles HTTPS automatically with a free ACM certificate
- WAF sits in front of CloudFront blocking malicious traffic
- You can add a custom domain later with zero code changes

**Why Amplify (not raw fetch)?**
- Amplify handles the entire Cognito auth flow: login, signup, token refresh, logout
- It automatically attaches the JWT token to every API request
- Without Amplify you would need to write ~200 lines of auth boilerplate yourself

---

## Part 1: React + Vite Project Setup (Day 29)

### Step 33.1: Create the Frontend Project

**What**: Scaffold a new React + TypeScript project using Vite inside a `frontend/` folder.

**Why**: Vite is significantly faster than Create React App for development (hot reload in milliseconds). TypeScript catches bugs at compile time before they reach users.

**How**: Run in your terminal from the project root:

```bash
npm create vite@latest frontend -- --template react-ts
```

When prompted, just press Enter to confirm. Then install dependencies:

```bash
cd frontend
npm install
```

**Expected Result**: A `frontend/` folder with this structure:
```
frontend/
  src/
    App.tsx
    main.tsx
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

---

### Step 33.2: Install Dependencies

**What**: Install AWS Amplify, React Router, and Axios.

**Why**:
- `aws-amplify` — handles Cognito auth (login, signup, token management)
- `react-router-dom` — client-side routing between pages
- `axios` — cleaner HTTP client than raw fetch (automatic JSON parsing, interceptors)
- `@aws-amplify/ui-react` — pre-built Amplify UI components (login form, etc.)

**How**: From inside the `frontend/` folder:

```bash
npm install aws-amplify @aws-amplify/ui-react react-router-dom axios
npm install -D @types/react-router-dom
```

**Expected Result**: All packages installed with no errors.

---

### Step 33.3: Install and Configure Tailwind CSS

**What**: Add Tailwind CSS for styling.

**Why**: Tailwind lets you style components with utility classes directly in JSX — no separate CSS files to manage. It produces a tiny CSS bundle in production (only includes classes you actually use).

**How**: From inside `frontend/`:

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Then open `frontend/tailwind.config.js` and replace its contents with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Then open `frontend/src/index.css` and replace everything with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Expected Result**: Tailwind classes work in any component.

---

### Step 33.4: Configure Environment Variables

**What**: Create a `.env` file with your API URL and Cognito config.

**Why**: Hardcoding URLs in components makes it impossible to switch between dev and prod. Vite reads `.env` files and injects variables at build time.

**How**: Create `frontend/.env`:

```env
VITE_API_URL=https://u03i82lg6g.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_k7mPLZKd1
VITE_COGNITO_CLIENT_ID=4im1n8hluveicaf8802tqvr5du
VITE_COGNITO_REGION=us-east-1
```

Also create `frontend/.env.example` (safe to commit — no secrets):

```env
VITE_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=your-client-id
VITE_COGNITO_REGION=us-east-1
```

Add `frontend/.env` to `.gitignore` (add this line):
```
frontend/.env
```

**Expected Result**: Environment variables accessible in code as `import.meta.env.VITE_API_URL`.

---

### Step 33.5: Configure AWS Amplify

**What**: Wire Amplify to your Cognito User Pool.

**Why**: Amplify needs to know which Cognito pool to talk to. This config is the bridge between your frontend and the auth infrastructure deployed in Phase 2.

**How**: Create `frontend/src/amplify-config.ts`:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      loginWith: {
        email: true,
      },
    },
  },
});
```

Then open `frontend/src/main.tsx` and add the import at the very top:

```typescript
import './amplify-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Expected Result**: Amplify initialised before the app renders.

---

### Step 33.6: Verify Dev Server Works

**What**: Start the Vite dev server and confirm the app loads.

**Why**: Catch any setup issues before writing components.

**How**: From `frontend/`:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

**Expected Result**: You see the default Vite + React page with a counter button. No console errors.

Stop the dev server with `Ctrl+C` when done.

---

## Part 2: Authentication (Day 30)

### Step 34.1: Create the Auth Context

**What**: A React context that holds the current user and exposes login/logout/signup functions.

**Why**: Multiple components need to know if the user is logged in and what their role is (Organizer vs Attendee). A context makes this available everywhere without prop drilling.

**How**: Create `frontend/src/context/AuthContext.tsx`:

```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { signIn, signOut, signUp, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

interface User {
  userId: string;
  email: string;
  groups: string[]; // ['Organizers'] or ['Attendees']
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string, role: 'Organizers' | 'Attendees') => Promise<void>;
  isOrganizer: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is already logged in on app load
  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const cognitoUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const groups = (session.tokens?.idToken?.payload['cognito:groups'] as string[]) ?? [];
      setUser({
        userId: cognitoUser.userId,
        email: cognitoUser.signInDetails?.loginId ?? '',
        groups,
      });
    } catch {
      setUser(null); // Not logged in
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    await signIn({ username: email, password });
    await loadUser();
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  const register = async (email: string, password: string, name: string, role: string) => {
    await signUp({
      username: email,
      password,
      options: {
        userAttributes: { email, name },
        // Store role in custom attribute — admin assigns group after signup
        clientMetadata: { role },
      },
    });
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      register,
      isOrganizer: user?.groups.includes('Organizers') ?? false,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
```

**Expected Result**: File created, no TypeScript errors.

---

### Step 34.2: Create the API Client

**What**: A pre-configured Axios instance that automatically attaches the JWT token to every request.

**Why**: Without this, every API call would need to manually fetch the token and add the `Authorization` header. The interceptor does it once for all requests.

**How**: Create `frontend/src/api/client.ts`:

```typescript
import axios from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Automatically attach JWT token to every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Not logged in — request proceeds without auth header (for public routes)
  }
  return config;
});

export default apiClient;
```

**Expected Result**: File created. All API calls will automatically include the auth token.

---

### Step 34.3: Create Login and Signup Pages

**What**: Login and signup forms that call the AuthContext functions.

**Why**: Users need a way to authenticate before accessing protected features.

**How**: Create `frontend/src/pages/LoginPage.tsx`:

```typescript
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Sign In</h1>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          Don't have an account? <Link to="/signup" className="text-blue-600 hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
```

Create `frontend/src/pages/SignupPage.tsx`:

```typescript
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

export default function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'Attendees' as const });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form.email, form.password, form.name, form.role);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
          <h2 className="text-xl font-bold text-green-600 mb-2">Account Created!</h2>
          <p className="text-gray-600 mb-4">Check your email for a verification code, then sign in.</p>
          <button onClick={() => navigate('/login')} className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700">
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Create Account</h1>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required minLength={8}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">I am an</label>
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value as 'Attendees'})}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Attendees">Attendee (I want to attend events)</option>
              <option value="Organizers">Organizer (I want to create events)</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

**Expected Result**: Both pages created with no TypeScript errors.

---

### Step 34.4: Create Protected Route Component

**What**: A wrapper component that redirects unauthenticated users to the login page.

**Why**: Without this, anyone could navigate directly to `/create-event` without being logged in.

**How**: Create `frontend/src/components/ProtectedRoute.tsx`:

```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  requireOrganizer?: boolean;
}

export default function ProtectedRoute({ children, requireOrganizer = false }: Props) {
  const { user, loading, isOrganizer } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireOrganizer && !isOrganizer) return <Navigate to="/" replace />;

  return <>{children}</>;
}
```

**Expected Result**: File created.

---

## Part 3: Shared Layout and Navigation (Day 30)

### Step 34.5: Create the Navigation Bar

**What**: A top navigation bar that shows different links based on whether the user is an Organizer or Attendee.

**How**: Create `frontend/src/components/Navbar.tsx`:

```typescript
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
```

---

### Step 34.6: Wire Up App Router

**What**: Configure React Router with all routes and wrap the app in the AuthProvider.

**How**: Replace `frontend/src/App.tsx` with:

```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
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
```

**Expected Result**: App compiles. All routes defined.

---

## Part 4: Attendee Pages (Day 31)

### Step 35.1: Browse Events Page

**What**: The home page — lists all events from the API. Public, no login required.

**How**: Create `frontend/src/pages/BrowseEventsPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';

interface Event {
  eventId: string;
  title: string;
  description: string;
  date: string;
  location: string;
  price: number;
  availableCapacity: number;
  totalCapacity: number;
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
              <h2 className="text-lg font-semibold mt-2 mb-1">{event.title}</h2>
              <p className="text-gray-500 text-sm mb-3 line-clamp-2">{event.description}</p>
              <div className="text-xs text-gray-400 space-y-1">
                <p>📅 {new Date(event.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <p>📍 {event.location}</p>
                <p>🎟 {event.availableCapacity} / {event.totalCapacity} spots left</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

### Step 35.2: Event Detail Page

**What**: Shows full event details and a "Register" button for attendees.

**How**: Create `frontend/src/pages/EventDetailPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { v4 as uuidv4 } from 'uuid';

interface Event {
  eventId: string;
  title: string;
  description: string;
  date: string;
  location: string;
  price: number;
  availableCapacity: number;
  totalCapacity: number;
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
        <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
        <p className="text-gray-600 mb-4">{event.description}</p>
        <div className="space-y-2 text-sm text-gray-500 mb-6">
          <p>📅 {new Date(event.date).toLocaleString()}</p>
          <p>📍 {event.location}</p>
          <p>👤 Organized by {event.organizerName}</p>
          <p>🎟 {event.availableCapacity} of {event.totalCapacity} spots remaining</p>
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
```

Note: Install uuid for the idempotency key:
```bash
npm install uuid @types/uuid
```

---

### Step 35.3: My Tickets Page

**What**: Shows all registrations for the logged-in attendee with download links.

**How**: Create `frontend/src/pages/MyTicketsPage.tsx`:

```typescript
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
```

---

## Part 5: Organizer Pages (Day 32)

### Step 36.1: Create Event Page

**What**: A form for organizers to create new events.

**How**: Create `frontend/src/pages/CreateEventPage.tsx`:

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

export default function CreateEventPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', description: '', date: '', location: '',
    price: 0, totalCapacity: 100, category: 'Conference',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = ['Conference', 'Workshop', 'Concert', 'Sports', 'Networking', 'Other'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/v1/events', {
        ...form,
        price: Number(form.price),
        totalCapacity: Number(form.totalCapacity),
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
        {field('Event Title', 'title')}
        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            required rows={4}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {field('Date & Time', 'date', 'datetime-local')}
        {field('Location', 'location')}
        {field('Price ($)', 'price', 'number', { min: 0, step: '0.01' })}
        {field('Total Capacity', 'totalCapacity', 'number', { min: 1 })}
        <div>
          <label className="block text-sm font-medium text-gray-700">Category</label>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {categories.map(c => <option key={c}>{c}</option>)}
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
```

---

### Step 36.2: My Events Page

**What**: Lists all events created by the logged-in organizer.

**How**: Create `frontend/src/pages/MyEventsPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';

interface Event {
  eventId: string;
  title: string;
  date: string;
  location: string;
  availableCapacity: number;
  totalCapacity: number;
  status: string;
}

export default function MyEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // List all events and filter by organizer on client side
    // (In a real app you'd have a GET /v1/events/my endpoint)
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
                <h2 className="font-semibold">{event.title}</h2>
                <p className="text-sm text-gray-500">📅 {new Date(event.date).toLocaleDateString()} · 📍 {event.location}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {event.totalCapacity - event.availableCapacity} registered / {event.totalCapacity} capacity
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
```

---

### Step 36.3: Event Registrants Page

**What**: Shows all people registered for a specific event.

**How**: Create `frontend/src/pages/EventRegistrantsPage.tsx`:

```typescript
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
```

---

### Step 36.4: Validate Ticket Page

**What**: Allows organizers to validate a ticket by entering the ticket ID (QR code scanning is a Phase 6 enhancement).

**How**: Create `frontend/src/pages/ValidateTicketPage.tsx`:

```typescript
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
```

**Expected Result**: All 8 page files created.

---

## Part 6: Test Locally (Day 32)

### Step 37.1: Run the Dev Server and Test All Pages

**What**: Verify the frontend works end-to-end against your live API before deploying.

**How**: From `frontend/`:

```bash
npm run dev
```

Open `http://localhost:5173` and test this flow:

1. Browse events (should show empty list or any events you created)
2. Click "Sign Up" → create an account with role "Attendee"
3. Check your email for the Cognito verification code
4. Sign in with your new account
5. Browse events and click one to see the detail page
6. Create a second account with role "Organizer"
7. Sign in as organizer → click "Create Event" → fill the form → submit
8. Go back to browse events — your new event should appear
9. Sign in as attendee → register for the event
10. Check "My Tickets" — registration should appear

**Note about Cognito email verification**: Cognito sends a verification code to the email you used. You must enter this code before you can sign in. The default Cognito signup flow requires email confirmation — this is handled automatically by Amplify.

**Expected Result**: Full flow works. Events appear, registration works, tickets show up.

---

### Step 37.2: Fix CORS if Needed

**What**: If you see CORS errors in the browser console, the API needs to allow `localhost:5173`.

**Why**: The API currently allows `*` (all origins) in CORS config, so this should work. But if you see errors, here's how to check.

**How**: Open browser DevTools → Console tab. If you see:
```
Access to XMLHttpRequest at 'https://...' from origin 'http://localhost:5173' has been blocked by CORS policy
```

Check `lib/stacks/api-stack.ts` — the `corsPreflight` section should have `allowOrigins: ['*']`. If it does, the issue is something else (likely the request is failing for another reason — check the Network tab for the actual error).

**Expected Result**: No CORS errors. API calls succeed.

---

## Part 7: Build and Deploy to S3 + CloudFront (Day 33)

### Step 38.1: Add Frontend to StorageStack

**What**: The frontend S3 bucket already exists (deployed in Phase 2). We need to add a CloudFront distribution in front of it.

**Why**: S3 can't serve a React app directly with proper routing (deep links like `/events/123` would 404). CloudFront handles this by redirecting all 404s back to `index.html`, letting React Router handle the routing.

**How**: Open `lib/stacks/storage-stack.ts` and add these imports at the top:

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
```

Then add a public property to the class:

```typescript
export class StorageStack extends cdk.Stack {
  public readonly ticketsBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution; // ← Add this
```

Then add this code inside the constructor, after the existing `frontendBucket` definition:

```typescript
// ==========================================
// CloudFront Distribution for Frontend
// ==========================================
// Origin Access Control — CloudFront authenticates to S3 privately
const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
  description: 'OAC for frontend bucket',
});

this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
  defaultBehavior: {
    origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
      this.frontendBucket,
      { originAccessControl: oac }
    ),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    compress: true,
  },
  // React Router: redirect all 404s to index.html
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: cdk.Duration.seconds(0),
    },
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: cdk.Duration.seconds(0),
    },
  ],
  defaultRootObject: 'index.html',
  comment: `${props.projectName} frontend - ${props.environment}`,
});

// Allow CloudFront to read from the frontend bucket
this.frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject'],
  resources: [this.frontendBucket.arnForObjects('*')],
  principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
  conditions: {
    StringEquals: {
      'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
    },
  },
}));

new cdk.CfnOutput(this, 'CloudFrontUrl', {
  value: `https://${this.distribution.distributionDomainName}`,
  description: 'CloudFront URL for the frontend',
  exportName: `${props.projectName}-${props.environment}-cloudfront-url`,
});

new cdk.CfnOutput(this, 'DistributionId', {
  value: this.distribution.distributionId,
  description: 'CloudFront Distribution ID (needed for cache invalidation)',
});
```

Also add the `iam` import at the top of `storage-stack.ts`:

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';
```

**Expected Result**: TypeScript compiles without errors.

---

### Step 38.2: Deploy Updated StorageStack

**What**: Push the CloudFront distribution to AWS.

**Why**: CloudFront takes 5-10 minutes to deploy globally — start it early.

**How**:

```bash
npx cdk deploy event-ticketing-v2-storage-dev --require-approval never
```

**Expected Result**:
```
✅  event-ticketing-v2-storage-dev

Outputs:
event-ticketing-v2-storage-dev.CloudFrontUrl = https://d1234abcd.cloudfront.net
event-ticketing-v2-storage-dev.DistributionId = E1234ABCD
```

Copy the `CloudFrontUrl` — this is your frontend URL.

---

### Step 38.3: Build the Frontend

**What**: Compile the React app into static files ready for S3.

**Why**: Vite bundles all your TypeScript/JSX into plain HTML, CSS, and JavaScript that any browser can run. The output goes into `frontend/dist/`.

**How**: From `frontend/`:

```bash
npm run build
```

**Expected Result**:
```
dist/index.html
dist/assets/index-[hash].js
dist/assets/index-[hash].css
```

Build completes in ~10 seconds with no errors.

---

### Step 38.4: Upload to S3

**What**: Copy the built files to the S3 frontend bucket.

**Why**: CloudFront serves files from S3. The bucket name is `event-ticketing-v2-frontend-dev-690081480550`.

**How**: From the project root:

```bash
aws s3 sync frontend/dist/ s3://event-ticketing-v2-frontend-dev-690081480550 --delete --region us-east-1
```

The `--delete` flag removes old files that no longer exist in the build (important after rebuilds).

**Expected Result**:
```
upload: dist/index.html to s3://event-ticketing-v2-frontend-dev-690081480550/index.html
upload: dist/assets/index-abc123.js to s3://...
upload: dist/assets/index-abc123.css to s3://...
```

---

### Step 38.5: Invalidate CloudFront Cache

**What**: Tell CloudFront to fetch fresh files from S3.

**Why**: CloudFront caches files at edge locations. After uploading new files to S3, you need to invalidate the cache so users get the latest version.

**How**: Replace `E1234ABCD` with your actual Distribution ID from Step 38.2:

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234ABCD \
  --paths "/*" \
  --region us-east-1
```

**Expected Result**:
```json
{
  "Invalidation": {
    "Status": "InProgress",
    ...
  }
}
```

The invalidation takes 1-2 minutes to propagate globally.

---

### Step 38.6: Test the Live Frontend

**What**: Open the CloudFront URL and verify the app works.

**How**: Open the `CloudFrontUrl` from Step 38.2 in your browser (e.g., `https://d1234abcd.cloudfront.net`).

Test:
1. Home page loads and shows events
2. Navigate to `/login` — login page loads
3. Navigate to `/events/some-id` — page loads (not a 404)
4. Sign in and test the full flow

**Expected Result**: Full app works via CloudFront URL. HTTPS works automatically.

---

### Step 38.7: Update CORS to Allow CloudFront Domain

**What**: Add your CloudFront domain to the API's allowed CORS origins.

**Why**: Currently the API allows `*` (all origins). For production security, you should restrict it to your CloudFront domain only.

**How**: Open `lib/stacks/api-stack.ts` and find the `corsPreflight` section. Update `allowOrigins`:

```typescript
corsPreflight: {
  allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  allowMethods: [
    apigatewayv2.CorsHttpMethod.GET,
    apigatewayv2.CorsHttpMethod.POST,
    apigatewayv2.CorsHttpMethod.PUT,
    apigatewayv2.CorsHttpMethod.DELETE,
    apigatewayv2.CorsHttpMethod.OPTIONS,
  ],
  // Replace * with your actual CloudFront domain
  allowOrigins: [
    'http://localhost:5173',                    // Local dev
    'https://d1234abcd.cloudfront.net',         // ← Replace with your CloudFront URL
  ],
  maxAge: cdk.Duration.days(1),
},
```

Then redeploy:

```bash
npx cdk deploy event-ticketing-v2-api-dev --require-approval never
```

**Expected Result**: API only accepts requests from your CloudFront domain and localhost.

---

## Part 8: Create a Deploy Script (Day 33)

### Step 38.8: Add a Frontend Deploy Script

**What**: A single command that builds, uploads, and invalidates the cache.

**Why**: You'll do this every time you change the frontend. A script saves you from running 3 commands manually every time.

**How**: Open the root `package.json` and add a `deploy:frontend` script:

```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "lint": "eslint . --ext .ts",
  "deploy:frontend": "cd frontend && npm run build && cd .. && aws s3 sync frontend/dist/ s3://event-ticketing-v2-frontend-dev-690081480550 --delete --region us-east-1 && aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths '/*' --region us-east-1"
}
```

Replace `YOUR_DISTRIBUTION_ID` with your actual distribution ID.

**How to use it**: From the project root:

```bash
npm run deploy:frontend
```

**Expected Result**: One command builds and deploys the frontend.

---

## Part 9: Commit and Push (Day 33)

### Step 39: Commit Everything

**What**: Commit all frontend code and CDK changes to GitHub.

**How**:

```bash
git add -A
git commit -m "feat(phase5): React frontend deployed to S3 + CloudFront

## What was implemented
- React + Vite + TypeScript frontend in frontend/ directory
- AWS Amplify integration for Cognito authentication
- Tailwind CSS for styling
- React Router for client-side navigation

## Pages implemented
- BrowseEventsPage: public event listing (home page)
- EventDetailPage: event details + register button
- LoginPage / SignupPage: Cognito auth forms
- CreateEventPage: organizer event creation form
- MyEventsPage: organizer's event list with delete
- EventRegistrantsPage: list of registrants per event
- MyTicketsPage: attendee's registrations + download links
- ValidateTicketPage: organizer ticket validation

## Infrastructure changes
- StorageStack: added CloudFront distribution with OAC
- StorageStack: added S3 bucket policy for CloudFront access
- StorageStack: added CloudFrontUrl and DistributionId outputs
- ApiStack: updated CORS allowOrigins to include CloudFront domain

## Deployment
- Frontend built with: npm run build
- Uploaded to: s3://event-ticketing-v2-frontend-dev-690081480550
- Served via CloudFront: https://[your-distribution].cloudfront.net
- Cache invalidated after upload"

git push origin main
```

Then tag Phase 5:

```bash
git tag -a phase5-complete -m "Phase 5 Complete — React frontend deployed to CloudFront"
git push origin phase5-complete
```

---

## Summary: What Phase 5 Gives You

After completing this phase you will have:

- A live React frontend accessible at your CloudFront URL
- Full authentication flow (signup, email verification, login, logout)
- Organizers can create events, view registrants, validate tickets
- Attendees can browse events, register, and download tickets
- Frontend served globally via CloudFront with HTTPS
- CORS locked down to your CloudFront domain

---

## Common Issues and Fixes

**Issue**: `npm run build` fails with TypeScript errors  
**Fix**: Run `npx tsc --noEmit` to see the exact errors. Most common: missing type imports or wrong prop types.

**Issue**: Blank page after deploying to CloudFront  
**Fix**: Check the browser console. Usually means the `VITE_API_URL` or Cognito config is wrong. Rebuild with correct `.env` values.

**Issue**: Login works locally but fails on CloudFront  
**Fix**: Cognito's allowed callback URLs may need updating. Go to Cognito → App clients → your client → Hosted UI → add your CloudFront URL.

**Issue**: API calls fail with 403 after restricting CORS  
**Fix**: Make sure you added both `http://localhost:5173` AND your CloudFront URL to `allowOrigins` in api-stack.ts, then redeployed.

**Issue**: CloudFront shows old version after deploy  
**Fix**: Run the cache invalidation command again. It can take up to 2 minutes to propagate.

**Issue**: Deep links (e.g. `/events/123`) return 403 on CloudFront  
**Fix**: The `errorResponses` in StorageStack should redirect 403/404 to `index.html`. Make sure the StorageStack was redeployed after adding that config.
