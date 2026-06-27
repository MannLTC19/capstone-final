import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { 
    Briefcase, 
    Send, 
    Filter, 
    Calendar, 
    User, 
    AlertCircle, 
    CheckCircle2, 
    Zap, 
    Clock 
} from 'lucide-react'; // Assuming you have lucide-react, if not, remove icons or use text

const ContributionsView = ({ userProfile, contributions, allUsers, fetchContributions }) => {
    const [newContribution, setNewContribution] = useState('');
    const [category, setCategory] = useState('General');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Filters
    const [selectedEmployee, setSelectedEmployee] = useState('all');
    const [selectedDate, setSelectedDate] = useState('');

    const CATEGORIES = [
        { name: 'General', color: 'bg-gray-100 text-gray-700 border-gray-200', active: 'bg-gray-800 text-white border-gray-800' },
        { name: 'Innovation', color: 'bg-purple-50 text-purple-700 border-purple-200', active: 'bg-purple-600 text-white border-purple-600' },
        { name: 'Bug Fix', color: 'bg-red-50 text-red-700 border-red-200', active: 'bg-red-600 text-white border-red-600' },
        { name: 'Client Help', color: 'bg-blue-50 text-blue-700 border-blue-200', active: 'bg-blue-600 text-white border-blue-600' },
        { name: 'Overtime', color: 'bg-amber-50 text-amber-700 border-amber-200', active: 'bg-amber-600 text-white border-amber-600' },
    ];
    
    const usersForFilter = allUsers.sort((a, b) => a.name.localeCompare(b.name));

    const handleSubmit = async () => {
        if (!newContribution.trim()) return;
        setIsSubmitting(true);
        try {
            await supabase.from('contributions').insert({
                employee_id: userProfile.id,
                date: new Date().toISOString().split('T')[0],
                contribution: newContribution,
                category: category
            });
            setNewContribution('');
            fetchContributions();
        } catch (error) {
            console.error("Error logging:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const getUserName = (id) => allUsers.find(u => u.id === id)?.name || 'Unknown';

    const filteredContributions = contributions.filter(item => {
        const matchEmployee = selectedEmployee === 'all' || item.employee_id === selectedEmployee;
        const matchDate = !selectedDate || item.date === selectedDate;
        
        if (userProfile.role !== 'supervisor') {
            return item.employee_id === userProfile.id && matchDate;
        }
        return matchEmployee && matchDate;
    });

    return (
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gray-200 dark:border-gray-700 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <Briefcase className="w-6 h-6 text-blue-600" />
                        Activity Logs
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Track and manage daily operational activities.
                    </p>
                </div>
                
                {/* SUPERVISOR FILTERS */}
                {userProfile.role === 'supervisor' && (
                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg flex flex-wrap items-end gap-3 border border-gray-200 dark:border-gray-700">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wider">Employee</label>
                            <div className="relative">
                                <User className="w-3 h-3 absolute left-2 top-2.5 text-gray-400" />
                                <select 
                                    value={selectedEmployee}
                                    onChange={(e) => setSelectedEmployee(e.target.value)}
                                    className="pl-7 pr-8 py-1.5 w-32 md:w-40 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                >
                                    <option value="all">All Staff</option>
                                    {usersForFilter.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 tracking-wider">Date</label>
                            <div className="relative">
                                <Calendar className="w-3 h-3 absolute left-2 top-2.5 text-gray-400" />
                                <input 
                                    type="date" 
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="pl-7 pr-2 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                            </div>
                        </div>
                        {(selectedEmployee !== 'all' || selectedDate) && (
                            <button 
                                onClick={() => { setSelectedEmployee('all'); setSelectedDate(''); }}
                                className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-2 mb-0.5"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* INPUT CARD */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 md:p-6">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                        LOG NEW ACTIVITY
                    </h3>
                    
                    <div className="flex flex-col gap-4">
                        <textarea 
                            value={newContribution} 
                            onChange={(e) => setNewContribution(e.target.value)}
                            className="w-full p-4 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none dark:bg-gray-700/50 dark:border-gray-600 dark:text-white dark:focus:bg-gray-700"
                            placeholder="What did you work on today?"
                            rows="3"
                        ></textarea>
                        
                        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                            {/* Categories */}
                            <div className="flex flex-wrap gap-2 w-full md:w-auto">
                                {CATEGORIES.map(cat => {
                                    const isSelected = category === cat.name;
                                    return (
                                        <button 
                                            key={cat.name} 
                                            onClick={() => setCategory(cat.name)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
                                                isSelected ? cat.active + ' shadow-sm scale-105' : cat.color + ' hover:opacity-80'
                                            }`}
                                        >
                                            {cat.name}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Submit Button */}
                            <button 
                                onClick={handleSubmit} 
                                disabled={!newContribution.trim() || isSubmitting}
                                className={`w-full md:w-auto px-6 py-2 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-all shadow-sm ${
                                    !newContribution.trim() 
                                    ? 'bg-gray-300 cursor-not-allowed dark:bg-gray-700' 
                                    : 'bg-blue-600 hover:bg-blue-700 hover:shadow-md active:transform active:scale-95'
                                }`}
                            >
                                {isSubmitting ? 'Saving...' : (
                                    <>
                                        Log Activity <Send className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* LOGS TABLE */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Date</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-48">Employee</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Category</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {filteredContributions.length > 0 ? (
                                filteredContributions.map(item => (
                                    <tr key={item.id} className="group hover:bg-blue-50/50 dark:hover:bg-gray-700/30 transition-colors">
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
                                            {item.date}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
                                                    {getUserName(item.employee_id).charAt(0)}
                                                </div>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {getUserName(item.employee_id)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                CATEGORIES.find(c => c.name === item.category)?.color || 'bg-gray-100 text-gray-600 border-gray-200'
                                            }`}>
                                                {item.category}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed group-hover:text-gray-900 dark:group-hover:text-white">
                                            {item.contribution}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="4">
                                        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                            <div className="w-12 h-12 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center mb-3">
                                                <Filter className="w-6 h-6 text-gray-300" />
                                            </div>
                                            <p className="text-sm font-medium">No logs found matching your criteria.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default ContributionsView;