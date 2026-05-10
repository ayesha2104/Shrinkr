import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LogOut, Menu, X, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import URLForm from '../components/URLForm';
import URLList from '../components/URLList';

const styles = `
  .dash-root {
    min-height: 100vh;
    background: var(--bg);
  }

  .dash-nav {
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .dash-nav-inner {
    max-width: 100%;
    margin: 0 auto;
    padding: 0 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 60px;
    gap: 1rem;
    flex-wrap: wrap;
  }

  @media (min-width: 900px) {
    .dash-nav-inner {
      padding: 0 2rem;
    }
  }

  .dash-wordmark {
    font-family: 'Playfair Display', serif;
    font-size: 1.5rem;
    font-weight: 400;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0;
    white-space: nowrap;
  }

  .dash-nav-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  @media (max-width: 640px) {
    .dash-nav-right {
      gap: 0.5rem;
    }
  }

  .dash-user-email {
    font-size: 0.68rem;
    color: var(--text-muted);
    letter-spacing: 0.08em;
    max-width: 150px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 640px) {
    .dash-user-email {
      display: none;
    }
  }

  .dash-theme-toggle {
    background: none;
    border: 1px solid var(--border-soft);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
  }

  .dash-theme-toggle:hover {
    border-color: var(--text);
    color: var(--text);
  }

  .dash-logout-btn {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--border-soft);
    padding: 0.45rem 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dash-logout-btn:hover {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }

  .dash-mobile-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
    display: none;
    padding: 0.5rem;
  }

  /* Mobile responsiveness */
  @media (max-width: 768px) {
    .dash-nav-inner {
      padding: 0 1.25rem;
    }

    .dash-mobile-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dash-nav-desktop {
      display: none;
    }

    .dash-nav-desktop.open {
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 60px;
      left: 0;
      right: 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 1rem 1.25rem;
      gap: 1rem;
      z-index: 40;
      animation: slideUp 0.2s ease;
    }
  }

  /* Container responsiveness */
  @media (max-width: 1024px) {
    .dash-content {
      grid-template-columns: 1fr;
    }
  }

  .dash-mobile-menu {
    border-top: 1px solid var(--border);
    padding: 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--bg);
    width: 100%;
  }

  @media (min-width: 900px) {
    .dash-mobile-menu {
      padding: 1.25rem 2rem;
    }
  }

  .dash-mobile-email {
    font-size: 0.68rem;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }

  .dash-mobile-row {
    display: flex;
    gap: 0.75rem;
  }

  .dash-mobile-logout {
    flex: 1;
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-fg);
    background: var(--accent);
    border: none;
    padding: 0.7rem 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dash-mobile-theme {
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border-soft);
    padding: 0.7rem 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dash-main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  @media (min-width: 640px) {
    .dash-main {
      padding: 2.5rem 1.5rem;
    }
  }

  @media (min-width: 1024px) {
    .dash-main {
      padding: 3.5rem 2rem;
    }
  }

  .dash-welcome {
    margin-bottom: 3rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid var(--border);
  }

  .dash-welcome-heading {
    font-family: 'Playfair Display', serif;
    font-size: 1.75rem;
    font-weight: 400;
    color: var(--text);
    margin: 0 0 0.4rem;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 415px) {
    .dash-welcome-heading {
      font-size: 1.25rem;
    }
  }

  .dash-welcome-sub {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    margin: 0;
  }

  .dash-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }

  @media (min-width: 900px) {
    .dash-grid {
      grid-template-columns: 1fr 2fr;
    }
  }

  @media (max-width: 900px) {
    .dash-mobile-toggle {
      display: flex;
    }
    .dash-nav-right {
      display: none;
    }
  }

  @media (min-width: 900px) {
    .dash-mobile-toggle {
      display: none;
    }
  }
`;

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [refreshList, setRefreshList] = useState(0);
  const [editingURL, setEditingURL] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };
  const handleURLCreated = () => setRefreshList(prev => prev + 1);

  const emailUser = user?.email?.split('@')[0];

  return (
    <>
      <style>{styles}</style>
      <div className="dash-root">
        <nav className="dash-nav">
          <div className="dash-nav-inner">
            <h1 className="dash-wordmark">Shrinkr</h1>

            <div className="dash-nav-right">
              <span className="dash-user-email">{user?.email}</span>
              <button className="dash-theme-toggle" onClick={toggle} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
                {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
              </button>
              <button className="dash-logout-btn" onClick={handleLogout}>
                <LogOut size={13} /> Sign out
              </button>
            </div>

            <button className="dash-mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="dash-mobile-menu">
              <span className="dash-mobile-email">{user?.email}</span>
              <div className="dash-mobile-row">
                <button className="dash-mobile-logout" onClick={handleLogout}>
                  <LogOut size={14} /> Sign out
                </button>
                <button className="dash-mobile-theme" onClick={toggle}>
                  {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                  {theme === 'light' ? 'Dark' : 'Light'}
                </button>
              </div>
            </div>
          )}
        </nav>

        <div className="dash-main">
          <div className="dash-welcome">
            <h2 className="dash-welcome-heading">
              Hello, <span title={user?.email}>{emailUser}</span>
            </h2>
            <p className="dash-welcome-sub">Manage and create shortened URLs</p>
          </div>

          <div className="dash-grid">
            <div><URLForm onURLCreated={handleURLCreated} /></div>
            <div><URLList refresh={refreshList} onEdit={setEditingURL} /></div>
          </div>
        </div>
      </div>
    </>
  );
}