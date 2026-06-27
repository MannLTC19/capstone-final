import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import Modal from '../components/Modal';
import ExportButton from '../components/ExportButton';

// --- HELPER: USER AVATAR ---
const UserAvatar = ({ user, size = "w-6 h-6", textSize = "text-[9px]" }) => {
    if (!user) return null;

    if (user.avatar_url) {
        return (
            <img
                src={user.avatar_url}
                alt={user.name}
                title={user.name}
                className={`${size} rounded-full border border-white object-cover shadow-sm dark:border-gray-800`}
            />
        );
    }

    return (
         <div title={user.name} className={`${size} rounded-full bg-gray-200 border border-white flex items-center justify-center ${textSize} font-bold text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-700 dark:text-gray-300`}>
            {user.name?.charAt(0) || '?'}
        </div>
    );
};

// --- MAIN COMPONENT ---
const TasksView = ({ userProfile, tasks = [], allUsers = [], fetchTasks, createNotification }) => {
    
    // --- SAFETY CHECK ---
    if (!userProfile) {
        return <div className="p-8 text-gray-500">Loading...</div>;
    }

    const [viewMode, setViewMode] = useState('board');
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    const [newTask, setNewTask] = useState({ 
        title: '', 
        description: '', 
        assigned_to: [], 
        due_date: '',
        priority: 'Normal' 
    });
    
    const [selectedFiles, setSelectedFiles] = useState({}); 
    const [uploading, setUploading] = useState(null); 

    const employeeUsers = (allUsers || []).filter(u => u.role === 'employee');

    // --- CONFIGURATION ---
    const COLUMNS = [
        { id: 'col_todo', label: 'To Do', color: 'bg-purple-600' },
        { id: 'col_doing', label: 'In Progress', color: 'bg-orange-500' },
        { id: 'col_review', label: 'Ready for Review', color: 'bg-pink-500' }, 
        { id: 'col_done', label: 'Done', color: 'bg-green-500' }
    ];

    const getColumnId = (status) => {
        switch (status) {
            case 'To Do': return 'col_todo';
            case 'In Progress': return 'col_doing';
            case 'Revision Needed': return 'col_doing'; 
            case 'Completed': return 'col_review';      
            case 'Approved': return 'col_done';
            default: return 'col_todo';
        }
    };

    const getPriorityStyle = (p) => ({
        'High': 'bg-red-100 text-red-700 border-red-200',
        'Normal': 'bg-blue-100 text-blue-700 border-blue-200',
        'Low': 'bg-gray-100 text-gray-700 border-gray-200'
    }[p] || 'bg-gray-100 text-gray-700');

    // --- EXPORT DATA PREP ---
    const getAssigneeNames = (ids) => {
        if (!ids || !Array.isArray(ids)) return 'Unassigned';
        return ids.map(id => {
            const user = allUsers.find(u => String(u.id) === String(id));
            return user ? user.name : 'Unknown';
        }).join(', ');
    };

    const exportData = (tasks || []).map(t => ({
        Task: t.title,
        Description: t.description,
        Priority: t.priority,
        Status: t.status,
        "Due Date": t.due_date,
        "Assigned To": getAssigneeNames(t.assigned_to),
        Feedback: t.feedback || 'None'
    }));

    // --- TIMELINE HELPERS ---
    const getNext7Days = () => {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            days.push(d.toISOString().split('T')[0]);
        }
        return days;
    };
    const timelineDates = getNext7Days();

    // --- HANDLERS ---
    const handleCreateTask = async () => {
        if (!newTask.title || newTask.assigned_to.length === 0 || !newTask.due_date) {
            alert('Please fill out all required fields.');
            return;
        }
        const { error } = await supabase.from('tasks').insert({
            title: newTask.title,
            description: newTask.description,
            assigned_to: newTask.assigned_to, 
            due_date: newTask.due_date,
            priority: newTask.priority,
            status: 'To Do', 
        });
        if (error) alert('Error: ' + error.message);
        else {
            newTask.assigned_to.forEach(async (userId) => await createNotification(userId, `New Task: ${newTask.title}`));
            alert('Task assigned successfully.');
            setNewTask({ title: '', description: '', assigned_to: [], due_date: '', priority: 'Normal' });
            setIsModalOpen(false);
            fetchTasks(); 
        }
    };

    const toggleAssignee = (userId) => {
        setNewTask(prev => {
            const current = prev.assigned_to;
            return current.includes(userId) 
                ? { ...prev, assigned_to: current.filter(id => id !== userId) }
                : { ...prev, assigned_to: [...current, userId] };
        });
    };

    // --- UPDATED: HANDLE FILE CHANGE WITH ALERT ---
    const handleFileChange = (e, taskId) => { 
        // 1. Find the task to check ownership
        const currentTask = tasks.find(t => t.id === taskId);
        
        // 2. Check if current user is assigned to this task
        const isAssigned = currentTask?.assigned_to?.includes(userProfile.id);

        if (!isAssigned) {
            // 3. Alert and block if not assigned
            alert("⚠️ Access Denied: You cannot upload files for a task assigned to another employee.");
            e.target.value = null; // Reset the file input
            return;
        }

        // 4. Proceed if assigned
        if (e.target.files?.[0]) {
            setSelectedFiles(prev => ({ ...prev, [taskId]: e.target.files[0] })); 
        }
    };

    // --- UPDATED: HANDLE FILE UPLOAD WITH ALERT ---
    const handleFileUpload = async (taskId) => {
        // 1. Double check permission (Security)
        const currentTask = tasks.find(t => t.id === taskId);
        if (!currentTask?.assigned_to?.includes(userProfile.id)) {
            alert("⚠️ Access Denied: This task is not assigned to you.");
            return;
        }

        const file = selectedFiles[taskId];
        if (!file) return;

        setUploading(taskId);
        const filePath = `${userProfile.id}/${taskId}/${Date.now()}.${file.name.split('.').pop()}`;
        
        const { error: uploadError } = await supabase.storage.from('task_submission').upload(filePath, file);
        if (uploadError) { 
            alert('Upload Error: ' + uploadError.message); 
            setUploading(null); 
            return; 
        }
        
        const { error: dbError } = await supabase.from('tasks').update({ submitted_file_path: filePath, status: 'Completed', feedback: null }).eq('id', taskId);
        
        if (dbError) alert('Database Error: ' + dbError.message);
        else fetchTasks();
        
        setUploading(null);
    };

    const handleStatusChange = async (taskId, newStatus) => {
        await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId);
        fetchTasks();
    };

    const handleViewSubmission = async (path) => {
        const { data } = await supabase.storage.from('task_submission').createSignedUrl(path, 60);
        if (data) window.open(data.signedUrl, '_blank');
    };

    // --- SUB-COMPONENTS ---
    const TaskCard = ({ task }) => (
        <div className={`bg-white p-4 rounded-lg border shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3 dark:bg-gray-800 dark:border-gray-700 ${task.status === 'Revision Needed' ? 'border-l-4 border-l-red-500' : 'border-gray-200'}`}>
            <div className="flex justify-between items-start">
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded border ${getPriorityStyle(task.priority)}`}>{task.priority}</span>
                {task.status === 'Revision Needed' && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded border border-red-200">Needs Fix</span>}
            </div>
            <div>
                <h4 className="font-bold text-gray-800 text-sm mb-1 dark:text-gray-100">{task.title}</h4>
                <div className="text-xs text-gray-500 flex items-center gap-1 dark:text-gray-400"><span>📅 Due: {task.due_date}</span></div>
                {task.feedback && task.status === 'Revision Needed' && <div className="mt-2 text-xs bg-red-50 text-red-600 p-2 rounded border border-red-100 italic">"Supervisor: {task.feedback}"</div>}
            </div>
            <div className="mt-auto pt-3 border-t border-gray-100 flex justify-between items-center dark:border-gray-700">
                {/* AVATARS */}
                <div className="flex -space-x-2">
                    {(task.assigned_to || []).map(uid => {
                        const u = allUsers.find(user => String(user.id) === String(uid));
                        return <UserAvatar key={uid} user={u} size="w-6 h-6" textSize="text-[9px]" />;
                    })}
                </div>
                {/* ACTIONS */}
                <div className="flex gap-2 text-xs font-medium">
                    {userProfile.role !== 'supervisor' && (
                        <>
                            {task.status === 'To Do' && <button onClick={() => handleStatusChange(task.id, 'In Progress')} className="text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded">Start</button>}
                            {(task.status === 'In Progress' || task.status === 'Revision Needed') && (
                                <label className="cursor-pointer text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded">
                                    {uploading === task.id ? '...' : (task.status === 'Revision Needed' ? 'Re-Upload' : 'Upload')}
                                    {/* Input still exists, but logic now blocks other users */}
                                    <input type="file" className="hidden" onChange={(e) => handleFileChange(e, task.id)} />
                                    {selectedFiles[task.id] && <button onClick={() => handleFileUpload(task.id)} className="ml-1 underline font-bold">Send</button>}
                                </label>
                            )}
                            {task.status === 'Completed' && <span className="text-gray-400 italic">Waiting...</span>}
                        </>
                    )}
                    {task.submitted_file_path && <button onClick={() => handleViewSubmission(task.submitted_file_path)} className="text-gray-600 hover:text-gray-900 dark:text-gray-300">View File</button>}
                    {userProfile.role === 'supervisor' && task.status === 'Completed' && (
                        <>
                            <button onClick={() => handleStatusChange(task.id, 'Approved')} className="text-green-600 hover:text-green-800 font-bold bg-green-50 px-2 py-1 rounded">Approve</button>
                            <button onClick={() => { const fb = prompt("Reason for revision:"); if(fb) supabase.from('tasks').update({ status: 'Revision Needed', feedback: fb }).eq('id', task.id).then(fetchTasks); }} className="text-red-600 hover:text-red-800 bg-red-50 px-2 py-1 rounded">Reject</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );

    const ProgressCard = ({ employee }) => {
        const empTasks = (tasks || []).filter(t => (t.assigned_to || []).includes(employee.id));
        const total = empTasks.length;
        const done = empTasks.filter(t => t.status === 'Approved' || t.status === 'Completed').length;
        const percentage = total === 0 ? 0 : Math.round((done / total) * 100);

        return (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 dark:bg-gray-800 dark:border-gray-700 flex flex-col gap-3 min-w-[250px]">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                         <UserAvatar user={employee} size="w-8 h-8" textSize="text-sm" />
                        <h4 className="font-bold text-gray-800 dark:text-gray-100">{employee.name}</h4>
                    </div>
                    <span className="text-xs text-gray-400">{done}/{total} Tasks</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 dark:bg-gray-700">
                    <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${percentage}%` }}></div>
                </div>
                <div className="flex justify-between text-xs font-bold mt-1">
                    <span className="text-blue-600">{percentage}% Complete</span>
                    <div className="flex -space-x-2">
                        {empTasks.slice(0, 3).map(t => (
                            <div key={t.id} className="w-5 h-5 rounded-full bg-gray-200 border border-white text-[8px] flex items-center justify-center dark:border-gray-800" title={t.title}>
                                {t.title.charAt(0)}
                            </div>
                        ))}
                        {empTasks.length > 3 && <div className="w-5 h-5 rounded-full bg-gray-100 border border-white text-[8px] flex items-center justify-center text-gray-500 dark:border-gray-800">+{empTasks.length-3}</div>}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-end mb-6 pb-4 border-b border-gray-200 dark:border-gray-700 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Task Management</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Track project progress and deliverables.</p>
                </div>
                
                <div className="flex gap-2 items-center">
                    {userProfile.role === 'supervisor' && (
                        <ExportButton data={exportData} filename="Task_Report" label="Export Tasks" />
                    )}

                    <div className="flex gap-2 bg-gray-100 p-1 rounded-lg dark:bg-gray-700">
                        <button onClick={() => setViewMode('board')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${viewMode === 'board' ? 'bg-white shadow text-blue-600 dark:bg-gray-600 dark:text-white' : 'text-gray-500'}`}>Board</button>
                        <button onClick={() => setViewMode('timeline')} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${viewMode === 'timeline' ? 'bg-white shadow text-blue-600 dark:bg-gray-600 dark:text-white' : 'text-gray-500'}`}>Timeline</button>
                    </div>

                    {userProfile.role === 'supervisor' && (
                        <button onClick={() => setIsModalOpen(true)} className="bg-blue-700 text-white text-sm font-bold py-2 px-4 rounded shadow-sm hover:bg-blue-800 transition">
                            + Create Task
                        </button>
                    )}
                </div>
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="New Task Assignment">
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-700 uppercase dark:text-gray-200">Title</label>
                        <input type="text" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"/>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-gray-700 uppercase dark:text-gray-200">Priority</label>
                            <select value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option>Low</option>
                                <option>Normal</option>
                                <option>High</option>
                            </select>
                        </div>
                        <div>
                             <label className="text-xs font-bold text-gray-700 uppercase dark:text-gray-200">Due Date</label>
                             <input type="date" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:calendar-picker-indicator:invert"/>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-700 uppercase dark:text-gray-200">Assignees</label>
                        <div className="mt-1 border border-gray-300 rounded max-h-32 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700 dark:border-gray-600">
                            {employeeUsers.map(emp => (
                                <label key={emp.id} className="flex items-center space-x-2 p-1 hover:bg-gray-200 rounded cursor-pointer dark:hover:bg-gray-600">
                                    <input type="checkbox" checked={newTask.assigned_to.includes(emp.id)} onChange={() => toggleAssignee(emp.id)} />
                                    <span className="text-sm dark:text-gray-200">{emp.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <button onClick={handleCreateTask} className="w-full bg-blue-700 text-white font-bold py-2 rounded text-sm hover:bg-blue-800">Confirm Assignment</button>
                </div>
            </Modal>

            {viewMode === 'board' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-12">
                    {COLUMNS.map(col => {
                        const columnTasks = (tasks || []).filter(t => getColumnId(t.status) === col.id);
                        return (
                            <div key={col.id} className="flex flex-col min-h-[500px] bg-gray-50 rounded-lg border border-gray-200 dark:bg-gray-800/50 dark:border-gray-700">
                                <div className={`${col.color} p-3 rounded-t-lg text-white`}>
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-bold text-sm tracking-wide">{col.label}</h3>
                                        <span className="bg-white/20 px-2 py-0.5 rounded text-xs font-bold">{columnTasks.length}</span>
                                    </div>
                                </div>
                                <div className="p-3 space-y-3 flex-1">
                                    {columnTasks.map(task => <TaskCard key={task.id} task={task} />)}
                                    {columnTasks.length === 0 && <div className="text-center text-gray-400 text-xs py-4 italic">No tasks</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {viewMode === 'timeline' && (
                <div className="space-y-8 animate-fade-in-down">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
                        <div className="min-w-[800px]">
                            <div className="grid grid-cols-8 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                                <div className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Employee</div>
                                {timelineDates.map(date => { const d = new Date(date); const isWeekend = d.getDay() === 0 || d.getDay() === 6; return (<div key={date} className={`p-3 text-center border-l border-gray-100 dark:border-gray-700 ${isWeekend ? 'bg-gray-100/50 dark:bg-gray-800' : ''}`}><div className="text-xs text-gray-400 font-bold uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div><div className="text-sm font-bold text-gray-800 dark:text-gray-200">{d.getDate()}</div></div>); })}
                            </div>
                            {employeeUsers.map(emp => (
                                <div key={emp.id} className="grid grid-cols-8 border-b border-gray-50 hover:bg-gray-50 transition-colors dark:border-gray-700 dark:hover:bg-gray-700/30">
                                    <div className="p-4 flex items-center gap-2">
                                        <UserAvatar user={emp} size="w-6 h-6" textSize="text-xs" />
                                        <span className="text-sm font-bold text-gray-700 truncate dark:text-gray-200">{emp.name.split(' ')[0]}</span>
                                    </div>
                                    {timelineDates.map(date => {
                                        const dailyTasks = (tasks || []).filter(t => (t.assigned_to || []).includes(emp.id) && t.due_date === date);
                                        return (<div key={date} className="border-l border-gray-50 p-1 relative dark:border-gray-700">{dailyTasks.map(t => (<div key={t.id} className={`text-[10px] p-1.5 rounded mb-1 truncate shadow-sm font-medium ${t.status === 'Approved' ? 'bg-green-100 text-green-700' : t.priority === 'High' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`} title={t.title}>{t.title}</div>))}</div>);
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 mb-4 dark:text-gray-100">Team Workload & Progress</h3>
                        <div className="flex gap-6 overflow-x-auto pb-4">
                            {employeeUsers.map(emp => <ProgressCard key={emp.id} employee={emp} />)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TasksView;