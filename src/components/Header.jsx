import React, { useState } from 'react';
import { supabase } from '../supabaseClient'; // <--- 1. Import Supabase directly
import { Icons } from './Icons';
import CesdLogo from '../assets/LOGO ahh.png'; 

const Header = ({ 
    userProfile, 
    notifications, 
    onNotificationsRead, 
    isDarkMode, 
    toggleDarkMode,
    toggleMobileSidebar 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const unreadCount = notifications.filter(n => !n.read).length;

    const handleToggle = () => {
        setIsOpen(!isOpen);
        if(!isOpen && unreadCount > 0) {
            onNotificationsRead();
        }
    }

    // --- 2. FIXED LOGOUT FUNCTION ---
    // This handles the logout directly without relying on props
    const handleLogout = async () => {
        console.log("Logout button clicked!"); // Check your browser console (F12) for this
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            console.log("Signed out successfully");
            // App.jsx will automatically detect this change and switch to the Login screen
        } catch (error) {
            console.error("Error logging out:", error.message);
            // Fallback: If Supabase fails, force a page reload to clear state
            window.location.reload();
        }
    };

    return (
        <header className="bg-white shadow-sm border-b border-gray-200 p-4 flex justify-between items-center z-40 relative dark:bg-gray-800 dark:border-gray-700 h-16">
            
            <div className="flex items-center gap-3">
                {/* HAMBURGER MENU */}
                <button 
                    onClick={toggleMobileSidebar}
                    className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg dark:text-gray-300 dark:hover:bg-gray-700"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                </button>

                <img src={CesdLogo} alt="CESD Logo" className="h-8 sm:h-10 w-auto" />
                <span className="hidden sm:block ml-2 text-lg font-bold text-gray-800 dark:text-gray-100 tracking-tight">
                    Employee Dashboard
                </span>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
                <button
                    onClick={toggleDarkMode}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-full dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                >
                    {isDarkMode ? Icons.Sun : Icons.Moon}
                </button>

                {/* Notifications */}
                <div className="relative">
                    <button onClick={handleToggle} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full dark:text-gray-400 dark:hover:bg-gray-700 transition-colors relative">
                        {Icons.Bell}
                        {unreadCount > 0 && (
                            <span className="absolute top-1 right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                        )}
                    </button>
                    {isOpen && (
                        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 dark:bg-gray-700 dark:border-gray-600">
                           <div className="py-2">
                             <div className="font-bold px-4 py-2 border-b border-gray-100 dark:border-gray-600 dark:text-white">Notifications</div>
                             <div className="max-h-64 overflow-y-auto">
                                {notifications.length > 0 ? notifications.map(n => (
                                    <div key={n.id} className={`px-4 py-3 border-b text-sm dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 ${!n.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                                        <p className="text-gray-800 dark:text-gray-200">{n.message}</p>
                                        <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                                    </div>
                                )) : <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No new notifications.</div>}
                             </div>
                           </div>
                        </div>
                    )}
                </div>

                {/* Avatar */}
                <div className="hidden sm:flex items-center gap-3 pl-2 border-l border-gray-200 dark:border-gray-700">
                    <div className="text-right hidden md:block">
                        <p className="text-sm font-bold text-gray-800 dark:text-white leading-none">{userProfile.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mt-1 capitalize">{userProfile.role}</p>
                    </div>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-blue-400 p-0.5">
                        <div className="w-full h-full rounded-full bg-white dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                            {userProfile.avatar_url ? (
                                <img src={userProfile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-blue-600 font-bold text-xs">{userProfile.initials}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* LOGOUT BUTTON - Updated to use local handler */}
                <button 
                    onClick={handleLogout} 
                    title="Logout" 
                    className="ml-2 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all dark:hover:bg-red-900/20 cursor-pointer z-50"
                >
                    {Icons.LogOut}
                </button>
            </div>
        </header>
    );
};

export default Header;