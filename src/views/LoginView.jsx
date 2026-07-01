import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { invokeBiometricVerification } from '../utils/biometricVerification';
import LoginLogo from '../assets/customs-logo.jpg';
import * as faceapi from 'face-api.js';
import { toast } from 'react-hot-toast';

const EAR_THRESHOLD = 0.24;
const FACE_DIST_THRESHOLD = 0.55;

function computeEAR(eye) {
  if (!eye || eye.length < 6) return 1;

  const p1 = eye[0];
  const p2 = eye[1];
  const p3 = eye[2];
  const p4 = eye[3];
  const p5 = eye[4];
  const p6 = eye[5];

  const point = (p) => ({ x: p.x ?? p._x, y: p.y ?? p._y });
  const a = point(p1);
  const b = point(p2);
  const c = point(p3);
  const d = point(p4);
  const e = point(p5);
  const f = point(p6);

  const vert1 = Math.hypot(b.x - f.x, b.y - f.y);
  const vert2 = Math.hypot(c.x - e.x, c.y - e.y);
  const horiz = Math.hypot(a.x - d.x, a.y - d.y);
  if (horiz === 0) return 1;
  return (vert1 + vert2) / (2 * horiz);
}

export default function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState('Position face for scan');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isMountedRef = useRef(false);
  const rafIdRef = useRef(null);
  const blinkTrackerRef = useRef({ leftClosed: false, rightClosed: false, blinkDetected: false });

  useEffect(() => {
    isMountedRef.current = true;

    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Gagal buka kamera:', err);
        setBiometricStatus('Camera Failed');
      }
    };

    startWebcam();

    return () => {
      isMountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isMountedRef.current || !videoRef.current || videoRef.current.readyState < 2) return;

    const runFaceDetection = async () => {
      if (!isMountedRef.current) return;

      try {
        const detections = await faceapi
          .detectSingleFace(videoRef.current)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detections) {
          const leftEAR = computeEAR(detections.landmarks.getLeftEye());
          const rightEAR = computeEAR(detections.landmarks.getRightEye());
          const avgEAR = (leftEAR + rightEAR) / 2;

          const tracker = blinkTrackerRef.current;
          if (avgEAR < EAR_THRESHOLD) {
            tracker.leftClosed = true;
            tracker.rightClosed = true;
          } else if (tracker.leftClosed || tracker.rightClosed) {
            tracker.blinkDetected = true;
            tracker.leftClosed = false;
            tracker.rightClosed = false;
          }

          if (tracker.blinkDetected) {
            tracker.blinkDetected = false;
            setBiometricStatus('Liveness verified. Matching...');
            await performBiometricLogin(Array.from(detections.descriptor));
          } else {
            setBiometricStatus('Blink to authenticate');
          }
        } else {
          setBiometricStatus('No face detected');
        }
      } catch (err) {
        console.error('Face detection error:', err);
      }

      if (isMountedRef.current) {
        rafIdRef.current = requestAnimationFrame(runFaceDetection);
      }
    };

    rafIdRef.current = requestAnimationFrame(runFaceDetection);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [email, password]);

  const performBiometricLogin = async (descriptor) => {
    setLoading(true);
    setBiometricStatus('Matching...');
    setError('');

    try {
      const verdict = await invokeBiometricVerification({
        action: 'verify',
        email,
        descriptor,
      });

      if (!verdict.allowed) {
        setBiometricStatus('Unknown face');
        setError('Wajah tidak dikenali. Gunakan email/password.');
        return;
      }

      setBiometricStatus(`Face verified (${verdict.confidence}). Signing in...`);
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      toast.success('Login biometrik diverifikasi lewat server.');
    } catch (err) {
      console.error('Biometric auth error:', err);
      setError(`Gagal login: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isRegisterMode) {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          throw new Error('Kamera belum siap, tunggu frame-nya muncul.');
        }

        setBiometricStatus('Capturing biometrics...');

        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          throw new Error('Muka tidak terdeteksi. Pastikan wajah berada di tengah lingkaran.');
        }

        const descriptorArray = Array.from(detection.descriptor);

        setBiometricStatus('Creating account...');
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, initials: initials.toUpperCase() } },
        });

        if (signUpError) throw signUpError;
        const newUser = authData?.user;
        if (!newUser) throw new Error('Gagal dapatkan ID user dari Auth.');

        const { error: profileError } = await supabase
          .from('profiles')
          .insert([
            {
              id: newUser.id,
              name,
              email,
              role: 'employee',
              initials: initials.toUpperCase(),
            },
          ]);

        if (profileError) throw profileError;

        const enrollVerdict = await invokeBiometricVerification({
          action: 'enroll',
          descriptor: descriptorArray,
          metadata: { source: 'login-view-register' },
        });

        if (!enrollVerdict.allowed) {
          throw new Error(`Enroll gagal: ${enrollVerdict.reason || 'UNKNOWN'}`);
        }

        setBiometricStatus(`Registrasi Berhasil (${enrollVerdict.confidence})!`);
        toast.success('🔥 Akun + Wajah berhasil terdaftar!');
        setIsRegisterMode(false);
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
      }
    } catch (err) {
      console.error('Submit Error:', err);
      setError(err.message);
      setBiometricStatus('Failed');
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

          <div className="mb-6 flex flex-col items-center">
            <div className="relative w-56 h-56 bg-black rounded-xl overflow-hidden border-2 border-gray-600 mirror-x">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            </div>
            <p className="text-blue-300 text-xs mt-2 font-medium text-center">{biometricStatus}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegisterMode && (
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Nama Lengkap"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm"
                  required
                />
                <input
                  type="text"
                  placeholder="Inisial"
                  value={initials}
                  onChange={(e) => setInitials(e.target.value)}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm uppercase"
                  required
                  maxLength="2"
                />
              </div>
            )}

            <div>
              <input
                type="email"
                placeholder="Email Resmi"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
                required
              />
            </div>

            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
                required
              />
            </div>

            {error && <div className="text-red-300 text-xs bg-red-500/20 p-2 rounded">{error}</div>}
            {message && <div className="text-emerald-300 text-xs bg-emerald-500/20 p-2 rounded">{message}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-md bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-900 font-bold hover:from-yellow-400 hover:to-yellow-500 disabled:opacity-50 uppercase tracking-wider text-sm shadow-md"
            >
              {loading ? 'Memproses...' : (isRegisterMode ? 'Daftar + Scan Wajah 📸' : 'Masuk')}
            </button>
          </form>

          <div className="text-center mt-4">
            <button onClick={() => setIsRegisterMode(!isRegisterMode)} className="text-blue-200 text-sm hover:text-white underline">
              {isRegisterMode ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
            </button>
          </div>
        </div>
      </div>

      <div className="w-1/2 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center p-8">
        <div className="text-center text-white max-w-md">
          <h1 className="text-4xl font-bold mb-3">Biometric Access</h1>
          <p className="text-slate-300">Server-side verification with confidence scoring and no client-side descriptor matching.</p>
          <p className="text-xs text-slate-500 mt-4">Blink to prove liveness, then let the backend decide.</p>
        </div>
      </div>
    </div>
  );
}
