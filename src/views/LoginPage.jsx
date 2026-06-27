import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import { supabase } from '../supabaseClient';
import LoginLogo from '../assets/customs-logo.jpg';

function calculateEAR(eyeLandmarks) {
  if (!eyeLandmarks || eyeLandmarks.length < 6) return 1;

  const p2 = eyeLandmarks[1];
  const p3 = eyeLandmarks[2];
  const p6 = eyeLandmarks[5];
  const p5 = eyeLandmarks[4];
  const p1 = eyeLandmarks[0];
  const p4 = eyeLandmarks[3];

  const point = (p) => ({ x: p.x ?? p._x, y: p.y ?? p._y });
  const a = point(p1);
  const b = point(p2);
  const c = point(p3);
  const d = point(p4);
  const e = point(p5);
  const f = point(p6);

  const distVert1 = Math.hypot(b.x - f.x, b.y - f.y);
  const distVert2 = Math.hypot(c.x - e.x, c.y - e.y);
  const distHoriz = Math.hypot(a.x - d.x, a.y - d.y);

  if (distHoriz === 0) return 1;
  return (distVert1 + distVert2) / (2.0 * distHoriz);
}

export default function LoginPage() {
  const navigate = useNavigate(); // 🔥 SENJATA PENGALIHAN UTAMA KITA
  const [authMode, setAuthMode] = useState('login');
  const [registerStep, setRegisterStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState('Position face for scan');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isEyeClosedRef = useRef(false);
  const isRedirectingRef = useRef(false); // 🔥 Kill switch: stop detection loop after redirect
  const rafIdRef = useRef(null);

  const [allProfiles, setAllProfiles] = useState([]);
  const profilesRef = useRef([]);
  const [blinkCount, setBlinkCount] = useState(0);

  useEffect(() => {
async function fetchProfiles() {
        // 🎯 FIX: Buang 'email' karena tidak ada di tabel profiles, pastikan kolom yang lain namanya pas!
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, role, initials, face_descriptor')
          .not('face_descriptor', 'is', null);

      if (error) {
        console.error('Error fetching profiles:', error);
        return;
      }

      const formatted = data.map(p => ({
        ...p,
        descriptor: new Float32Array(p.face_descriptor)
      }));

      setAllProfiles(formatted);
      profilesRef.current = formatted;
      console.log(`🤖 Database profiles termuat sempurna di memori inti: ${formatted.length} data.`);
    }

    fetchProfiles();
  }, []);

  useEffect(() => {
    let stream = null;

    async function startVideo() {
      if (videoRef.current && videoRef.current.srcObject) return;

      setTimeout(async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' }
          });

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => {
              if (e.name !== 'AbortError') console.error('Video play error:', e);
            });
          }
        } catch (err) {
          console.error('Gagal total akses webcam, wir:', err);
        }
      }, 100);
    }

    const shouldStart = authMode === 'login' || (authMode === 'register' && registerStep === 2);

    if (shouldStart) {
      startVideo();
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [authMode, registerStep]);

  useEffect(() => {
    let rafId = null;

    const detectLoop = async () => {
       // 🛑 BENTENG UTAMA: Kalau lagi proses redirect, matikan mesin scan detik ini juga!
      if (isRedirectingRef.current) {
        return;
      }

      if (!videoRef.current) {
        rafId = requestAnimationFrame(detectLoop);
        return;
      }

      if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
        rafId = requestAnimationFrame(detectLoop);
        return;
      }

      if (
        !faceapi.nets.tinyFaceDetector.params ||
        !faceapi.nets.faceLandmark68Net.params ||
        !faceapi.nets.faceRecognitionNet.params
      ) {
        console.log('⏳ Waiting for face-api weights to load...');
        rafId = requestAnimationFrame(detectLoop);
        return;
      }

      try {
        const detection = await faceapi
          .detectSingleFace(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })
          )
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          console.log('🟩 [C-SPACE ENGINE] Muka terkunci! Score:', detection.detection?.score);

          const leftEAR = calculateEAR(detection.landmarks.getLeftEye());
          const rightEAR = calculateEAR(detection.landmarks.getRightEye());
          const avgEAR = (leftEAR + rightEAR) / 2;

          if (avgEAR < 0.26) {
            isEyeClosedRef.current = true;
            console.log('👁️ Status: Kelopak Mata Merem...', avgEAR.toFixed(4));
          } else if (isEyeClosedRef.current) {
            isEyeClosedRef.current = false;
            setBlinkCount(p => p + 1);
            setBiometricStatus('Liveness verified. Matching...');
            console.log('⚡ KEDIPAN VALID MASUK! Menembak 1-to-N matching...');
            await executeBiometricLogin(detection.descriptor);
          } else {
            setBiometricStatus('Blink to authenticate');
          }
        } else {
          setBiometricStatus('No face detected');
        }
      } catch (err) {
        console.log('Detection tracking frame error skipped...', err);
      }

      rafId = requestAnimationFrame(detectLoop);
    };

    if (allProfiles.length > 0) {
      console.log('🚀 Memicu paksa mesin deteksi wajah C-SPACE...');
      rafId = requestAnimationFrame(detectLoop);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [allProfiles]);

  const executeBiometricLogin = async (liveDescriptor) => {
    let bestMatch = null;
    let lowestDistance = 0.55; // Threshold andalan lu

    if (profilesRef.current.length === 0) {
      console.log('❌ Loop ditolak: Memori inti profiles masih kosong!');
      return;
    }

    for (const profile of profilesRef.current) {
      const dist = faceapi.euclideanDistance(liveDescriptor, profile.descriptor);
      if (dist < lowestDistance) {
        lowestDistance = dist;
        bestMatch = profile;
      }
    }

    if (bestMatch) {
      console.log(`🎯 MUKA COCOK: ${bestMatch.name}`);
      
      try {
        // 1. KUNCI LUAR: Simpan ID user ke localStorage dulu biar session-nya kebaca
        localStorage.setItem('c_space_user_id', bestMatch.id);
        
        // 2. PROSES ABSENSI: Kita bungkus pakai try-catch terpisah biar kalaupun Supabase 401, login lu TETEP TEMBUS!
        const hariIni = new Date().toISOString().split('T')[0];
        const jamIni = new Date().toLocaleTimeString('en-US', { hour12: false });

        const { error: attError } = await supabase
          .from('attendance')
          .insert([{ 
            employee_id: bestMatch.id, 
            date: hariIni, 
            status: 'Present', 
            clock_in: jamIni 
          }]);

        if (attError) {
          console.warn("⚠️ Gagal mencatat absensi otomatis (RLS Block), tapi login diteruskan:", attError.message);
        } else {
          console.log("✅ Auto Clock-In Berhasil Dicatat!");
        }

      } catch (e) {
        console.error("Gagal interaksi database:", e);
      }

      // 3. LEMPAR LANGSUNG KE DASHBOARD! Jangan biarkan eror Supabase menahan lu!
      console.log('🚀 Pengalihan paksa ke Dashboard...');
      // Dispatch event for global auth sync
      window.dispatchEvent(new CustomEvent('biometric_login_success', { detail: { user_id: bestMatch.id } }));
      setTimeout(() => {
        navigate('/dashboard');
      }, 300);


    } else {
      setBiometricStatus('Unknown face');
      setError('Wajah tidak dikenali.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (authMode === 'register') {
        if (registerStep === 1) {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name, initials: initials.toUpperCase() } }
          });

          if (signUpError) throw signUpError;

          const newUser = signUpData?.user;
          if (!newUser) throw new Error('Gagal dapat UUID');

          setRegisterStep(2);

          setTimeout(async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              const detection = await faceapi
                .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }))
                .withFaceLandmarks()
                .withFaceDescriptor();

              if (detection) {
                const descriptorArray = Array.from(detection.descriptor);

                await supabase
                  .from('profiles')
                  .update({
                    name,
                    role: 'employee',
                    initials: initials.toUpperCase(),
                    face_descriptor: descriptorArray
                  })
                  .eq('id', newUser.id);

                setBiometricStatus('Registrasi berhasil! Silakan berkedip untuk verifikasi.');
              }
            }
          }, 500);
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex font-sans">
      <div className="w-1/2 bg-slate-900 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src={LoginLogo} alt="Logo" className="h-16 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-1">Bea Cukai</h2>
            <p className="text-blue-200 text-xs uppercase tracking-wider">Employee Monitoring System</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {authMode === 'register' && registerStep === 1 && (
              <>
                <input
                  type="text"
                  placeholder="Nama Lengkap"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm"
                  required
                />
                <input
                  type="text"
                  placeholder="Inisial"
                  value={initials}
                  onChange={e => setInitials(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm uppercase"
                  required
                  maxLength="2"
                />
              </>
            )}

            <input
              type="email"
              placeholder="Email Resmi"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
              required
            />

            {error && <div className="text-red-300 text-xs bg-red-500/20 p-2 rounded">{error}</div>}
            {message && <div className="text-emerald-300 text-xs bg-emerald-500/20 p-2 rounded">{message}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-bold rounded-lg hover:from-yellow-400 hover:to-yellow-500 disabled:opacity-50"
            >
              {loading ? 'Memproses...' : authMode === 'register' ? 'Daftar' : 'Masuk'}
            </button>
          </form>

          <div className="text-center mt-4">
            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-blue-200 text-sm hover:text-white underline"
            >
              {authMode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
            </button>
          </div>
        </div>
      </div>

      <div className="w-1/2 bg-gradient-to-br from-blue-900 via-slate-950 to-indigo-950 flex flex-col items-center p-8">
        <div className="absolute top-4 right-4">
          <img src={LoginLogo} alt="Logo" className="h-10 w-auto opacity-60" />
        </div>

        <div className="relative w-72 h-72 bg-black rounded-full border-4 border-dashed border-blue-400 overflow-hidden flex items-center justify-center mb-6 shadow-[0_0_35px_rgba(59,130,246,0.2)] transition-all duration-300 hover:border-solid hover:border-amber-500">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover rounded-full z-10"
            style={{ transform: 'scaleX(-1)' }}
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-blue-500/30 backdrop-blur-sm text-[10px] font-bold text-blue-400 px-3 py-1 rounded-full uppercase tracking-widest whitespace-nowrap animate-pulse z-20">
            {biometricStatus}
          </div>
        </div>

        <h3 className="text-lg font-bold text-white mb-1">Zero-Touch Biometric Gate</h3>
        <p className="text-xs text-gray-400 tracking-wide text-center max-w-xs">
          {blinkCount > 0 ? '✅ LIVE USER VERIFIED' : '🔒 Silahkan berkedip untuk masuk'}
        </p>
      </div>
    </div>
  );
}
