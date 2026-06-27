import React, { useState } from 'react';
import { supabase } from '../supabaseClient'; 

const LeaveView = ({ userProfile, allUsers, leaveRequests, fetchLeaveRequests, fetchProfile }) => {

    const [newRequest, setNewRequest] = useState({ type: 'Paid Holiday', start_date: '', end_date: '', reason: '' });
    const [loading, setLoading] = useState(false);

    // --- HELPER: Colors for Calendar & Status ---
    const statusColor = (status) => ({
        'Pending': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-200',
        'Approved': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200',
        'Denied': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200',
    }[status] || 'bg-gray-100 dark:bg-gray-700');

    const getUserName = (id) => allUsers.find(u => u.id === id)?.name || 'Unknown';

    // --- LOGIC: Submit Request (NOW OPEN FOR EVERYONE) ---
    const handleSubmitRequest = async (e) => {
        e.preventDefault();
        if (!newRequest.start_date || !newRequest.end_date) {
            alert('Please fill out all dates.');
            return;
        }
        
        setLoading(true);

        const { error } = await supabase.from('leave_requests').insert({
            ...newRequest,
            employee_id: userProfile.id,
            status: 'Pending' // Supervisors must approve their own requests (or another admin)
        });

        if (error) {
            alert(`Error: ${error.message}`);
        } else {
            setNewRequest({ type: 'Paid Holiday', start_date: '', end_date: '', reason: '' });
            fetchLeaveRequests(); // Refresh the list immediately
            alert('Leave request submitted! (Check the list below)');
        }
        setLoading(false);
    };

    // --- LOGIC: Approve/Deny & Deduct Days ---
    const handleApproval = async (id, status, request) => {
        if (!confirm(`Are you sure you want to ${status} this request?`)) return;

        // 1. Update Request Status
        const { error: updateError } = await supabase.from('leave_requests')
            .update({ status: status })
            .eq('id', id);

        if (updateError) {
            alert('Error updating request: ' + updateError.message);
            return;
        }

        // 2. If Approved, Deduct Days from Database
        if (status === 'Approved' && (request.type === 'Paid Holiday' || request.type === 'Sick Leave')) {
            const start = new Date(request.start_date);
            const end = new Date(request.end_date);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1; // Inclusive math

            const leaveType = request.type === 'Sick Leave' ? 'sick_days' : 'vacation_days';
            
            // Fetch the LATEST profile data for that user to ensure math is right
            const { data: targetProfile, error: fetchError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', request.employee_id)
                .single();
            
            if (targetProfile && !fetchError) {
                const currentDays = targetProfile[leaveType] || 0;
                const newDays = Math.max(0, currentDays - daysDiff);

                const { error: profileError } = await supabase.from('profiles')
                    .update({ [leaveType]: newDays })
                    .eq('id', request.employee_id);

                if (profileError) console.error('Error deducting days:', profileError);
            }
        }
        
        // 3. REFRESH EVERYTHING
        // This fixes the "Dashboard is mess up" issue by forcing a sync
        await fetchLeaveRequests(); 
        if (request.employee_id === userProfile.id) {
            fetchProfile(); // Update your own balance header if you approved yourself
        }
    };

    // --- VISUAL: Simple Calendar Grid ---
    const renderCalendar = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday
        
        const days = [];
        // Empty slots for days before the 1st
        for (let i = 0; i < firstDayOfMonth; i++) {
            days.push(<div key={`empty-${i}`} className="h-24 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700"></div>);
        }

        // Actual Days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            
            // Find approved leaves for this day
            const dayLeaves = leaveRequests.filter(req => 
                req.status === 'Approved' && 
                req.start_date <= dateStr && 
                req.end_date >= dateStr
            );

            days.push(
                <div key={d} className="h-24 border border-gray-100 bg-white p-1 overflow-y-auto dark:bg-gray-800 dark:border-gray-700 relative">
                    <span className="text-sm font-bold text-gray-500 dark:text-gray-400 absolute top-1 left-2">{d}</span>
                    <div className="mt-5 space-y-1">
                        {dayLeaves.map(leave => (
                            <div key={leave.id} className="text-xs bg-blue-100 text-blue-800 rounded px-1 py-0.5 truncate dark:bg-blue-900 dark:text-blue-200" title={`${getUserName(leave.employee_id)}: ${leave.type}`}>
                                {getUserName(leave.employee_id)}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        return days;
    };

    return (
        <div className="p-8 space-y-8">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Leave Management</h1>

            {/* 1. BALANCE & REQUEST FORM (Visible to Everyone Now) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Balance Card */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-800 p-6 rounded-lg shadow-lg text-white">
                    <h3 className="font-bold text-lg mb-2">Your Leave Balance</h3>
                    <div className="text-3xl font-bold">{userProfile?.vacation_days || 0} <span className="text-base font-normal opacity-80">Vacation Days</span></div>
                    <div className="text-xl mt-1">{userProfile?.sick_days || 0} <span className="text-base font-normal opacity-80">Sick Days</span></div>
                    <p className="text-xs mt-4 opacity-70">Approved leaves are automatically deducted.</p>
                </div>

                {/* Request Form */}
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md dark:bg-gray-800">
                    <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Request Leave</h2>
                    <form onSubmit={handleSubmitRequest} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Leave Type</label>
                            <select
                                value={newRequest.type}
                                onChange={e => setNewRequest({...newRequest, type: e.target.value})}
                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            >
                                <option>Paid Holiday</option>
                                <option>Sick Leave</option>
                                <option>Unpaid Leave</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reason</label>
                            <input
                                type="text"
                                value={newRequest.reason}
                                onChange={e => setNewRequest({...newRequest, reason: e.target.value})}
                                placeholder="e.g. Family Trip"
                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
                            <input
                                type="date"
                                value={newRequest.start_date}
                                onChange={e => setNewRequest({...newRequest, start_date: e.target.value})}
                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:calendar-picker-indicator:invert"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
                            <input
                                type="date"
                                value={newRequest.end_date}
                                onChange={e => setNewRequest({...newRequest, end_date: e.target.value})}
                                className="mt-1 block w-full p-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:calendar-picker-indicator:invert"
                                required
                            />
                        </div>
                        <div className="md:col-span-2 flex justify-end">
                            <button disabled={loading} type="submit" className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                {loading ? 'Submitting...' : 'Submit Request'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* 2. CALENDAR VIEW (New Visual Upgrade) */}
            <div className="bg-white p-6 rounded-lg shadow-md dark:bg-gray-800">
                <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Leave Calendar (Current Month)</h2>
                <div className="grid grid-cols-7 gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                        <div key={d} className="bg-gray-100 p-2 text-center text-sm font-bold text-gray-600 border-b border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">{d}</div>
                    ))}
                    {renderCalendar()}
                </div>
            </div>

            {/* 3. MANAGEMENT TABLE (Supervisor sees all actions, Employee sees status) */}
            <div className="bg-white p-6 rounded-lg shadow-md overflow-x-auto dark:bg-gray-800">
                 <h2 className="text-xl font-bold mb-4 dark:text-gray-100">
                    {userProfile.role === 'supervisor' ? 'Manage All Requests' : 'My Requests'}
                 </h2>
                 <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b dark:bg-gray-700 dark:border-gray-600">
                            <th className="p-3 text-gray-600 dark:text-gray-300">Employee</th>
                            <th className="p-3 text-gray-600 dark:text-gray-300">Type</th>
                            <th className="p-3 text-gray-600 dark:text-gray-300">Dates</th>
                            <th className="p-3 text-gray-600 dark:text-gray-300">Status</th>
                            {userProfile.role === 'supervisor' && <th className="p-3 text-gray-600 dark:text-gray-300">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {(leaveRequests || []).map(req => (
                            <tr key={req.id} className="border-b hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50">
                                <td className="p-3 font-medium dark:text-gray-100">{getUserName(req.employee_id)}</td>
                                <td className="p-3 dark:text-gray-200">{req.type}</td>
                                <td className="p-3 dark:text-gray-200 text-sm">
                                    {req.start_date} <span className="text-gray-400">to</span> {req.end_date}
                                </td>
                                <td className="p-3">
                                    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${statusColor(req.status)}`}>
                                        {req.status}
                                    </span>
                                </td>
                                {userProfile.role === 'supervisor' && (
                                    <td className="p-3">
                                        {req.status === 'Pending' ? (
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleApproval(req.id, 'Approved', req)} className="bg-green-600 text-white text-xs py-1 px-3 rounded hover:bg-green-700 shadow-sm">Approve</button>
                                                <button onClick={() => handleApproval(req.id, 'Denied', req)} className="bg-red-500 text-white text-xs py-1 px-3 rounded hover:bg-red-600 shadow-sm">Deny</button>
                                            </div>
                                        ) : (
                                            <span className="text-gray-400 text-xs italic">No actions</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                 </table>
                 {(leaveRequests || []).length === 0 && (
                    <p className="text-center text-gray-500 py-6 dark:text-gray-400">No leave requests found.</p>
                 )}
            </div>
        </div>
    );
};

export default LeaveView;