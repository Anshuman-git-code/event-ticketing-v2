import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { signIn, signOut, signUp, confirmSignUp, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

interface User {
  userId: string;
  email: string;
  groups: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ nextStep: string }>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string, role: 'Organizers' | 'Attendees') => Promise<void>;
  confirmAccount: (email: string, code: string) => Promise<void>;
  isOrganizer: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<{ nextStep: string }> => {
    const result = await signIn({ username: email, password });
    const step = result.nextStep.signInStep;
    if (step === 'DONE') {
      await loadUser();
    }
    return { nextStep: step };
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
        clientMetadata: { role },
      },
    });
  };

  const confirmAccount = async (email: string, code: string) => {
    await confirmSignUp({ username: email, confirmationCode: code });
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      register,
      confirmAccount,
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
