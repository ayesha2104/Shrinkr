import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Edit2, Copy, Loader, QrCode } from 'lucide-react';
import { urlAPI } from '../services/api';
import { copyToClipboard, formatDate, getShortUrl } from '../utils/helpers';
import EditURLModal from './EditURLModal';
import QRCodeModal from './QRCodeModal';

const ROASTS = {
    copy: [
        "Copied. Hope you don't paste it somewhere embarrassing.",
        "Copied. Now try not to lose it.",
        "Ctrl+C successful. Gold star for effort.",
        "Copied! Don't make us regret it.",
    ],
    edit: [
        "Saved. Truly riveting changes.",
        "Updated. The internet is forever altered.",
        "Saved. Hopefully an improvement.",
        "Changes saved. Bold choices were made.",
    ],
    deleteSuccess: [
        "Gone. Like it never existed.",
        "Deleted. Moving on with our lives.",
        "Yeet. Into the void it goes.",
        "Poof. What URL?",
    ],
    deleteCancel: [
        "Crisis averted. Coward.",
        "Chickened out. The URL lives.",
        "Phew. Maybe next time.",
    ],
};

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

const styles = `
  .ul-root {
    font-family: 'DM Mono', monospace;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .ul-section-title {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .ul-search {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-soft);
    padding: 0.55rem 0;
    font-family: 'DM Mono', monospace;
    font-size: 0.78rem;
    font-weight: 300;
    color: var(--text);
    outline: none;
    box-sizing: border-box;
    margin-bottom: 2rem;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .ul-search::placeholder {
    color: var(--text-placeholder);
  }

  .ul-search:focus {
    border-bottom-color: var(--text);
    box-shadow: 0 1px 0 0 var(--text);
  }

  @media (max-width: 640px) {
    .ul-search {
      font-size: 0.7rem;
      padding: 0.45rem 0;
    }
  }

  .ul-error {
    font-size: 0.72rem;
    color: var(--error-text);
    padding: 0.75rem 1rem;
    border-left: 2px solid var(--error-border);
    background: var(--error-bg);
    margin-bottom: 1.5rem;
  }

  .ul-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 0;
    gap: 0.75rem;
    color: var(--text-faint);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
  }

  .ul-empty {
    text-align: center;
    padding: 4rem 0;
    border-top: 1px solid var(--border);
  }

  .ul-empty-title {
    font-size: 0.8rem;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    margin: 0 0 0.4rem;
  }

  .ul-empty-sub {
    font-size: 0.68rem;
    color: var(--text-faint);
    opacity: 0.6;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .ul-list {
    display: flex;
    flex-direction: column;
    max-height: 520px;
    overflow-y: auto;
  }

  .ul-item {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }

  @media (max-width: 640px) {
    .ul-item {
      gap: 0.5rem;
      padding: 0.75rem 0;
    }
  }

  .ul-item:first-child { border-top: 1px solid var(--border); }

  .ul-privacy-badge {
    font-size: 1rem;
    flex-shrink: 0;
    width: 1.5rem;
    text-align: center;
  }

  .ul-info { flex: 1; min-width: 0; }

  .ul-short-code {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: 0.04em;
    margin: 0 0 0.2rem;
    display: block;
  }

  .ul-original-url {
    font-size: 0.68rem;
    font-weight: 300;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    margin: 0 0 0.2rem;
  }

  .ul-meta {
    font-size: 0.6rem;
    color: var(--text-faint);
    letter-spacing: 0.06em;
  }

  .ul-actions { 
    display: flex; 
    gap: 0.25rem; 
    flex-shrink: 0;
    min-width: max-content;
  }

  @media (max-width: 640px) {
    .ul-actions {
      gap: 0.15rem;
      order: 3;
      width: 100%;
      margin-top: 0.5rem;
    }
  }

  .ul-action-btn {
    background: none;
    border: none;
    padding: 0.45rem;
    cursor: pointer;
    color: var(--text-faint);
    display: flex;
    align-items: center;
    min-width: 32px;
    min-height: 32px;
    justify-content: center;
  }

  @media (max-width: 640px) {
    .ul-action-btn {
      min-width: 40px;
      min-height: 40px;
      padding: 0.6rem;
    }
  }

  .ul-action-btn:hover { color: var(--text); }
  .ul-action-btn.danger:hover { color: var(--error-text); }

  .ul-count {
    margin-top: 1.25rem;
    font-size: 0.62rem;
    color: var(--text-faint);
    letter-spacing: 0.08em;
  }

  /* ── Toast stack ── */
  .ul-toast-stack {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 9999;
    pointer-events: none;
    max-width: 320px;
    margin-left: auto;
    margin-right: auto;
  }

  @media (min-width: 640px) {
    .ul-toast-stack {
      bottom: 1.5rem;
      right: 1.5rem;
      left: auto;
      max-width: 280px;
    }
  }

  .ul-toast {
    font-family: 'DM Mono', monospace;
    font-size: 0.72rem;
    padding: 0.65rem 0.9rem;
    background: var(--bg, #fff);
    border: 1px solid var(--border);
    color: var(--text);
    max-width: 280px;
    line-height: 1.5;
    pointer-events: all;
    animation: toast-in 0.18s ease;
  }

  .ul-toast.confirm { border-color: var(--error-border); }

  .ul-toast-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .ul-toast-btn {
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--border);
    background: none;
    cursor: pointer;
    color: var(--text);
  }

  .ul-toast-btn.danger {
    border-color: var(--error-border);
    color: var(--error-text);
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateX(10px); }
    to   { opacity: 1; transform: translateX(0); }
  }
`;

let toastId = 0;

export default function URLList({ refresh, onEdit }) {
    const [showQR, setShowQR] = useState(null);
    const [editingURL, setEditingURL] = useState(null);
    const [urls, setUrls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [toasts, setToasts] = useState([]);

    useEffect(() => { fetchUrls(); }, [refresh]);

    const fetchUrls = async () => {
        try {
            setLoading(true); setError('');
            const response = await urlAPI.getAllUrls();
            setUrls(response.data.data || []);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to fetch URLs');
        } finally {
            setLoading(false);
        }
    };

    const pushToast = useCallback((content, type = 'info', duration = 3000) => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, content, type }]);
        if (duration) setTimeout(() => dismissToast(id), duration);
        return id;
    }, []);

    const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

    const handleDelete = (shortCode) => {
        const id = pushToast(
            <div>
                <div>Delete this URL? You'll actually miss it.</div>
                <div className="ul-toast-actions">
                    <button className="ul-toast-btn danger" onClick={async () => {
                        dismissToast(id);
                        try {
                            await urlAPI.deleteUrl(shortCode);
                            setUrls(prev => prev.filter(u => u.short_code !== shortCode));
                            pushToast(rand(ROASTS.deleteSuccess));
                        } catch (err) {
                            setError(err.response?.data?.error || 'Failed to delete URL');
                        }
                    }}>Yeah, nuke it</button>
                    <button className="ul-toast-btn" onClick={() => {
                        dismissToast(id);
                        pushToast(rand(ROASTS.deleteCancel));
                    }}>Nevermind</button>
                </div>
            </div>,
            'confirm',
            0
        );
    };

    const handleCopy = async (text) => {
        const ok = await copyToClipboard(text);
        if (ok) pushToast(rand(ROASTS.copy));
    };

    const filteredUrls = urls.filter(url =>
        url.short_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        url.original_url.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <>
            <style>{styles}</style>
            <div className="ul-root">
                <p className="ul-section-title">Your URLs</p>
                {error && <div className="ul-error">{error}</div>}

                <input type="text" className="ul-search" placeholder="Search by code or URL..."
                    value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />

                {loading ? (
                    <div className="ul-loading">
                        <Loader size={20} className="animate-spin" />
                        <span>Loading</span>
                    </div>
                ) : filteredUrls.length === 0 ? (
                    <div className="ul-empty">
                        <p className="ul-empty-title">No URLs yet</p>
                        <p className="ul-empty-sub">Create your first shortened URL</p>
                    </div>
                ) : (
                    <div className="ul-list">
                        {filteredUrls.map((url) => (
                            <div key={url.short_code} className="ul-item">
                                <span className="ul-privacy-badge">{url.is_public ? '🌍' : '🔒'}</span>
                                <div className="ul-info">
                                    <span className="ul-short-code">{url.short_code}</span>
                                    <span className="ul-original-url">{url.original_url}</span>
                                    <span className="ul-meta">{url.clicks} clicks · {formatDate(url.created_at)}</span>
                                </div>
                                <div className="ul-actions">
                                    <button className="ul-action-btn" title="Copy" onClick={() => handleCopy(getShortUrl(url.short_code))}><Copy size={15} /></button>
                                    <button className="ul-action-btn" title="Edit" onClick={() => setEditingURL(url)}><Edit2 size={15} /></button>
                                    <button className="ul-action-btn" title="QR Code" onClick={() => setShowQR(url.short_code)}><QrCode size={15} /></button>
                                    <button className="ul-action-btn danger" title="Delete" onClick={() => handleDelete(url.short_code)}><Trash2 size={15} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {filteredUrls.length > 0 && (
                    <p className="ul-count">{filteredUrls.length} of {urls.length} URLs</p>
                )}

                {/* Toast stack */}
                <div className="ul-toast-stack">
                    {toasts.map(t => (
                        <div key={t.id} className={`ul-toast${t.type === 'confirm' ? ' confirm' : ''}`}>
                            {t.content}
                        </div>
                    ))}
                </div>

                {editingURL && (
                    <EditURLModal url={editingURL} onClose={() => setEditingURL(null)}
                        onSave={(updated) => {
                            setUrls(urls.map(u => u.short_code === updated.short_code ? updated : u));
                            setEditingURL(null);
                            pushToast(rand(ROASTS.edit));
                        }} />
                )}
                {showQR && <QRCodeModal shortCode={showQR} onClose={() => setShowQR(null)} />}
            </div>
        </>
    );
}