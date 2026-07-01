import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const PerformanceReviewView = ({ userProfile, allUsers = [], attendance = [], tasks = [], contributions = [] }) => {
    // --- TAB STATE ---
    const [activeTab, setActiveTab] = useState('university'); // 'quick' or 'university'
    
    // --- SHARED STATES ---
    const [selectedEmployee, setSelectedEmployee] = useState(userProfile.role === 'supervisor' ? null : userProfile.id);
    const [reviewText, setReviewText] = useState('');
    const [history, setHistory] = useState([]);
    
    // --- QUICK EVAL STATES (Friend's Code) ---
    const [quickScores, setQuickScores] = useState({ quality: 0, discipline: 0, teamwork: 0 });
    
    // --- UNIVERSITY RUBRIC STATES (Your Code) ---
    const [rubricScores, setRubricScores] = useState({});
    
    const employeeUsers = allUsers.filter(u => u.role === 'employee');

    useEffect(() => {
        if (!selectedEmployee) return;
        const fetchReviews = async () => {
            const { data } = await supabase.from('performance_evaluations').select('*').eq('employee_id', selectedEmployee).order('created_at', { ascending: false });
            setHistory(data || []);
        };
        fetchReviews();
    }, [selectedEmployee]);

    // --- LOGIC: QUICK EVALUATION ---
    const handleQuickSubmit = async () => {
        if (quickScores.quality === 0 || quickScores.discipline === 0 || quickScores.teamwork === 0) return alert("Rate all criteria.");
        
        const avg = ((quickScores.quality + quickScores.discipline + quickScores.teamwork) / 3).toFixed(1);
        await supabase.from('performance_evaluations').insert({
            employee_id: selectedEmployee,
            supervisor_id: userProfile.id,
            final_score: avg,
            comments: reviewText,
            type: 'Quick Eval' // Flag for DB
        });
        setQuickScores({ quality: 0, discipline: 0, teamwork: 0 });
        setReviewText('');
        alert("Evaluation saved.");
    };

    // --- LOGIC: UNIVERSITY RUBRIC ---
    const handleRubricSubmit = async () => {
        // Simple mock of your calculation logic
        const pointTotal = Object.values(rubricScores).reduce((sum, val) => sum + val, 0);
        await supabase.from('performance_evaluations').insert({
            employee_id: selectedEmployee,
            supervisor_id: userProfile.id,
            final_score: pointTotal,
            scores: rubricScores,
            comments: reviewText,
            type: 'University Rubric'
        });
        setRubricScores({});
        setReviewText('');
        alert("Rubric saved.");
    };

    return (
        <div className="p-8 h-full flex flex-col">
            <div className="flex justify-between items-end mb-6 pb-4 border-b">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Performance Evaluation</h1>
                    <div className="flex gap-2 mt-3 bg-gray-100 p-1 rounded-lg w-fit">
                        <button onClick={() => setActiveTab('university')} className={`px-4 py-1.5 text-xs font-bold rounded-md ${activeTab === 'university' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>University Rubric</button>
                        <button onClick={() => setActiveTab('quick')} className={`px-4 py-1.5 text-xs font-bold rounded-md ${activeTab === 'quick' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Quick Eval</button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* SELECTOR */}
                {userProfile.role === 'supervisor' && (
                    <div className="bg-white p-4 rounded-lg shadow-sm border h-full">
                        <h3 className="text-xs font-bold text-gray-500 uppercase mb-4">Staff List</h3>
                        {employeeUsers.map(emp => (
                            <button key={emp.id} onClick={() => setSelectedEmployee(emp.id)} className={`w-full text-left px-4 py-3 rounded-md text-sm mb-1 ${selectedEmployee === emp.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-50'}`}>
                                {emp.name}
                            </button>
                        ))}
                    </div>
                )}

                {/* FORM AREA */}
                <div className="lg:col-span-2 space-y-6">
                    {userProfile.role === 'supervisor' && selectedEmployee && (
                        <div className="bg-white rounded-xl shadow-sm border p-6">
                            {activeTab === 'quick' ? (
                                <div>
                                    <h3 className="font-bold mb-4">Quick Evaluation</h3>
                                    {/* Map your friend's 3-star sliders here */}
                                    <button onClick={handleQuickSubmit} className="mt-4 bg-blue-700 text-white py-2 px-4 rounded">Submit Quick Eval</button>
                                </div>
                            ) : (
                                <div>
                                    <h3 className="font-bold mb-4">University Accreditation Matrix</h3>
                                    {/* Map your 26-point rubric questions here */}
                                    <button onClick={handleRubricSubmit} className="mt-4 bg-blue-700 text-white py-2 px-4 rounded">Submit Scorecard</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* HISTORY (Visible to both) */}
                    <div>
                        <h3 className="text-lg font-bold mb-4">Evaluation History</h3>
                        {history.map(review => (
                            <div key={review.id} className="bg-white p-4 rounded-lg border shadow-sm mb-3">
                                <span className="text-xs uppercase bg-gray-100 px-2 py-1 rounded">{review.type}</span>
                                <p className="font-bold text-lg mt-2">Score: {review.final_score}</p>
                                <p className="text-sm italic mt-1">"{review.comments}"</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PerformanceReviewView;