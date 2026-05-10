// Get token from localStorage
export const getToken = () => {
    return localStorage.getItem('auth_token');
};

// Save token to localStorage
export const setToken = (token) => {
    localStorage.setItem('auth_token', token);
};

// Remove token from localStorage
export const removeToken = () => {
    localStorage.removeItem('auth_token');
};

// Check if user is logged in
export const isLoggedIn = () => {
    return !!getToken();
};

// Clear all auth data
export const clearAuth = () => {
    removeToken();
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_id');
};

// Save user info
export const saveUserInfo = (user) => {
    localStorage.setItem('user_id', user.id);
    localStorage.setItem('user_email', user.email);
};

// Get user info
export const getUserInfo = () => {
    return {
        id: localStorage.getItem('user_id'),
        email: localStorage.getItem('user_email'),
    };
};