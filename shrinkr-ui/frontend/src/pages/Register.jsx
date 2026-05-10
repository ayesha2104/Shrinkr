import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader } from 'lucide-react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Playfair+Display:wght@400;500&display=swap');

  .auth-root {
    min-height: 100vh;
    background: #0f0e0d;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    font-family: 'DM Mono', monospace;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .auth-card {
    width: 100%;
    max-width: 420px;
  }

  @media (max-width: 480px) {
    .auth-root {
      padding: 1.5rem 1rem;
    }
  }

  .auth-header {
    margin-bottom: 3rem;
  }

  .auth-wordmark {
    font-family: 'Playfair Display', serif;
    font-size: 2rem;
    font-weight: 400;
    color: #f0ede8;
    letter-spacing: -0.02em;
    margin: 0 0 0.5rem;
  }

  .auth-subtitle {
    font-size: 0.7rem;
    font-weight: 300;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #5a5650;
    margin: 0;
  }

  .auth-divider {
    width: 2rem;
    height: 1px;
    background: #f0ede8;
    margin: 1.25rem 0 0;
  }

  .auth-error {
    font-size: 0.72rem;
    color: #e07060;
    letter-spacing: 0.04em;
    padding: 0.75rem 1rem;
    border-left: 2px solid #e07060;
    background: #1e1512;
    margin-bottom: 1.5rem;
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .auth-field {
    margin-bottom: 1.5rem;
  }

  .auth-label {
    display: block;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #5a5650;
    margin-bottom: 0.6rem;
    font-weight: 400;
  }

  .auth-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2e2b27;
    padding: 0.6rem 0;
    font-family: 'DM Mono', monospace;
    font-size: 0.875rem;
    font-weight: 300;
    color: #f0ede8;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-sizing: border-box;
  }

  .auth-input::placeholder {
    color: #3a3733;
    font-weight: 300;
  }

  .auth-input:focus {
    border-bottom-color: #f0ede8;
    box-shadow: 0 1px 0 0 #f0ede8;
  }

  @media (max-width: 480px) {
    .auth-input {
      font-size: 1rem; /* Prevent zoom on iOS */
      padding: 0.8rem 0;
    }
  }

  .auth-submit {
    width: 100%;
    margin-top: 2.5rem;
    padding: 0.9rem 1.5rem;
    background: #f0ede8;
    color: #111;
    border: none;
    font-family: 'DM Mono', monospace;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    min-height: 44px; /* Mobile touch target */
  }

  .auth-submit:hover:not(:disabled) {
    background: #d4d0cb;
    transform: translateY(-1px);
  }

  .auth-submit:active:not(:disabled) {
    transform: translateY(0);
  }

  .auth-submit:disabled {
    background: #2e2b27;
    color: #5a5650;
    cursor: not-allowed;
  }

  @media (max-width: 480px) {
    .auth-submit {
      margin-top: 2rem;
      font-size: 0.65rem;
    }
  }
  

.auth-footer {
  margin-top: 2rem;
  font-size: 0.7rem;
  color: #5a5650;
  letter-spacing: 0.05em;
}

  .auth-link {
    color: #f0ede8;
    text-decoration: none;
    border-bottom: 1px solid #f0ede8;
    padding-bottom: 1px;
  }

  .auth-link:hover {
    color: #a09c96;
    border-bottom-color: #a09c96;
  }

  .auth-hint {
    font-size: 0.62rem;
    color: #3a3733;
    letter-spacing: 0.05em;
    margin-top: 0.35rem;
    font-style: italic;
  }
`;

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password || !confirmPassword) { setError('All fields are required'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    const result = await register(email, password);
    setLoading(false);
    if (result.success) { navigate('/dashboard'); } else { setError(result.error); }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="auth-root">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-wordmark">Shrinkr</h1>
            <p className="auth-subtitle">Create your account</p>
            <div className="auth-divider" />
          </div>

          <form onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}

            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label">Password</label>
              <input
                type="password"
                className="auth-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <p className="auth-hint">At least 8 characters</p>
            </div>

            <div className="auth-field">
              <label className="auth-label">Confirm Password</label>
              <input
                type="password"
                className="auth-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <><Loader size={14} className="animate-spin" /> Creating account</>
              ) : 'Create account'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">Sign in</Link>
          </div>
        </div>
      </div>
    </>
  );
}