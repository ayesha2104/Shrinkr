import React, { useState } from 'react';
import { X, Loader } from 'lucide-react';
import { urlAPI } from '../services/api';

const styles = `
  .em-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 50;
    backdrop-filter: blur(2px);
    animation: fadeIn 0.2s ease;
    overflow-y: auto;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .em-panel {
    background: var(--bg);
    width: 100%;
    max-width: 440px;
    padding: 1.5rem;
    font-family: 'DM Mono', monospace;
    border: 1px solid var(--border);
    animation: slideUp 0.3s ease;
    border-radius: 4px;
    box-sizing: border-box;
    margin: auto;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (min-width: 640px) {
    .em-panel {
      padding: 2.5rem;
    }
  }

  .em-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .em-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.2rem;
    font-weight: 400;
    color: var(--text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .em-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-faint);
    padding: 0;
    display: flex;
  }

  .em-close:hover { color: var(--text); }

  .em-error {
    font-size: 0.72rem;
    color: var(--error-text);
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--error-border);
    background: var(--error-bg);
    margin-bottom: 1.5rem;
  }

  .em-field { margin-bottom: 1.75rem; }

  .em-label {
    display: block;
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.55rem;
  }

  .em-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-soft);
    padding: 0.55rem 0;
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    font-weight: 300;
    color: var(--text);
    outline: none;
    box-sizing: border-box;
  }

  .em-input:focus { border-bottom-color: var(--text); }

  .em-input[readonly] {
    color: var(--text-faint);
    cursor: default;
    border-bottom-color: var(--border);
  }

  .em-privacy-btn {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-soft);
    padding: 0.55rem 0;
    font-family: 'DM Mono', monospace;
    font-size: 0.8rem;
    font-weight: 300;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }

  .em-privacy-btn:hover { border-bottom-color: var(--text); }

  .em-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 2rem;
  }

  .em-save-btn {
    padding: 0.8rem;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .em-save-btn:hover { background: var(--accent-hover); }
  .em-save-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .em-cancel-btn {
    padding: 0.8rem;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border-soft);
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 400;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .em-cancel-btn:hover { border-color: var(--text); color: var(--text); }
`;

export default function EditURLModal({ url, onClose, onSave }) {
  const [originalUrl, setOriginalUrl] = useState(url?.original_url || '');
  const [isPublic, setIsPublic] = useState(url?.is_public || false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (!originalUrl.trim()) { setError('URL cannot be empty'); return; }
    if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
      setError('URL must start with http:// or https://'); return;
    }
    setLoading(true);
    try {
      await urlAPI.updateUrl(url.short_code, originalUrl, isPublic);
      onSave?.({ ...url, original_url: originalUrl, is_public: isPublic });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="em-overlay">
        <div className="em-panel">
          <div className="em-header">
            <h3 className="em-title">Edit URL</h3>
            <button className="em-close" onClick={onClose}><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit}>
            {error && <div className="em-error">{error}</div>}
            <div className="em-field">
              <label className="em-label">Short Code</label>
              <input className="em-input" type="text" value={url?.short_code} readOnly />
            </div>
            <div className="em-field">
              <label className="em-label">Destination URL</label>
              <input className="em-input" type="url" value={originalUrl}
                onChange={(e) => setOriginalUrl(e.target.value)} />
            </div>
            <div className="em-field">
              <label className="em-label">Visibility</label>
              <button type="button" className="em-privacy-btn" onClick={() => setIsPublic(!isPublic)}>
                {isPublic ? '🌍 Public' : '🔒 Private'}
              </button>
            </div>
            <div className="em-actions">
              <button type="submit" className="em-save-btn" disabled={loading}>
                {loading ? <><Loader size={13} className="animate-spin" /> Saving</> : 'Save'}
              </button>
              <button type="button" className="em-cancel-btn" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}