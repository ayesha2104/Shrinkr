import axios from 'axios';

// Use the deployed backend URL
const API_URL = import.meta.env.VITE_API_URL || 'https://shrinkr-zlrw.onrender.com';

// Create axios instance
const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add token to every request (if it exists)
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Token expired or invalid - clear it
            localStorage.removeItem('auth_token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// ===== AUTH ENDPOINTS =====
export const authAPI = {
    register: (email, password) =>
        api.post('/auth/register', { email, password }),

    login: (email, password) =>
        api.post('/auth/login', { email, password }),

    getCurrentUser: () =>
        api.get('/auth/me'),
};

// ===== URL ENDPOINTS =====
export const urlAPI = {
    // Create a shortened URL
    createUrl: (original_url, expiration_days = 30, is_public = false) =>
        api.post('/urls', { original_url, expiration_days, is_public }),

    // Get all user's URLs (requires auth)
    getAllUrls: () =>
        api.get('/urls'),

    // Get a single URL by short code
    getUrlByCode: (shortCode) =>
        api.get(`/urls/${shortCode}`),

    // Update a URL (requires auth + ownership)
    updateUrl: (shortCode, original_url, is_public) =>
        api.put(`/urls/${shortCode}`, { original_url, is_public }),

    // Delete a URL (requires auth + ownership)
    deleteUrl: (shortCode) =>
        api.delete(`/urls/${shortCode}`),

    // Redirect endpoint (for testing)
    redirect: (shortCode) =>
        window.location.href = `${API_URL}/${shortCode}`,
};

export default api;