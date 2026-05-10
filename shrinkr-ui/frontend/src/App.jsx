import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import './theme.css'; // global CSS variables + font import

const loadingStyles = `
  .app-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Mono', monospace;
  }

  .app-loading-inner { text-align: center; }

  .app-loading-wordmark {
    font-family: 'Playfair Display', serif;
    font-size: 1.5rem;
    font-weight: 400;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0 0 2rem;
  }

  .app-loading-bar-track {
    width: 120px;
    height: 1px;
    background: var(--border);
    margin: 0 auto;
    position: relative;
    overflow: hidden;
  }

  .app-loading-bar-fill {
    position: absolute;
    top: 0;
    left: -100%;
    height: 100%;
    width: 100%;
    background: var(--accent);
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    0%   { left: -100%; }
    50%  { left: 0%; }
    100% { left: 100%; }
  }

  .app-loading-label {
    margin-top: 1.25rem;
    font-size: 0.62rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
`;

const ProtectedRoute = ({ children }) => {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <>
        <style>{loadingStyles}</style>
        <div className="app-loading">
          <div className="app-loading-inner">
            <p className="app-loading-wordmark">Shrinkr</p>
            <div className="app-loading-bar-track">
              <div className="app-loading-bar-fill" />
            </div>
            <p className="app-loading-label">Loading</p>
          </div>
        </div>
      </>
    );
  }

  return isLoggedIn ? children : <Navigate to="/login" />;
};

function AppRoutes() {
  const { isLoggedIn } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/dashboard" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}