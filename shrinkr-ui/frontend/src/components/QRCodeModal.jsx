import React, { useRef, useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { getShortUrl } from '../utils/helpers';
import { useTheme } from '../context/ThemeContext';

const styles = `
  .qr-overlay {
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

  .qr-panel {
    background: var(--bg);
    width: 100%;
    max-width: 360px;
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
    .qr-panel {
      padding: 2.5rem;
    }
  }

  .qr-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .qr-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.2rem;
    font-weight: 400;
    color: var(--text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .qr-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-faint);
    padding: 0;
    display: flex;
  }

  .qr-close:hover { color: var(--text); }

  .qr-canvas-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    background: var(--bg-inset);
    margin-bottom: 1.25rem;
    border: 1px solid var(--border);
    min-height: 288px;
    position: relative;
  }

  .qr-loading {
    position: absolute;
    font-size: 0.68rem;
    color: var(--text-faint);
    letter-spacing: 0.1em;
  }

  .qr-canvas-hidden {
    opacity: 0;
  }

  .qr-url {
    font-size: 0.65rem;
    color: var(--text-faint);
    text-align: center;
    letter-spacing: 0.04em;
    word-break: break-all;
    margin-bottom: 1.75rem;
  }

  .qr-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .qr-download-btn {
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

  .qr-download-btn:hover { background: var(--accent-hover); }

  .qr-close-btn {
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

  .qr-close-btn:hover { border-color: var(--text); color: var(--text); }
`;

export default function QRCodeModal({ shortCode, onClose }) {
  const canvasRef = useRef();
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const shortUrl = getShortUrl(shortCode);

  useEffect(() => {
    if (canvasRef.current) {
      const isDark = theme === 'dark';
      QRCode.toCanvas(canvasRef.current, shortUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: isDark ? '#f9f8f6' : '#111111',
          light: isDark ? '#1a1a1a' : '#ffffff',
        }
      }, (error) => {
        if (error) console.error(error);
        setLoading(false);
      });
    }
  }, [shortUrl, theme]);

  const downloadQR = () => {
    const url = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url; link.download = `shrinkr-${shortCode}.png`; link.click();
  };

  return (
    <>
      <style>{styles}</style>
      <div className="qr-overlay">
        <div className="qr-panel">
          <div className="qr-header">
            <h3 className="qr-title">QR Code</h3>
            <button className="qr-close" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="qr-canvas-wrap">
            {loading && <span className="qr-loading">Generating...</span>}
            <canvas ref={canvasRef} className={loading ? 'qr-canvas-hidden' : ''} />
          </div>
          <p className="qr-url">{shortUrl}</p>
          <div className="qr-actions">
            <button className="qr-download-btn" onClick={downloadQR}>
              <Download size={13} /> Download
            </button>
            <button className="qr-close-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}