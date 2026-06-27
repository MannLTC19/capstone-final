import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const PerformanceReviewView = ({ userProfile, allUsers, createNotification }) => {
    const [selectedEmployee, setSelectedEmployee] = useState(userProfile.role === 'supervisor' ? null : userProfile.id);
    const [scores, setScores] = useState({ quality: 0, discipline: 0, teamwork: 0 });
    const [reviewText, setReviewText] = useState('');
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    const employeeUsers = allUsers.filter(u => u.role === 'employee');
    const selectedUserData = allUsers.find(u => u.id === selectedEmployee);

    // --- FETCH HISTORY ---
    useEffect(() => {
        if (!selectedEmployee) return;
        
        const fetchReviews = async () => {
            setLoading(true);
            const { data } = await supabase
                .from('performance_reviews')
                .select('*')
                .eq('employee_id', selectedEmployee)
                .order('date', { ascending: false });
            
            setHistory(data || []);
            setLoading(false);
        };

        fetchReviews();
        
        // Reset form when changing user
        setScores({ quality: 0, discipline: 0, teamwork: 0 });
        setReviewText('');
    }, [selectedEmployee]);

    // --- CALCULATE AVERAGE ---
    const calculateAverage = (q, d, t) => {
        if (!q && !d && !t) return '0.0';
        return ((q + d + t) / 3).toFixed(1);
    };

    const currentAverage = calculateAverage(scores.quality, scores.discipline, scores.teamwork);

    // --- SUBMIT REVIEW ---
    const handleSubmit = async () => {
        if (scores.quality === 0 || scores.discipline === 0 || scores.teamwork === 0) {
            alert("Please rate all criteria (1-5) before submitting.");
            return;
        }

        const { error } = await supabase.from('performance_reviews').insert({
            employee_id: selectedEmployee,
            supervisor_id: userProfile.id,
            date: new Date().toISOString().split('T')[0],
            review_text: reviewText,
            rating: Math.round(parseFloat(currentAverage)), // General rating for summary
            score_quality: scores.quality,
            score_discipline: scores.discipline,
            score_teamwork: scores.teamwork
        });

        if (error) {
            alert("Error: " + error.message);
        } else {
            await createNotification(selectedEmployee, `New Performance Evaluation Submitted (Score: ${currentAverage})`);
            alert("Evaluation saved successfully.");
            // Refresh
            setScores({ quality: 0, discipline: 0, teamwork: 0 });
            setReviewText('');
            // Re-fetch history locally
            const { data } = await supabase.from('performance_reviews').select('*').eq('employee_id', selectedEmployee).order('date', { ascending: false });
            setHistory(data || []);
        }
    };

    const getUserName = (id) => allUsers.find(u => u.id === id)?.name || 'Unknown Supervisor';

    // --- COMPONENT: STAR RATER ---
    const StarRater = ({ label, value, onChange, readonly }) => (
        <div className="flex justify-between items-center py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="text-sm font-bold text-gray-600 dark:text-gray-300">{label}</span>
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(star => (
                    <button
                        key={star}
                        onClick={() => !readonly && onChange(star)}
                        disabled={readonly}
                        className={`w-8 h-8 text-lg transition-transform ${!readonly ? 'hover:scale-110' : ''} ${
                            star <= value ? 'text-yellow-400' : 'text-gray-200 dark:text-gray-600'
                        }`}
                    >
                        ★
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <div className="p-8 h-full flex flex-col">
            <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Performance Evaluation</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Formal assessment of employee metrics.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
                
                {/* LEFT: SELECTOR (Supervisor Only) */}
                {userProfile.role === 'supervisor' && (
                    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm h-full overflow-y-auto dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xs font-bold text-gray-500 uppercase mb-4 tracking-wider">Staff List</h3>
                        <div className="space-y-1">
                            {employeeUsers.map(emp => (
                                <button
                                    key={emp.id}
                                    onClick={() => setSelectedEmployee(emp.id)}
                                    className={`w-full text-left px-4 py-3 rounded-md text-sm font-medium transition-all ${
                                        selectedEmployee === emp.id 
                                        ? 'bg-blue-600 text-white shadow-md' 
                                        : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {emp.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* MIDDLE & RIGHT: FORM & HISTORY */}
                <div className={`${userProfile.role === 'supervisor' ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-6 overflow-y-auto`}>
                    
                    {/* 1. EVALUATION FORM (Supervisor Only) */}
                    {userProfile.role === 'supervisor' && selectedUserData && (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden dark:bg-gray-800 dark:border-gray-700">
                            <div className="bg-gray-50 p-6 border-b border-gray-200 dark:bg-gray-700/50 dark:border-gray-700 flex justify-between items-center">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">New Evaluation: {selectedUserData.name}</h2>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Date: {new Date().toLocaleDateString()}</p>
                                </div>
                                <div className="text-center bg-white px-4 py-2 rounded border border-gray-200 shadow-sm dark:bg-gray-800 dark:border-gray-600">
                                    <div className="text-[10px] text-gray-400 uppercase font-bold">Score</div>
                                    <div className="text-2xl font-bold text-blue-600">{currentAverage}</div>
                                </div>
                            </div>

                            <div className="p-6">
                                <div className="mb-6">
                                    <StarRater label="Quality of Work" value={scores.quality} onChange={(v) => setScores({...scores, quality: v})} />
                                    <StarRater label="Discipline & Punctuality" value={scores.discipline} onChange={(v) => setScores({...scores, discipline: v})} />
                                    <StarRater label="Team Collaboration" value={scores.teamwork} onChange={(v) => setScores({...scores, teamwork: v})} />
                                </div>

                                <label className="block text-sm font-bold text-gray-700 mb-2 dark:text-gray-300">Supervisor Comments</label>
                                <textarea 
                                    value={reviewText}
                                    onChange={(e) => setReviewText(e.target.value)}
                                    className="w-full p-3 border border-gray-300 rounded-lg text-sm h-24 focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="Enter formal feedback regarding performance..."
                                ></textarea>

                                <div className="mt-6 flex justify-end">
                                    <button onClick={handleSubmit} className="bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg shadow hover:bg-blue-800 transition-all">
                                        Submit Evaluation
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 2. HISTORY LIST (Visible to Supervisor & Employee) */}
                    {selectedEmployee ? (
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 mb-4 dark:text-gray-100">
                                {userProfile.role === 'supervisor' ? 'Evaluation History' : 'My Performance Reports'}
                            </h3>
                            
                            {history.length === 0 && <p className="text-gray-400 italic">No evaluations found.</p>}

                            <div className="space-y-4">
                                {history.map(review => {
                                    // Calculate average for display if older records lack detailed scores
                                    const avg = calculateAverage(
                                        review.score_quality || review.rating, 
                                        review.score_discipline || review.rating, 
                                        review.score_teamwork || review.rating
                                    );

                                    return (
                                        <div key={review.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex gap-4 dark:bg-gray-800 dark:border-gray-700">
                                            {/* Score Badge */}
                                            <div className="flex flex-col items-center justify-center min-w-[80px] bg-blue-50 rounded-lg border border-blue-100 p-2 dark:bg-blue-900/30 dark:border-blue-800">
                                                <span className="text-2xl font-bold text-blue-700 dark:text-blue-400">{avg}</span>
                                                <span className="text-[10px] uppercase font-bold text-blue-400">Average</span>
                                            </div>

                                            {/* Details */}
                                            <div className="flex-grow">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div>
                                                        <p className="text-xs text-gray-400 uppercase font-bold">{review.date}</p>
                                                        <p className="text-sm font-bold text-gray-800 dark:text-gray-200">Review by {getUserName(review.supervisor_id)}</p>
                                                    </div>
                                                </div>
                                                
                                                {/* Sub-scores (Small tags) */}
                                                <div className="flex gap-2 mb-3">
                                                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">
                                                        Qual: <b>{review.score_quality || '-'}</b>
                                                    </span>
                                                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">
                                                        Disc: <b>{review.score_discipline || '-'}</b>
                                                    </span>
                                                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">
                                                        Team: <b>{review.score_teamwork || '-'}</b>
                                                    </span>
                                                </div>

                                                <p className="text-sm text-gray-600 dark:text-gray-300 italic border-l-2 border-gray-200 pl-3 dark:border-gray-600">
                                                    "{review.review_text}"
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        // Empty State
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 opacity-50 mt-20">
                            <span className="text-4xl">📋</span>
                            <p>Select an employee to begin evaluation.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PerformanceReviewView;