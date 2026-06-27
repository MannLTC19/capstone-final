import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Toaster, toast } from 'react-hot-toast';
import * as faceapi from 'face-api.js';

// --- COMPONENTS ---
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatBot from './components/ChatBot';

// --- VIEWS ---
import LoginPage from './views/LoginPage';
import DashboardView from './views/DashboardView';
import AttendanceView from './views/AttendanceView';
import TasksView from './views/TasksView';
import ContributionsView from './views/ContributionsView';
import LeaveView from './views/LeaveView';
import PerformanceReviewView from './views/PerformanceReviewView';
import SettingsView from './views/SettingsView';

const MainContent = ({ view, userProfile, ...props }) => {
  switch (view) {
    case 'dashboard':
      return <DashboardView {...props} userProfile={userProfile} />;
    case 'attendance':
      return <AttendanceView {...props} userProfile={userProfile} />;
    case 'tasks':
      return <TasksView {...props} userProfile={userProfile} createNotification={props.createNotification} />;
    case 'contributions':
      return <ContributionsView {...props} userProfile={userProfile} />;
    case 'leave':
      return <LeaveView {...props} userProfile={userProfile} createNotification={props.createNotification} fetchProfile={props.fetchProfile} />;
    case 'reviews':
      return <PerformanceReviewView {...props} userProfile={userProfile} />;
    case 'settings':
      return <SettingsView userProfile={userProfile} fetchProfile={props.fetchProfile} />;
    default:
      return <DashboardView {...props} userProfile={userProfile} />;
  }
};

export default function App() {
  const WORK_START_TIME = '08:00';
  const ATTENDANCE_TABLE = 'attendance';

  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeView, setActiveView] = useState('dashboard');
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) return storedTheme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [allUsers, setAllUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        console.info('🤖 [Face-API] All biometric weights loaded successfully!');
      } catch (err) {
        console.error('Gagal memuat model face-api:', err);
      }
    };
    loadModels();
  }, []);

  const fetchProfile = async (userId) => {
    if (!userId) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (!error && data) {
      setUserProfile(data);
    } else {
      console.error('Error fetching profile:', error);
    }
  };

  const handleClockIn = async (userId) => {
    if (!userId) return false;
    const today = new Date().toISOString().split('T')[0];

    const { data: existingRecord, error: checkError } = await supabase
      .from('attendance')
      .select('id')
      .eq('employee_id', userId)
      .eq('date', today)
      .maybeSingle();

    if (checkError) {
      console.error('Attendance check error:', checkError);
      return false;
    }

    if (existingRecord) {
      console.info(`User ${userId} sudah absen hari ini`);
      return true;
    }

    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false });
    const status = time > WORK_START_TIME ? 'Late' : 'Present';

    const { error } = await supabase.from(ATTENDANCE_TABLE).insert([{
      employee_id: userId,
      date: today,
      status,
      clock_in: time
    }]);

    if (error) {
      console.error('Clock-in error:', error);
      return false;
    }

    return true;
  };

  useEffect(() => {
    const handleBiometricLogin = async (e) => {
      try {
        const { user_id, email } = e.detail;
        setSession({ user: { id: user_id, email } });
        await fetchProfile(user_id);
        await handleClockIn(user_id);
        localStorage.removeItem('biometric_auth');
        toast.success('Login Biometrik Sukses, Wir! 🦅');
      } catch (err) {
        console.error('Gagal eksekusi auth biometrik:', err);
        toast.error('Gagal sinkronisasi sesi wajah.');
      }
    };

    window.addEventListener('biometric_login_success', handleBiometricLogin);
    return () => window.removeEventListener('biometric_login_success', handleBiometricLogin);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setUserProfile(null);
        setTasks([]);
        setAttendance([]);
        setLeaveRequests([]);
        setContributions([]);
        setNotifications([]);
        setAllUsers([]);
        setReviews([]);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
    });
  }, []);

  const fetchAllUsers = async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (!error) setAllUsers(data || []);
  };

  const fetchTasks = async (profile) => {
    let { data, error } = await supabase.from('tasks').select('*').order('due_date', { ascending: true });
    if (error) console.log('error', error);
    else setTasks(data || []);
  };

  const fetchAttendance = async (profile) => {
    if (!profile) return;
    let query = supabase.from('attendance').select('*');
    if (profile.role !== 'supervisor') query = query.eq('employee_id', profile.id);
    const { data, error } = await query.order('date', { ascending: false });
    if (!error) setAttendance(data || []);
  };

  const fetchLeaveRequests = async (profile) => {
    if (!profile) return;
    let query = supabase.from('leave_requests').select('*');
    if (profile.role !== 'supervisor') query = query.eq('employee_id', profile.id);
    const { data, error } = await query.order('start_date', { ascending: false });
    if (!error) setLeaveRequests(data || []);
  };

  const fetchContributions = async (profile) => {
    if (!profile) return;
    let query = supabase.from('contributions').select('*');
    if (profile.role !== 'supervisor') query = query.eq('employee_id', profile.id);
    const { data, error } = await query.order('date', { ascending: false });
    if (!error) setContributions(data || []);
  };

  const fetchReviews = async (profile) => {
    if (!profile) return;
    let query = supabase.from('performance_reviews').select('*');
    if (profile.role !== 'supervisor') query = query.eq('employee_id', profile.id);
    const { data, error } = await query.order('date', { ascending: false });
    if (!error) setReviews(data || []);
    else console.error('Error fetching reviews:', error);
  };

  const fetchNotifications = async (profile) => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    if (!error) setNotifications(data || []);
  };

  const createNotification = async (userId, message) => {
    try {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('message', message)
        .maybeSingle();

      if (existing) return;

      const { error } = await supabase.from('notifications').insert({
        user_id: userId,
        message,
        read: false,
        created_at: new Date().toISOString(),
      });

      if (error) console.error('Error creating notification:', error);
    } catch (err) {
      console.error('Unexpected error creating notification:', err);
    }
  };

  const hasWelcomed = useRef(false);
  useEffect(() => {
    if (!userProfile || hasWelcomed.current) return;
    const lastWelcome = localStorage.getItem('lastWelcomeDate');
    const today = new Date().toISOString().split('T')[0];
    if (lastWelcome === today) return;
    toast.success(`Welcome back, ${userProfile.name || 'User'}! 👋`);
    hasWelcomed.current = true;
    localStorage.setItem('lastWelcomeDate', today);
  }, [userProfile]);

  useEffect(() => {
    if (userProfile) {
      fetchTasks(userProfile);
      fetchAttendance(userProfile);
      fetchLeaveRequests(userProfile);
      fetchContributions(userProfile);
      fetchNotifications(userProfile);
      fetchReviews(userProfile);
      fetchAllUsers();
    }
  }, [userProfile]);

  useEffect(() => {
    if (!userProfile) return;

    const handleChanges = (payload) => {
      switch (payload.table) {
        case 'tasks': fetchTasks(userProfile); break;
        case 'notifications': if (payload.new?.user_id === userProfile.id) fetchNotifications(userProfile); break;
        case 'performance_reviews': fetchReviews(userProfile); break;
        default: break;
      }
    };

    const channel = supabase
      .channel(`realtime_${userProfile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, handleChanges)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [userProfile]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleNotificationsRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;
    setNotifications(current => current.map(n => (unreadIds.includes(n.id) ? { ...n, read: true } : n)));
    const { error } = await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
    if (error) console.error('Error marking notifications as read:', error);
  };

  if (session === null || (session && userProfile === null)) {
    if (session && !userProfile) {
      return (
        <div className="flex justify-center items-center h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <div className="h-12 w-12 bg-gray-200 rounded-full dark:bg-gray-700"></div>
            <div className="h-4 w-32 bg-gray-200 rounded dark:bg-gray-700"></div>
          </div>
        </div>
      );
    }
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen font-sans bg-gray-50 dark:bg-slate-900 transition-colors duration-200">
      <Toaster position="top-right" toastOptions={{ className: 'dark:bg-gray-700 dark:text-white' }} />

      <Sidebar
        userProfile={userProfile}
        activeView={activeView}
        setActiveView={setActiveView}
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
      />

      <div className="flex-1 flex flex-col md:ml-64 transition-all duration-300 relative w-full">
        <Header
          userProfile={userProfile}
          onLogout={handleLogout}
          notifications={notifications}
          onNotificationsRead={handleNotificationsRead}
          isDarkMode={isDarkMode}
          toggleDarkMode={toggleDarkMode}
          toggleMobileSidebar={() => setIsMobileOpen(!isMobileOpen)}
        />

        <main className="flex-1 overflow-y-auto p-0 relative">
          {userProfile && (
            <>
              <MainContent
                view={activeView}
                userProfile={userProfile}
                allUsers={allUsers}
                tasks={tasks}
                fetchTasks={() => fetchTasks(userProfile)}
                attendance={attendance}
                fetchAttendance={() => fetchAttendance(userProfile)}
                leaveRequests={leaveRequests}
                fetchLeaveRequests={() => fetchLeaveRequests(userProfile)}
                contributions={contributions}
                fetchContributions={() => fetchContributions(userProfile)}
                fetchProfile={() => fetchProfile(userProfile.id)}
                createNotification={createNotification}
                reviews={reviews}
              />
              <ChatBot userProfile={userProfile} tasks={tasks} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}