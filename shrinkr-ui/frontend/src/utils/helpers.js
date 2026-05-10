// Copy text to clipboard
export const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
};

// Format date nicely
export const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

// Truncate long URLs
export const truncateUrl = (url, maxLength = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
};

// Generate short URL full link
export const getShortUrl = (shortCode) => {
    return `${import.meta.env.VITE_API_URL || 'https://shrinkr-zlrw.onrender.com'}/${shortCode}`;
};

// Validate URL format
export const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

// Format click count nicely
export const formatClicks = (clicks) => {
    if (clicks >= 1000000) return (clicks / 1000000).toFixed(1) + 'M';
    if (clicks >= 1000) return (clicks / 1000).toFixed(1) + 'K';
    return clicks.toString();
};