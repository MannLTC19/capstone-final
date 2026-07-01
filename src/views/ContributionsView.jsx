import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Briefcase, Send, Filter, Calendar, User, MessageSquare } from 'lucide-react';

const ContributionsView = ({ userProfile, contributions = [], allUsers = [], fetchContributions }) => {
    // --- TAB STATE ---
    const [activeTab, setActiveTab] = useState('logs'); // 'logs' or 'forum'

    // --- ACTIVITY LOG STATES (Friend's Code) ---
    const [newLog, setNewLog] = useState('');
    const [logCategory, setLogCategory] = useState('General');
    const [selectedEmployee, setSelectedEmployee] = useState('all');
    const [selectedDate, setSelectedDate] = useState('');
    
    // --- FORUM STATES (Your Code) ---
    const [newPost, setNewPost] = useState('');
    const [forumCategory, setForumCategory] = useState('General Discussion');
    const [replyInputs, setReplyInputs] = useState({});
    const [submittingReplyId, setSubmittingReplyId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedForumCategory, setSelectedForumCategory] = useState('all');
    
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Categories
    const LOG_CATEGORIES = [
        { name: 'General', color: 'bg-gray-100 text-gray-700', active: 'bg-gray-800 text-white' },
        { name: 'Bug Fix', color: 'bg-red-50 text-red-700', active: 'bg-red-600 text-white' },
        { name: 'Client Help', color: 'bg-blue-50 text-blue-700', active: 'bg-blue-600 text-white' },
    ];

    const FORUM_CATEGORIES = [
        { name: 'General Discussion', color: 'bg-gray-100 text-gray-700', active: 'bg-blue-600 text-white' },
        { name: 'Help Request ❓', color: 'bg-amber-50 text-amber-700', active: 'bg-amber-500 text-white' },
        { name: 'Urgent Blocker 🚨', color: 'bg-red-50 text-red-700', active: 'bg-red-600 text-white' },
    ];

    const getUserName = (id) => allUsers.find(u => String(u.id) === String(id))?.name || 'Unknown User';
    const getUserRole = (id) => allUsers.find(u => String(u.id) === String(id))?.role || 'employee';

    // --- LOGIC: ACTIVITY LOGS ---
    const handleSubmitLog = async () => {
        if (!newLog.trim()) return;
        setIsSubmitting(true);
        try {
            await supabase.from('contributions').insert({
                employee_id: userProfile.id,
                date: new Date().toISOString().split('T')[0],
                contribution: newLog,
                category: logCategory,
                is_log: true // Distinguishes between logs and forum posts
            });
            setNewLog('');
            fetchContributions();
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredLogs = contributions.filter(item => {
        if (!item.is_log) return false;
        const matchEmployee = selectedEmployee === 'all' || item.employee_id === selectedEmployee;
        const matchDate = !selectedDate || item.date === selectedDate;
        if (userProfile.role !== 'supervisor') return item.employee_id === userProfile.id && matchDate;
        return matchEmployee && matchDate;
    });

    // --- LOGIC: FORUM ---
    const handleCreateThread = async () => {
        if (!newPost.trim()) return;
        setIsSubmitting(true);
        try {
            await supabase.from('contributions').insert({
                employee_id: userProfile.id,
                date: new Date().toISOString().split('T')[0],
                contribution: newPost.trim(),
                category: forumCategory,
                replies: [],
                is_log: false
            });
            setNewPost('');
            fetchContributions(); 
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteThread = async (postId) => {
        if (!confirm("Delete this thread?")) return;
        await supabase.from('contributions').delete().eq('id', postId);
        fetchContributions();
    };

    const handleSendReply = async (postId, currentReplies = []) => {
        const text = replyInputs[postId];
        if (!text || !text.trim()) return;
        setSubmittingReplyId(postId);
        
        const nextReply = {
            id: `reply-${Date.now()}`,
            author_id: userProfile.id,
            message: text.trim(),
            timestamp: new Date().toLocaleTimeString()
        };

        await supabase.from('contributions').update({ replies: [...currentReplies, nextReply] }).eq('id', postId);
        setReplyInputs(prev => ({ ...prev, [postId]: '' })); 
        fetchContributions();
        setSubmittingReplyId(null);
    };

    const filteredThreads = contributions.filter(post => {
        if (post.is_log) return false;
        const matchesSearch = post.contribution.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedForumCategory === 'all' || post.category === selectedForumCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            
            {/* --- HEADER & TABS --- */}
            <div className="flex flex-col md:flex-row justify-between border-b border-gray-200 pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Workspace Activity</h1>
                    <p className="text-sm text-gray-500">Manage daily logs and team discussions.</p>
                </div>
                <div className="flex gap-2 mt-4 md:mt-0 bg-gray-100 p-1 rounded-lg">
                    <button onClick={() => setActiveTab('logs')} className={`px-4 py-2 text-sm font-bold rounded-md ${activeTab === 'logs' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Activity Logs</button>
                    <button onClick={() => setActiveTab('forum')} className={`px-4 py-2 text-sm font-bold rounded-md ${activeTab === 'forum' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Discussion Forum</button>
                </div>
            </div>

            {/* --- TAB: ACTIVITY LOGS --- */}
            {activeTab === 'logs' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-white rounded-xl shadow-sm border p-6">
                        <textarea value={newLog} onChange={(e) => setNewLog(e.target.value)} className="w-full p-4 border rounded-lg text-sm bg-gray-50" placeholder="What did you work on today?" rows="2"></textarea>
                        <div className="flex justify-between items-center mt-4">
                            <div className="flex gap-2">
                                {LOG_CATEGORIES.map(cat => (
                                    <button key={cat.name} onClick={() => setLogCategory(cat.name)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${logCategory === cat.name ? cat.active : cat.color}`}>
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                            <button onClick={handleSubmitLog} disabled={!newLog.trim() || isSubmitting} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Log Activity</button>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase">Employee</th>
                                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredLogs.map(item => (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="p-4 text-sm font-mono text-gray-500">{item.date}</td>
                                        <td className="p-4 font-medium">{getUserName(item.employee_id)}</td>
                                        <td className="p-4 text-sm text-gray-600">{item.contribution}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* --- TAB: FORUM --- */}
            {activeTab === 'forum' && (
                <div className="space-y-6 animate-fade-in">
                    <div className="bg-white rounded-xl shadow-sm border p-6">
                        <textarea value={newPost} onChange={(e) => setNewPost(e.target.value)} className="w-full p-4 border rounded-lg text-sm bg-gray-50" placeholder="Ask a question or share a blocker..." rows="3"></textarea>
                        <div className="flex justify-between items-center mt-4">
                            <div className="flex gap-2">
                                {FORUM_CATEGORIES.map(cat => (
                                    <button key={cat.name} onClick={() => setForumCategory(cat.name)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${forumCategory === cat.name ? cat.active : cat.color}`}>
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                            <button onClick={handleCreateThread} disabled={!newPost.trim() || isSubmitting} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Publish Thread</button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {filteredThreads.map(post => {
                            const canDelete = userProfile.role === 'supervisor' || String(post.employee_id) === String(userProfile.id);
                            return (
                                <div key={post.id} className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className="font-bold text-gray-800">{getUserName(post.employee_id)}</h4>
                                            <span className="text-[10px] uppercase font-bold text-gray-400">{post.category}</span>
                                        </div>
                                        {canDelete && <button onClick={() => handleDeleteThread(post.id)} className="text-red-500 text-xs">Delete</button>}
                                    </div>
                                    <p className="text-sm text-gray-700">{post.contribution}</p>
                                    
                                    {/* Replies */}
                                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                                        {(post.replies || []).map(reply => (
                                            <div key={reply.id} className="text-xs">
                                                <span className="font-bold">{getUserName(reply.author_id)}: </span>
                                                <span className="text-gray-600">{reply.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <div className="flex gap-2">
                                        <input type="text" value={replyInputs[post.id] || ''} onChange={(e) => setReplyInputs(prev => ({ ...prev, [post.id]: e.target.value }))} className="flex-1 p-2 text-xs border rounded-lg" placeholder="Reply..." />
                                        <button onClick={() => handleSendReply(post.id, post.replies)} className="bg-gray-800 text-white text-xs px-4 py-2 rounded-lg">Reply</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContributionsView;