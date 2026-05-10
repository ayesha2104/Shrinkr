import React, { createContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';
import { getToken, setToken, removeToken, isLoggedIn, saveUserInfo, clearAuth } from '../utils/token';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Check if user is logged in on mount
    useEffect(() => {
        const initAuth = async () => {
            if (isLoggedIn()) {
                try {
                    const response = await authAPI.getCurrentUser();
                    setUser(response.data.user);
                } catch (err) {
                    console.error('Failed to fetch user:', err);
                    clearAuth();
                    setUser(null);
                }
            }
            setLoading(false);
        };

        initAuth();
    }, []);

    // Register user
    const register = async (email, password) => {
        try {
            setError(null);
            const response = await authAPI.register(email, password);
            const { token, user: userData } = response.data;

            setToken(token);
            saveUserInfo(userData);
            setUser(userData);

            return { success: true };
        } catch (err) {
            const errorMsg = err.response?.data?.error || 'Registration failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        }
    };

    // Login user
    const login = async (email, password) => {
        try {
            setError(null);
            const response = await authAPI.login(email, password);
            const { token, user: userData } = response.data;

            setToken(token);
            saveUserInfo(userData);
            setUser(userData);

            return { success: true };
        } catch (err) {
            const errorMsg = err.response?.data?.error || 'Login failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
        }
    };

    // Logout user
    const logout = () => {
        clearAuth();
        setUser(null);
        setError(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                error,
                register,
                login,
                logout,
                isLoggedIn: !!user,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = React.useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};