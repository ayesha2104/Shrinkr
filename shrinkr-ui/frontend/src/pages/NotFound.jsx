import React from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
                <h1 className="text-6xl font-bold text-gray-800 mb-4">404</h1>
                <p className="text-gray-600 text-lg mb-8">Page not found</p>
                <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg transition"
                >
                    <Home size={20} />
                    Go Home
                </Link>
            </div>
        </div>
    );
}