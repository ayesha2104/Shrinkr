import React, { useState } from 'react';
import { Copy, QrCode, Loader } from 'lucide-react';
import { urlAPI } from '../services/api';
import { copyToClipboard, getShortUrl } from '../utils/helpers';
import QRCodeModal from './QRCodeModal';

const styles = `
  .uf-root { font-family: 'DM Mono', monospace; }

  .uf-section-title {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .uf-error {
    font-size: 0.72rem;
    color: var(--error-text);
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--error-border);
    background: var(--error-bg);
    margin-bottom: 1.5rem;
  }

  .uf-success {
    font-size: 0.72rem;
    color: var(--success-text);
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--success-border);
    background: var(--success-bg);
    margin-bottom: 1.5rem;
  }

  .uf-field { margin-bottom: 1.75rem; }

  .uf-label {
    display: block;
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.55rem;
  }

  .uf-input, .uf-select {
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
    -webkit-appearance: none;
    appearance: none;
  }

  .uf-input::placeholder { color: var(--text-placeholder); }
  .uf-input:focus, .uf-select:focus { border-bottom-color: var(--text); }

  .uf-select option { background: var(--bg); color: var(--text); }

  .uf-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }

  @media (max-width: 640px) {
    .uf-row {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
  }

  .uf-privacy-btn {
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

  .uf-privacy-btn:hover { border-bottom-color: var(--text); }

  .uf-submit {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.85rem;
    background: var(--accent);
    color: var(--accent-fg);
    border: 1px solid var(--accent);
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .uf-submit:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .uf-submit:active:not(:disabled) {
    transform: translateY(0);
  }

  .uf-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
  }

  .uf-submit:hover { background: var(--accent-hover); }
  .uf-submit:disabled { opacity: 0.4; cursor: not-allowed; }

  .uf-result {
    margin-top: 2.5rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
  }

  .uf-result-title {
    font-size: 0.62rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 1.25rem;
  }

  .uf-result-field { margin-bottom: 1rem; }

  .uf-result-label {
    font-size: 0.6rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 0.4rem;
    display: block;
  }

  .uf-result-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .uf-result-value {
    flex: 1;
    font-size: 0.8rem;
    font-weight: 300;
    color: var(--text);
    border-bottom: 1px solid var(--border);
    padding: 0.4rem 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .uf-copy-btn {
    background: none;
    border: 1px solid var(--border-soft);
    padding: 0.4rem 0.75rem;
    font-family: 'DM Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
  }

  .uf-copy-btn:hover { border-color: var(--text); color: var(--text); }

  .uf-qr-btn {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.7rem;
    background: transparent;
    border: 1px solid var(--border-soft);
    font-family: 'DM Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .uf-qr-btn:hover { border-color: var(--text); color: var(--text); }

  .uf-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .uf-stat { border-top: 1px solid var(--border); padding-top: 0.75rem; }

  .uf-stat-label {
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-faint);
    margin-bottom: 0.25rem;
    display: block;
  }

  .uf-stat-value { font-size: 1rem; font-weight: 400; color: var(--text); }
`;

export default function URLForm({ onURLCreated }) {
    const [showQR, setShowQR] = useState(false);
    const [originalUrl, setOriginalUrl] = useState('');
    const [expirationDays, setExpirationDays] = useState(30);
    const [isPublic, setIsPublic] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [createdURL, setCreatedURL] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');
        if (!originalUrl.trim()) { setError('Please enter a URL'); return; }
        if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
            setError('URL must start with http:// or https://'); return;
        }
        setLoading(true);
        try {
            const response = await urlAPI.createUrl(originalUrl, expirationDays, isPublic);
            const newURL = response.data.data;
            setCreatedURL(newURL);
            setSuccess('URL shortened successfully');
            setOriginalUrl('');
            if (onURLCreated) onURLCreated(newURL);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create shortened URL');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async (text) => {
        const ok = await copyToClipboard(text);
        if (ok) { setSuccess('Copied to clipboard'); setTimeout(() => setSuccess(''), 2000); }
    };

    return (
        <>
            <style>{styles}</style>
            <div className="uf-root">
                <p className="uf-section-title">New URL</p>

                <form onSubmit={handleSubmit}>
                    {error && <div className="uf-error">{error}</div>}
                    {success && <div className="uf-success">{success}</div>}

                    <div className="uf-field">
                        <label className="uf-label">Destination URL</label>
                        <input type="url" className="uf-input" value={originalUrl}
                            onChange={(e) => setOriginalUrl(e.target.value)}
                            placeholder="https://example.com/long-url" />
                    </div>

                    <div className="uf-row">
                        <div className="uf-field">
                            <label className="uf-label">Expires in</label>
                            <select className="uf-select" value={expirationDays}
                                onChange={(e) => setExpirationDays(parseInt(e.target.value))}>
                                <option value={1}>1 day</option>
                                <option value={7}>7 days</option>
                                <option value={30}>30 days</option>
                                <option value={90}>90 days</option>
                                <option value={365}>1 year</option>
                            </select>
                        </div>
                        <div className="uf-field">
                            <label className="uf-label">Visibility</label>
                            <button type="button" className="uf-privacy-btn" onClick={() => setIsPublic(!isPublic)}>
                                {isPublic ? '🌍 Public' : '🔒 Private'}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className="uf-submit" disabled={loading}>
                        {loading ? <><Loader size={13} className="animate-spin" /> Shortening</> : 'Shorten URL'}
                    </button>
                </form>

                {createdURL && (
                    <div className="uf-result">
                        <p className="uf-result-title">Shortened</p>
                        <div className="uf-result-field">
                            <span className="uf-result-label">Short code</span>
                            <div className="uf-result-row">
                                <span className="uf-result-value">{createdURL.short_code}</span>
                                <button className="uf-copy-btn" onClick={() => handleCopy(getShortUrl(createdURL.short_code))}>
                                    <Copy size={11} /> Copy
                                </button>
                            </div>
                        </div>
                        <div className="uf-result-field">
                            <span className="uf-result-label">Full URL</span>
                            <div className="uf-result-row">
                                <span className="uf-result-value">{getShortUrl(createdURL.short_code)}</span>
                                <button className="uf-copy-btn" onClick={() => handleCopy(getShortUrl(createdURL.short_code))}>
                                    <Copy size={11} /> Copy
                                </button>
                            </div>
                        </div>
                        <button className="uf-qr-btn" onClick={() => setShowQR(true)}>
                            <QrCode size={13} /> Show QR Code
                        </button>
                        <div className="uf-stats">
                            <div className="uf-stat">
                                <span className="uf-stat-label">Clicks</span>
                                <span className="uf-stat-value">{createdURL.clicks}</span>
                            </div>
                            <div className="uf-stat">
                                <span className="uf-stat-label">Created</span>
                                <span className="uf-stat-value" style={{ fontSize: '0.72rem' }}>
                                    {new Date(createdURL.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="uf-stat">
                                <span className="uf-stat-label">Privacy</span>
                                <span className="uf-stat-value">{createdURL.is_public ? '🌍' : '🔒'}</span>
                            </div>
                        </div>
                    </div>
                )}

                {showQR && <QRCodeModal shortCode={createdURL.short_code} onClose={() => setShowQR(false)} />}
            </div>
        </>
    );
}