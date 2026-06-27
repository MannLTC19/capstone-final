import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import ExportButton from '../components/ExportButton';
import * as faceapi from 'face-api.js';
import { pipeline } from '@huggingface/transformers';

/**
 * COMPONENT: AttendanceView
 * PURPOSE: Geolocation-Verified Clock-In & Time Telemetry Management Engine.
 * FEATURES:
 * 1. Live device tracking via the HTML5 Geolocation API matrix.
 * 2. Mathematical Haversine coordinate validation against office parameters.
 * 3. Dynamic role filtering enabling custom supervisors overview panels.
 */
const determineYoloVersion = () => {
  const hardwareConcurrency = navigator.hardwareConcurrency 
    ? parseInt(navigator.hardwareConcurrency, 10) 
    : 0;
  const deviceMemory = parseFloat(navigator.deviceMemory);
  if (deviceMemory < 4 || hardwareConcurrency <= 4) {
    return 'nano';
  }
  if (deviceMemory >= 8 && hardwareConcurrency > 4) {
    return 'medium';
  }
  return 'nano';
};

const YOLO_MODEL_IDS = {
  nano: import.meta.env.VITE_YOLO_NANO_MODEL_ID || 'Xenova/yolov8n-face',
  medium: import.meta.env.VITE_YOLO_MEDIUM_MODEL_ID || 'Xenova/yolov8-medium-face',
};

const AttendanceView = ({ userProfile, attendance = [], allUsers = [], fetchAttendance, fetchProfile }) => {
    const FACE_MODEL_URL = import.meta.env.VITE_FACE_MODEL_URL || '/models';
    const YOLO_FACE_MODEL_ID = import.meta.env.VITE_YOLO_FACE_MODEL_ID || 'Xenova/yolov8n-face';
    const YOLO_LOCAL_PATH = import.meta.env.VITE_YOLO_LOCAL_PATH || '/models/yolov8n-face';
    const FACE_MATCH_THRESHOLD = 0.5;
    const YOLO_FACE_THRESHOLD = 0.35;
    const ATTENDANCE_TABLE = 'attendance';
    const FACE_SCAN_INTERVAL_MS = 1800;
    const FACE_DETECT_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.15 });

    // =========================================================================
    // 🎛️ 1. REACT INTERFACE LAYER CONTEXT STATES
    // =========================================================================
    const [isLoading, setIsLoading] = useState(false); // Controls button mutation states during network requests
    const [liveDistance, setLiveDistance] = useState(null); // Calculated distance in meters from the office location
    const [isInRange, setIsInRange] = useState(false); // Flag validating if employee is inside the allowed geofence
    const [currentCoords, setCurrentCoords] = useState(null); // Stores captured active latitude/longitude vectors
    const [isCameraReady, setIsCameraReady] = useState(false); // Flags whether the laptop webcam is reachable
    const [cameraStatus, setCameraStatus] = useState('idle'); // idle | loading | ready | error
    const [isFaceVerified, setIsFaceVerified] = useState(false); // True when live face matches the registered profile photo
    const [faceStatus, setFaceStatus] = useState('idle'); // idle | loading-models | loading-reference | scanning | matched | mismatch | error
    const [faceMatchDistance, setFaceMatchDistance] = useState(null); // Euclidean distance between live face and registered reference
    const [faceScannerMessage, setFaceScannerMessage] = useState('');
    const [faceDetectionMode, setFaceDetectionMode] = useState('idle'); // idle | yolo | faceapi | fallback
    const [disableYolo, setDisableYolo] = useState(true);
    const [currentModelVersion, setCurrentModelVersion] = useState(null); // 'nano' | 'medium' | null
    const [registeredFaceSource, setRegisteredFaceSource] = useState('none'); // none | local-stream | profile-photo
    const [clockInSource, setClockInSource] = useState('none'); // none | manual | face-match | recorded
    const [clockInAt, setClockInAt] = useState('');
    const [faceOverlayBox, setFaceOverlayBox] = useState(null);
    const [hasStoredFace, setHasStoredFace] = useState(false);

    // --- SUPERVISOR BOARD COMPONENT FILTER HOOKS ---
    const [searchTerm, setSearchTerm] = useState('');
    const [filterSource, setFilterSource] = useState('all');
    const [filterMode, setFilterMode] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [sortBy, setSortBy] = useState('name-az');

    // =========================================================================
    // 📐 2. CRITICAL CORE GEOMETRIC & TIME REFERENCE VARIABLES
    // =========================================================================
    const today = new Date().toISOString().split('T')[0]; // Current system ISO date string key (YYYY-MM-DD)
    const attendanceRows = Array.isArray(attendance) ? attendance : [];

    // Finds if the active user has already executed a check-in transaction today
    const todayRecord = attendanceRows.find(record => record.employee_id === userProfile.id && record.date === today);

    const WORK_START_TIME = '08:00:00'; // Strict operational deadline constraint. Clock-ins past this are marked 'Late'
    
    // Immutable office target coordinate benchmark parameters (Directorate General of Customs and Excise)
    const OFFICE_LOCATION = {
        lat: -6.20651363, 
        lng: 106.87604852 
    };
    const ALLOWED_RADIUS_METERS = 100; // Geofence radius boundary restriction constraint rule
    const webcamVideoRef = useRef(null);
    const referenceDescriptorRef = useRef(null);
    const faceScanTimerRef = useRef(null);
    const faceScanBusyRef = useRef(false);
    const yoloDetectorRef = useRef(null);
    const yoloDetectorPromiseRef = useRef(null);
    const autoClockInGuardRef = useRef(false);
    const autoClockOutGuardRef = useRef(false);
    const webcamStreamRef = useRef(null);

    const parseStoredDescriptor = (value) => {
        if (!value) return null;

        let parsed = value;
        if (typeof value === 'string') {
            try {
                parsed = JSON.parse(value);
            } catch {
                return null;
            }
        }

        if (Array.isArray(parsed)) return new Float32Array(parsed);
        if (parsed && Array.isArray(parsed.data)) return new Float32Array(parsed.data);
        return null;
    };

    const normalizeDescriptorArray = (descriptor) => {
        const values = Array.from(descriptor || [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));

        if (values.length !== 128) return null;
        return values;
    };

    const descriptorToVectorLiteral = (descriptor) => {
        const values = normalizeDescriptorArray(descriptor);
        if (!values) return null;
        return `[${values.join(',')}]`;
    };

    const getRecordClockInTime = (record) => record?.clock_in || record?.created_at || '';

    const normalizeBoundingBox = (box) => {
        if (!box) return null;
        const x = Number(box.xmin ?? box.x ?? 0);
        const y = Number(box.ymin ?? box.y ?? 0);
        const width = Number(box.width ?? ((box.xmax ?? 0) - (box.xmin ?? 0)));
        const height = Number(box.height ?? ((box.ymax ?? 0) - (box.ymin ?? 0)));

        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

        return { x, y, width, height };
    };

    const detectWithFaceApi = async (canvasOrImage) => {
        const detections = await faceapi
            .detectAllFaces(canvasOrImage, FACE_DETECT_OPTIONS)
            .withFaceLandmarks()
            .withFaceDescriptors();

        if (detections.length > 0) {
            return detections.sort((left, right) => (right.detection.score || 0) - (left.detection.score || 0))[0];
        }

        return faceapi
            .detectSingleFace(canvasOrImage, FACE_DETECT_OPTIONS)
            .withFaceLandmarks()
            .withFaceDescriptor();
    };

    const detectFaceFromImage = async (imageEl) => {
        if (!imageEl) return null;

        const isVideo = imageEl.tagName === 'VIDEO';
        const ready = isVideo
            ? imageEl.readyState >= 2
            : imageEl.complete;
        const width = isVideo
            ? imageEl.videoWidth
            : imageEl.naturalWidth;
        const height = isVideo
            ? imageEl.videoHeight
            : imageEl.naturalHeight;

        if (!ready || width === 0 || height === 0) return null;

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        const sourceContext = sourceCanvas.getContext('2d');

        if (!sourceContext) return null;

        sourceContext.drawImage(imageEl, 0, 0, width, height);

        if (!disableYolo) {
            try {
                const detector = await ensureYoloFaceDetector();
                const detections = await detector(sourceCanvas, { threshold: YOLO_FACE_THRESHOLD });
                const bestDetection = detections
                    .filter((entry) => String(entry.label || '').toLowerCase().includes('face') || !entry.label)
                    .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || detections.sort((a, b) => (b.score || 0) - (a.score || 0))[0];

                if (bestDetection?.box) {
                    const cropCanvas = cropFaceCanvas(sourceCanvas, bestDetection.box);
                    if (cropCanvas) {
                        const croppedDetection = await detectWithFaceApi(cropCanvas);

                        if (croppedDetection) {
                            return {
                                ...croppedDetection,
                                source: 'yolo',
                                box: normalizeBoundingBox(bestDetection.box),
                            };
                        }
                    }
                }
            } catch (error) {
                console.info('YOLO fallback to face-api full frame.');
            }
        }

        const fallbackDetection = await detectWithFaceApi(sourceCanvas);
        if (!fallbackDetection) return null;

        return {
            ...fallbackDetection,
            source: 'faceapi',
            box: normalizeBoundingBox(fallbackDetection.detection?.box),
        };
    };

    const cropFaceCanvas = (sourceCanvas, box) => {
        if (!sourceCanvas || !box) return null;

        const x = Math.max(0, Math.floor(box.xmin ?? box.x ?? 0));
        const y = Math.max(0, Math.floor(box.ymin ?? box.y ?? 0));
        const width = Math.max(1, Math.floor(box.width ?? ((box.xmax ?? 0) - (box.xmin ?? 0))));
        const height = Math.max(1, Math.floor(box.height ?? ((box.ymax ?? 0) - (box.ymin ?? 0))));
        const safeWidth = Math.min(width, sourceCanvas.width - x);
        const safeHeight = Math.min(height, sourceCanvas.height - y);

        if (safeWidth <= 1 || safeHeight <= 1) return null;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = safeWidth;
        cropCanvas.height = safeHeight;

        const cropContext = cropCanvas.getContext('2d');
        if (!cropContext) return null;

        cropContext.drawImage(sourceCanvas, x, y, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
        return cropCanvas;
    };

    const ensureYoloFaceDetector = async () => {
        if (yoloDetectorRef.current) return yoloDetectorRef.current;

        if (!yoloDetectorPromiseRef.current) {
            const selectedModelVersion = determineYoloVersion();
            const modelId = selectedModelVersion === 'nano'
                ? YOLO_MODEL_IDS.nano
                : YOLO_MODEL_IDS.medium;

            yoloDetectorPromiseRef.current = pipeline('object-detection', modelId)
                .then(detector => {
                    yoloDetectorRef.current = detector;
                    setCurrentModelVersion(selectedModelVersion);
                    return detector;
                })
                .catch(async (error) => {
                    console.info(`YOLO ${selectedModelVersion} load failed; falling back to face-api.`);
                    try {
                        const localDetector = await pipeline('object-detection', YOLO_LOCAL_PATH);
                        yoloDetectorRef.current = localDetector;
                        return localDetector;
                    } catch (localErr) {
                        yoloDetectorPromiseRef.current = null;
                        throw localErr;
                    }
                });
        }

        return yoloDetectorPromiseRef.current;
    };

    // =========================================================================
    // 📊 3. DATA PROCESSING ENGINES & FILTER CONSTRUCTORS
    // =========================================================================
    
    // PERSONAL METRICS: Filters historical check-ins to compute personal punctuality ratios
    const myHistory = attendanceRows.filter(a => a.employee_id === userProfile.id);
    const totalDays = myHistory.length;
    const onTimeDays = myHistory.filter(a => a.status === 'Present').length;
    const lateDays = myHistory.filter(a => a.status === 'Late').length;
    const punctualityScore = totalDays > 0 ? ((onTimeDays / totalDays) * 100).toFixed(0) : 0;

    // SUPERVISOR METRICS: Aggregates real-time overview telemetry from active employee arrays
    const activeEmployees = allUsers.filter(u => u.role === 'employee');
    const clockedInTodayCount = activeEmployees.filter(emp => 
        attendanceRows.some(a => a.employee_id === emp.id && a.date === today)
    ).length;
    const wfhAssignmentCount = activeEmployees.filter(emp => emp.work_mode === 'WFH').length;
    const wfoAssignmentCount = activeEmployees.filter(emp => (emp.work_mode || 'WFO') === 'WFO').length;

    const getUserName = (id) => allUsers.find(u => u.id === id)?.name || 'Unknown Officer';

    // CAMPUS PICKER: Dynamically maps unique educational institutions to populate filter drop-downs
    const uniqueSources = Array.from(
        new Set(
            allUsers
                .filter(u => u.role === 'employee')
                .map(u => u.source || u.university || 'President University')
        )
    );

    // FILTER PIPELINE ENGINE: Computes text searches and dropdown metrics on the main intern grid
    const processedInterns = allUsers
        .filter(u => u.role === 'employee')
        .filter(emp => {
            const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase());
            const empSource = emp.source || emp.university || 'President University';
            const matchesSource = filterSource === 'all' || empSource === filterSource;
            const empMode = emp.work_mode || 'WFO';
            const matchesMode = filterMode === 'all' || empMode === filterMode;
            
            const empTodayRecord = attendanceRows.find(a => a.employee_id === emp.id && a.date === today);
            let matchesStatus = true;
            if (filterStatus === 'clocked_in') matchesStatus = !!empTodayRecord;
            if (filterStatus === 'not_clocked_in') matchesStatus = !empTodayRecord;

            return matchesSearch && matchesSource && matchesMode && matchesStatus;
        })
        .sort((a, b) => {
            if (sortBy === 'name-az') return a.name.localeCompare(b.name);
            if (sortBy === 'name-za') return b.name.localeCompare(a.name);
            if (sortBy === 'status-active') {
                const aClocked = attendanceRows.some(att => att.employee_id === a.id && att.date === today);
                const bClocked = attendanceRows.some(att => att.employee_id === b.id && att.date === today);
                return bClocked - aClocked; // Pushes active check-ins to the top of rows
            }
            return 0;
        });

    // SPREADSHEET BUILDER: Formats processed logs into tabular blocks before launching Excel exports
    const exportDataFiltered = processedInterns.flatMap(emp => 
        attendanceRows.filter(a => a.employee_id === emp.id).map(record => ({
            Date: record.date,
            Employee: emp.name,
            Institution: emp.source || emp.university || 'President University',
            "Assigned Mode": emp.work_mode || 'WFO',
            Status: record.status,
            "Check In": getRecordClockInTime(record),
            "Check Out": record.clock_out
        }))
    );

    // =========================================================================
    // 🛰️ 4. GEOLOCATION RUNTIME HARDWARE LIFECYCLE LISTENERS
    // =========================================================================
    useEffect(() => {
        if (!navigator.geolocation || !userProfile) return;

        // Hooks into the hardware tracking stream to catch coordinate shifts instantly
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                try {
                    const { latitude, longitude } = position.coords;
                    setCurrentCoords({ latitude, longitude }); 

                    // Calculates geodesic distance metric vectors
                    const dist = getDistanceFromLatLonInMeters(latitude, longitude, OFFICE_LOCATION.lat, OFFICE_LOCATION.lng);
                    setLiveDistance(dist);
                    
                    // Enforces boundary logic restrictions based on access permissions and assignments
                    if (userProfile.role === 'supervisor') {
                        setIsInRange(true); // Administrative profiles bypass radial geofence constraints globally
                    } else {
                        const assignedMode = userProfile.work_mode || 'WFO';
                        if (assignedMode === 'WFH') {
                            setIsInRange(true); // Remote work assignments bypass spatial lock barriers
                        } else {
                            setIsInRange(dist <= ALLOWED_RADIUS_METERS); // On-site employees must comply with the 100m geofence
                        }
                    }
                } catch (e) {
                    console.info('Error processing geolocation position:', e);
                }
            },
            (err) => {
                    console.info("GPS stream hardware exception error logging:", err);
                // Graceful fallback when geolocation fails
                setCurrentCoords(null);
                setLiveDistance(null);
                setIsInRange(false);
                // show friendly message to user via face scanner area
                setFaceScannerMessage('Geolocation unavailable. Please enable location services or check browser permissions.');
            },
            { enableHighAccuracy: true, timeout: 10000 } // Demands peak precision coordinates
        );

        // Cleanup: Destroys active GPS streams cleanly when changing tabs to preserve device battery
        return () => navigator.geolocation.clearWatch(watchId);
    }, [userProfile]);

    useEffect(() => {
        if (!userProfile || userProfile.role === 'supervisor') return;

        let isCancelled = false;
        let stream = null;

        const startWebcam = async () => {
            setCameraStatus('loading');
            setIsCameraReady(false);

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, frameRate: { ideal: 30 } },
                    audio: false,
                });

                if (isCancelled) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                webcamStreamRef.current = stream;

                if (webcamVideoRef.current) {
                    webcamVideoRef.current.srcObject = stream;
                }

                setIsCameraReady(true);
                setCameraStatus('ready');
            } catch (error) {
                console.info('Webcam access failed:', error);
                if (!isCancelled) {
                    setIsCameraReady(false);
                    setCameraStatus('error');
                }
            }
        };

        startWebcam();

        return () => {
            isCancelled = true;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (webcamStreamRef.current) {
                webcamStreamRef.current.getTracks().forEach(track => track.stop());
                webcamStreamRef.current = null;
            }
        };
    }, [userProfile]);

    useEffect(() => {
        if (!userProfile || userProfile.role === 'supervisor') return;

        let retryTimer = null;
        if (!isCameraReady && cameraStatus === 'error') {
            retryTimer = window.setTimeout(() => {
                // Retry handled by the parent effect cleanup + restart
            }, 3000);
        }

        return () => {
            if (retryTimer) window.clearTimeout(retryTimer);
        };
    }, [cameraStatus, isCameraReady, userProfile]);

    useEffect(() => {
        if (!userProfile || userProfile.role === 'supervisor') return;

        let cancelled = false;

        const loadFaceModelsAndReference = async () => {
            try {
                setFaceStatus('loading-models');
                setFaceScannerMessage('Loading face models...');

                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
                ]);

                setFaceDetectionMode('faceapi');
                setFaceScannerMessage('Face-api models loaded. Preparing optional YOLO detector...');

                try {
                    if (!disableYolo) {
                        await ensureYoloFaceDetector();
                        if (!cancelled) {
                            setFaceDetectionMode('yolo');
                        }
                    } else {
                        setFaceDetectionMode('fallback');
                    }
                } catch (yoloError) {
                    console.info('YOLO disabled or unavailable; continuing with face-api only.');
                    if (!cancelled) {
                        setFaceDetectionMode('fallback');
                        setFaceScannerMessage('Face-api only mode active.');
                    }
                }

                if (cancelled) return;

                // Use the already-loaded profile object only. Avoid extra Supabase round-trips that can fail with 400.
                const savedDescriptor = parseStoredDescriptor(userProfile.face_descriptor);
                if (savedDescriptor) {
                    setHasStoredFace(true);
                    referenceDescriptorRef.current = savedDescriptor;
                    setRegisteredFaceSource('supabase');
                    setFaceStatus('scanning');
                    setFaceScannerMessage('Registered face loaded from Supabase profile. Scanning live stream...');
                    return;
                }

                if (!userProfile.avatar_url) {
                    setHasStoredFace(false);
                    referenceDescriptorRef.current = null;
                    setRegisteredFaceSource('none');
                    setFaceStatus('error');
                    setFaceScannerMessage('No registered face yet. Enroll from live Laptop Webcam frame or add a profile photo first.');
                    return;
                }

                setFaceStatus('loading-reference');
                setFaceScannerMessage('Reading your registered profile face...');

                const referenceImage = await faceapi.fetchImage(userProfile.avatar_url);
                const referenceDetection = await faceapi
                    .detectSingleFace(referenceImage, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (cancelled) return;

                if (!referenceDetection) {
                    referenceDescriptorRef.current = null;
                    setRegisteredFaceSource('none');
                    setFaceStatus('error');
                    setFaceScannerMessage('No face detected in your profile photo. Use a clearer frontal face image or enroll from live stream.');
                    return;
                }

                referenceDescriptorRef.current = referenceDetection.descriptor;
                setHasStoredFace(false);
                setRegisteredFaceSource('profile-photo');
                setFaceStatus('scanning');
                setFaceScannerMessage('Profile face loaded. You can also enroll from live Laptop Webcam frame for better accuracy.');
            } catch (error) {
                console.error('Face model loading error:', error);
                if (cancelled) return;
                referenceDescriptorRef.current = null;
                setRegisteredFaceSource('none');
                setFaceStatus('error');
                const message = String(error?.message || error || '');
                if (message.toLowerCase().includes('avatar') || message.toLowerCase().includes('image') || message.toLowerCase().includes('fetch')) {
                    setFaceScannerMessage('Profile photo could not be read. Use a clearer public image URL or enroll from the live camera stream.');
                } else {
                    setFaceScannerMessage(`Face recognition failed to initialize: ${message || 'check model URL and network access.'}`);
                }
            }
        };

        loadFaceModelsAndReference();

        return () => {
            cancelled = true;
        };
    }, [userProfile, FACE_MODEL_URL]);

    useEffect(() => {
        // ==== 1️⃣ THROTTLE INFERENCE LOOP TO SAVE CPU (300ms batch) ====
        // Use ref for cancelled state to ensure it's accessible in cleanup
        const cancelledRef = { current: false };

        const scanFrame = async () => {
            if (cancelledRef.current || faceScanBusyRef.current) return;

            const videoEl = webcamVideoRef.current;
            if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
                setFaceScannerMessage('Waiting for webcam frames...');
                return;
            }

            try {
                const liveDetection = await detectFaceFromImage(videoEl);

                if (!liveDetection || cancelledRef.current) {
                    setIsFaceVerified(false);
                    setFaceStatus('mismatch');
                    setFaceMatchDistance(null);
                    setFaceOverlayBox(null);
                    setFaceScannerMessage('No face detected in live stream.');
                    return;
                }

                if (liveDetection.box && videoEl) {
                    setFaceOverlayBox({
                        ...liveDetection.box,
                        imageWidth: videoEl.videoWidth,
                        imageHeight: videoEl.videoHeight,
                    });
                }

                const distance = faceapi.euclideanDistance(liveDetection.descriptor, referenceDescriptorRef.current);
                const matched = distance <= FACE_MATCH_THRESHOLD;

                setFaceMatchDistance(distance);
                setIsFaceVerified(matched);
                setFaceStatus(matched ? 'matched' : 'mismatch');
                setFaceDetectionMode(liveDetection.source || 'faceapi');
                setFaceScannerMessage(
                    matched
                        ? 'Registered face matched. Attendance will be clocked in automatically.'
                        : 'Face does not match the registered profile.'
                );
            } catch (error) {
                console.info('Live face scan error:', error);
                if (!cancelledRef.current) {
                    setIsFaceVerified(false);
                    setFaceStatus('error');
                    setFaceScannerMessage('Face scan failed while reading the webcam frame.');
                }
            } finally {
                faceScanBusyRef.current = false;
            }
        };

        // ==== 3️⃣ OPTIMIZED LOOP WITH THROTTLED SCAN RATE ====
        scanFrame(); // Initial run
        faceScanTimerRef.current = window.setInterval(() => {
            scanFrame();
        }, FACE_SCAN_INTERVAL_MS * 3); // Slow down by 3x: from 1800ms → ~5400ms

        // CLEANUP: Clear interval and mark as cancelled on unmount
        return () => {
            cancelledRef.current = true;
            if (faceScanTimerRef.current) {
                window.clearInterval(faceScanTimerRef.current);
                faceScanTimerRef.current = null;
            }
        };
    }, [userProfile, isCameraReady, faceStatus]);

    useEffect(() => {
        const savedClockIn = getRecordClockInTime(todayRecord);

        if (savedClockIn) {
            setClockInAt(savedClockIn);
            if (clockInSource === 'none') {
                setClockInSource('recorded');
            }
        }
    }, [todayRecord, clockInSource]);

    /**
     * MATHEMATICAL CALCULATOR: getDistanceFromLatLonInMeters
     * PURPOSE: The Haversine Formula. Computes the shortest absolute distance between 
     * two pairs of latitude/longitude coordinates over the earth's spherical curve in meters.
     */
    const getDistanceFromLatLonInMeters = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Earth's mean radius in kilometers
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return (R * c) * 1000; // Returns exact float distance values converted to meters
    };

    // FIXED MAP LINK: Uses standard URL search strings to mount vectors safely on Google Maps maps layers
    const openMap = (lat, lng) => {
        if (!lat || !lng) return;
        window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
    };

        const getFaceOverlayStyle = () => {
        if (!faceOverlayBox || !webcamVideoRef.current) return null;

        const videoEl = webcamVideoRef.current;
        const naturalWidth = videoEl.videoWidth || faceOverlayBox.imageWidth;
        const naturalHeight = videoEl.videoHeight || faceOverlayBox.imageHeight;
        const viewportWidth = videoEl.clientWidth || 0;
        const viewportHeight = videoEl.clientHeight || 0;

        if (!naturalWidth || !naturalHeight || !viewportWidth || !viewportHeight) return null;

        const naturalRatio = naturalWidth / naturalHeight;
        const viewportRatio = viewportWidth / viewportHeight;

        let displayedWidth = viewportWidth;
        let displayedHeight = viewportHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (viewportRatio > naturalRatio) {
            displayedHeight = viewportHeight;
            displayedWidth = viewportHeight * naturalRatio;
            offsetX = (viewportWidth - displayedWidth) / 2;
        } else {
            displayedWidth = viewportWidth;
            displayedHeight = viewportWidth / naturalRatio;
            offsetY = (viewportHeight - displayedHeight) / 2;
        }

        const scaleX = displayedWidth / naturalWidth;
        const scaleY = displayedHeight / naturalHeight;

        return {
            left: `${offsetX + (faceOverlayBox.x * scaleX)}px`,
            top: `${offsetY + (faceOverlayBox.y * scaleY)}px`,
            width: `${faceOverlayBox.width * scaleX}px`,
            height: `${faceOverlayBox.height * scaleY}px`,
        };
    };

    // =========================================================================
    // ⚙️ 5. SUPABASE DATABASE WRITE MUTATION HANDLERS
    // =========================================================================

    /**
     * TRANSACTION: handleToggleWorkMode
     * PURPOSE: Shifts an employee's configuration track state (`WFO` <-> `WFH`) inside public.profiles.
     */
    const handleToggleWorkMode = async (employeeId, currentMode) => {
        const nextMode = currentMode === 'WFH' ? 'WFO' : 'WFH';
        const { error } = await supabase
            .from('profiles')
            .update({ work_mode: nextMode })
            .eq('id', employeeId);

        if (error) alert("Failed to change work mode allocation: " + error.message);
        else window.location.reload(); 
    };

    /**
     * TRANSACTION: handleClockIn
     * PURPOSE: Inserts a morning timestamp signature into public.attendance_logs.
     * METRIC RULE: Compares transactional timestamp vector rows against WORK_START_TIME (08:00) to flag punctuality.
     */
    const handleClockIn = async (source = 'manual') => {
        if (!currentCoords) return alert("Waiting for secure GPS baseline validation coordinates...");
        if (!isInRange) return alert(`Geofence rejection exception: You sit ${liveDistance?.toFixed(0)}m outside office gates.`);
        if (userProfile.role !== 'supervisor' && (!isCameraReady || !isFaceVerified)) return false;

        setIsLoading(true);
        try {
            const now = new Date();
            const time = now.toLocaleTimeString('en-GB', { hour12: false });
            const status = time > WORK_START_TIME ? 'Late' : 'Present'; // Late calculation gateway execution line

            const { error } = await supabase.from(ATTENDANCE_TABLE).insert([{ 
                employee_id: userProfile.id,
                date: today,
                status,
                latitude: currentCoords ? currentCoords.latitude : null,
                longitude: currentCoords ? currentCoords.longitude : null,
            }]);

            if (error) {
                alert('Database submission error: ' + error.message);
                return false;
            }

            setClockInSource(source);
            setClockInAt(time);
            setFaceScannerMessage(
                source === 'face-match'
                    ? `Face matched. Auto clock-in saved at ${time}.`
                    : `Clock-in saved at ${time}.`
            );

            await fetchAttendance();
            return true;
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!userProfile || userProfile.role === 'supervisor') return;
        if (todayRecord) {
            autoClockInGuardRef.current = false;
            return;
        }

        if (!isCameraReady || !isInRange || !isFaceVerified || isLoading) return;
        if (autoClockInGuardRef.current) return;

        // NEW: LOCK THE TRIGGER IMMEDIATELY TO PREVENT REPEATED INVOCATIONS
        autoClockInGuardRef.current = true;
        void handleClockIn('face-match').then((success) => {
            if (!success) {
                autoClockInGuardRef.current = false;
            }
        });
    }, [userProfile, todayRecord, isCameraReady, isInRange, isFaceVerified, isLoading, currentCoords, liveDistance]);

    const handleEnrollFaceFromStream = async () => {
        if (!userProfile) return;
        if (hasStoredFace) {
            setFaceStatus('error');
            setFaceScannerMessage('Wajah sudah tersimpan. Hapus dulu dengan Reset Enrolled Face, lalu register ulang.');
            return;
        }
        const streamImage = webcamVideoRef.current;
        // For <video> elements: check readyState (4 = HAVE_ENOUGH_DATA) or srcObject existence
        const isVideoReady = streamImage && streamImage.tagName === 'VIDEO' && streamImage.readyState >= 2;
        const isImgReady = streamImage && streamImage.tagName === 'IMG' && streamImage.complete && streamImage.naturalWidth > 0;
        
        if (!streamImage || (!isVideoReady && !isImgReady)) {
            alert('Stream frame belum siap. Tunggu preview kamera muncul dulu.');
            return;
        }

        try {
            setFaceStatus('scanning');
            setFaceScannerMessage('Enrolling registered face from live Laptop Webcam frame...');

            let detection = null;
            for (let attempt = 0; attempt < 4 && !detection; attempt += 1) {
                detection = await detectFaceFromImage(streamImage);
                if (!detection && attempt < 3) {
                    setFaceScannerMessage(`Mencari wajah... percobaan ${attempt + 2} dari 4`);
                    await new Promise((resolve) => window.setTimeout(resolve, 250));
                }
            }

            if (!detection) {
                setFaceStatus('mismatch');
                setFaceScannerMessage('Enroll gagal: tidak ada wajah terdeteksi pada beberapa frame terakhir. Coba lebih dekat, terang, dan lurus ke kamera.');
                return;
            }

            referenceDescriptorRef.current = detection.descriptor;

            try {
                const descriptorArray = normalizeDescriptorArray(detection.descriptor);
                const embedding = descriptorToVectorLiteral(detection.descriptor);

                if (!descriptorArray || !embedding) {
                    throw new Error('Face descriptor must contain 128 numeric values.');
                }

                await supabase.from('faces').delete().eq('profile_id', userProfile.id);

                const { error: insertErr } = await supabase
                    .from('faces')
                    .insert([{ 
                        profile_id: userProfile.id,
                        descriptor: descriptorArray,
                        embedding,
                        thumbnail_url: userProfile.avatar_url || null,
                        is_primary: true,
                        metadata: {
                            source: 'esp32-cam-stream',
                            model: 'face-api.js',
                        },
                    }]);

                if (insertErr) {
                    throw insertErr;
                }

                setHasStoredFace(true);
            } catch (err) {
                console.warn('faces insert exception:', err);
            }

            const { error } = await supabase
                .from('profiles')
                .update({ face_descriptor: Array.from(detection.descriptor) })
                .eq('id', userProfile.id);

            if (error) {
                setFaceStatus('error');
                setFaceScannerMessage(`Save enrolled face failed: ${error.message}`);
                return;
            }

            await fetchProfile?.();
            setRegisteredFaceSource('faces');
            setIsFaceVerified(false);
            setFaceMatchDistance(null);
            setFaceStatus('scanning');
            setFaceScannerMessage('Enroll berhasil. Wajah dari Laptop Webcam disimpan di Supabase dan dipakai untuk clock-in.');
        } catch (error) {
            console.error('Enroll face error:', error);
            setFaceStatus('error');
            setFaceScannerMessage('Enroll wajah gagal. Coba lagi dengan posisi wajah lebih terang dan stabil.');
        }
    };

    const handleResetEnrolledFace = () => {
        if (!userProfile) return;

        void (async () => {
            // Delete faces rows for this profile and clear profiles.face_descriptor for backward compatibility
            try {
                const { error: delErr } = await supabase.from('faces').delete().eq('profile_id', userProfile.id);
                if (delErr) console.warn('Failed to delete faces rows:', delErr);
            } catch (err) {
                console.warn('faces delete exception:', err);
            }

            const { error } = await supabase
                .from('profiles')
                .update({ face_descriptor: null })
                .eq('id', userProfile.id);

            if (error) {
                alert(`Reset enrolled face gagal: ${error.message}`);
                return;
            }

            referenceDescriptorRef.current = null;
            setRegisteredFaceSource('none');
            setHasStoredFace(false);
            setIsFaceVerified(false);
            setFaceMatchDistance(null);
            setFaceOverlayBox(null);
            setClockInSource('none');
            setClockInAt('');
            setFaceStatus('error');
            setFaceScannerMessage('Enrolled face dari Supabase sudah dihapus. Upload atau enroll ulang untuk clock-in.');
            await fetchProfile?.();
        })();
    };

    const handleRefreshEsp32Stream = () => {
        setCameraStatus('loading');
        setIsCameraReady(false);
        setFaceOverlayBox(null);
        setFaceScannerMessage('Refreshing laptop webcam...');

        const refreshStream = async () => {
            try {
                const videoEl = webcamVideoRef.current;
                if (!videoEl || !navigator.mediaDevices?.getUserMedia) {
                    throw new Error('Webcam refresh not supported');
                }
                const nextStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, frameRate: { ideal: 30 } },
                    audio: false,
                });
                videoEl.srcObject = nextStream;
                if (webcamStreamRef.current) {
                    webcamStreamRef.current.getTracks().forEach(track => track.stop());
                }
                webcamStreamRef.current = nextStream;
                setIsCameraReady(true);
                setCameraStatus('ready');
            } catch (error) {
                console.info('Webcam refresh failed:', error);
                setIsCameraReady(false);
                setCameraStatus('error');
            }
        };

        void refreshStream();
    };

    /**
     * TRANSACTION: handleClockOut
     * PURPOSE: Appends an afternoon exit timestamp onto today's attendance record slot.
     */
    const handleClockOut = async () => {
        if (!currentCoords) return alert("Waiting for location coordinates...");
        if (userProfile.work_mode !== 'WFH' && !isInRange) return alert("Geofence exception: Retain on-site coordinates to complete clock-out transactions.");
        
        setIsLoading(true); 
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        
        const { error } = await supabase
            .from(ATTENDANCE_TABLE)
            .update({ clock_out: time })
            .eq('id', todayRecord.id);
        
        if (error) alert("Database write update error: Failed to log clock out parameters.");
        else await fetchAttendance(); 
        setIsLoading(false); 
    };

 const statusBadge = (status, clockOut, date) => {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. INCOMPLETE (Past Date)
    if (!clockOut && date !== today) {
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50">Incomplete</span>;
    }
    
    // 2. IN PROGRESS (Today)
    if (!clockOut) {
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50">In Progress</span>;
    }

    // 3. OTHERS
    const styles = {
        'Present': 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/50',
        'Late': 'bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/50',
    }[status] || 'bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:text-gray-300';
    
    return <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles}`}>{status}</span>;
};

    // =========================================================================
    // 💻 6. VIEWPORT DESIGN TEMPLATE RENDER MODULES
    // =========================================================================
    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            
            {/* --- LAYOUT HEADER ACCENTS --- */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center border-b border-gray-200 dark:border-gray-700 pb-4 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">
                        {userProfile.role === 'supervisor' ? 'Intern Tracking Portal' : 'My Attendance Logs'}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {userProfile.role === 'supervisor' ? 'Manage operational check-in parameters and export sheets.' : 'Log work availability tokens and verify historical tracks.'}
                    </p>
                </div>

                {/* SUPERVISOR PANEL HEADER WHITE-SPACE SUMMARY FLUID CARDS */}
                {userProfile.role === 'supervisor' && (
                    <div className="hidden xl:flex items-center gap-3.5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-4 py-2 rounded-2xl text-xs font-semibold text-gray-600 dark:text-gray-300 shadow-sm">
                        <div className="flex items-center gap-1.5 border-r border-gray-100 dark:border-gray-700 pr-3.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            <span>Total Roster: <b className="text-gray-900 dark:text-white font-bold">{activeEmployees.length}</b></span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 border-r border-gray-100 dark:border-gray-700 pr-3.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span>Clocked In Today: <b className="text-gray-900 dark:text-white font-bold">{clockedInTodayCount}</b></span>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 dark:text-gray-500 font-medium">Duty Allotments:</span>
                            <span className="bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 px-2.5 py-0.5 rounded-lg border border-blue-100 dark:border-blue-900/50 font-bold text-[10px] uppercase">
                                🏢 {wfoAssignmentCount} WFO
                            </span>
                            <span className="bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300 px-2.5 py-0.5 rounded-lg border border-purple-100 dark:border-purple-900/50 font-bold text-[10px] uppercase">
                                🏠 {wfhAssignmentCount} WFH
                            </span>
                        </div>
                    </div>
                )}

                {userProfile.role === 'supervisor' && (
                    <ExportButton data={exportDataFiltered} filename="Filtered_Intern_Attendance" label="Export Hand-Picked Records" />
                )}
            </div>

            {/* ========================================================================= */}
            {/* 🏢 PROFILE PROACT ZONE: SUPERVISOR TRACKING CONSOLE MATRIX              */}
            {/* ========================================================================= */}
            {userProfile.role === 'supervisor' ? (
                <div className="space-y-4">
                    
                    {/* SEARCH CONTROLS FILTER BLOCK */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Search Intern</label>
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Type a name..."
                                className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50 dark:bg-gray-700 dark:text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Origin Source</label>
                            <select
                                value={filterSource}
                                onChange={(e) => setFilterSource(e.target.value)}
                                className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50 dark:bg-gray-700 dark:text-white font-bold"
                            >
                                <option value="all">All Campuses</option>
                                {uniqueSources.map(src => <option key={src} value={src}>{src}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Duty Mode</label>
                            <select
                                value={filterMode}
                                onChange={(e) => setFilterMode(e.target.value)}
                                className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50 dark:bg-gray-700 dark:text-white font-bold"
                            >
                                <option value="all">All Modes</option>
                                <option value="WFO">🏢 Office (WFO)</option>
                                <option value="WFH">🏠 Remote (WFH)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Attendance Status</label>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50 dark:bg-gray-700 dark:text-white font-bold"
                            >
                                <option value="all">All Activity</option>
                                <option value="clocked_in">Active (Clocked In)</option>
                                <option value="not_clocked_in">Inactive (Not In)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Sort Matrix</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50 dark:bg-gray-700 dark:text-white font-bold"
                            >
                                <option value="name-az">Name (A → Z)</option>
                                <option value="name-za">Name (Z → A)</option>
                                <option value="status-active">Clocked In First</option>
                            </select>
                        </div>
                    </div>

                    {/* CORE ROSTER TRACKING TABLE SHEET */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50/80 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                    <tr>
                                        <th className="p-4">Intern Name</th>
                                        <th className="p-4">Source / Origin</th>
                                        <th className="p-4">Assigned Duty Mode</th>
                                        <th className="p-4">Today's Status</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-xs">
                                    {processedInterns.map(emp => {
                                        const empToday = attendance.find(a => a.employee_id === emp.id && a.date === today);
                                        const empRecords = attendance.filter(a => a.employee_id === emp.id);
                                        const empTotalDays = empRecords.length;
                                        const empOnTime = empRecords.filter(a => a.status === 'Present').length;
                                        const empLate = empRecords.filter(a => a.status === 'Late').length;
                                        const empPunctuality = empTotalDays > 0 ? ((empOnTime / empTotalDays) * 100).toFixed(0) : 0;

                                        const empHistoryExport = empRecords.map(record => ({
                                            Date: record.date,
                                            Status: record.status,
                                            "Check In": record.clock_in,
                                            "Check Out": record.clock_out,
                                            Latitude: record.latitude,
                                            Longitude: record.longitude
                                        }));

                                        return (
                                            <tr key={emp.id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-all font-semibold">
                                                <td className="p-4 text-gray-900 dark:text-gray-100 relative">
                                                    <div className="flex items-center gap-3">
                                                        <div className="relative group cursor-help">
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white text-xs shadow-sm group-hover:scale-105 transition-all">
                                                                {emp.name?.charAt(0)}
                                                            </div>
                                                            {/* FLUID MINI GRAPH PROFILE OVERLAY HOVER CARD */}
                                                            <div className="absolute left-10 top-0 invisible group-hover:visible opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 transition-all duration-200 z-50 w-52 bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 pointer-events-none text-[11px]">
                                                                <div className="flex justify-between items-center mb-2">
                                                                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Historical Track</span>
                                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                                        empPunctuality >= 85 ? 'bg-green-50 text-green-700 dark:bg-green-950/30' : 'bg-orange-50 text-orange-700 dark:bg-orange-950/30'
                                                                    }`}>
                                                                        {empPunctuality}% Score
                                                                    </span>
                                                                </div>
                                                                <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden mb-3">
                                                                    <div className={`h-full transition-all duration-300 ${empPunctuality >= 85 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${empPunctuality}%` }}></div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                                                                    <div className="bg-gray-50 dark:bg-gray-800/40 p-2 rounded-xl border dark:border-gray-700">
                                                                        <div className="text-[8px] font-bold text-gray-400 uppercase">Days Present</div>
                                                                        <div className="text-xs font-bold text-gray-700 dark:text-gray-200">{empTotalDays}</div>
                                                                    </div>
                                                                    <div className="bg-gray-50 dark:bg-gray-800/40 p-2 rounded-xl border dark:border-gray-700">
                                                                        <div className="text-[8px] font-bold text-gray-400 uppercase">Late Count</div>
                                                                        <div className="text-xs font-bold text-orange-500">{empLate}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span>{emp.name}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="inline-block bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 px-2.5 py-0.5 rounded-md text-[10px] uppercase font-bold border dark:border-gray-600">
                                                        {emp.source || emp.university || 'President University'}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleWorkMode(emp.id, emp.work_mode || 'WFO')}
                                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-bold transition-all border shadow-sm text-[11px] ${
                                                            emp.work_mode === 'WFH'
                                                                ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/50'
                                                                : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50'
                                                        }`}
                                                    >
                                                        {emp.work_mode === 'WFH' ? '🏠 WFH (Remote)' : '🏢 WFO (On-Site)'}
                                                    </button>
                                                </td>
                                                <td className="p-4">
                                                    {empToday ? (
                                                        <div className="flex flex-col gap-0.5">
                                                                    {statusBadge(empToday.status, empToday.clock_out, empToday.date)}                                                            <span className="text-[10px] font-bold text-gray-400 font-mono mt-0.5">IN: {getRecordClockInTime(empToday)}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-50 text-gray-400 border border-gray-200 dark:bg-gray-900/20 dark:text-gray-500 dark:border-gray-800">
                                                            Not Clocked In
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className="inline-flex justify-end gap-2">
                                                        {empToday?.latitude && (
                                                            <button 
                                                                type="button"
                                                                onClick={() => openMap(empToday.latitude, empToday.longitude)} 
                                                                className="text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400 font-bold px-2.5 py-1 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 shadow-sm transition"
                                                            >
                                                                🗺️ Geolocation
                                                            </button>
                                                        )}
                                                        <ExportButton data={empHistoryExport} filename={`${emp.name.replace(/\s+/g, '_')}_Attendance`} label="Export Logs" />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                /* ========================================================================= */
                /* 👤 EMPLOYEE PANEL ZONE: INDIVIDUAL CLOCK INTERFACES                     */
                /* ========================================================================= */
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs uppercase tracking-wider text-gray-400 font-bold">
                        <div className="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-2xl p-5 text-white shadow-md shadow-blue-500/10">
                            <p className="text-blue-100 text-xs font-bold uppercase mb-1">My Punctuality Score</p>
                            <h3 className="text-4xl font-black">{punctualityScore}%</h3>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="mb-1 text-gray-400">Total Days Present</p>
                            <h3 className="text-4xl font-black text-gray-800 dark:text-gray-100">{totalDays} <span className="text-xs font-bold text-gray-400 uppercase">Days</span></h3>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                            <p className="mb-1 text-gray-400">Late Arrivals</p>
                            <h3 className={`text-4xl font-black ${lateDays > 0 ? 'text-orange-500' : 'text-gray-800 dark:text-gray-100'}`}>{lateDays} <span className="text-xs font-bold text-gray-400 uppercase">Days</span></h3>
                        </div>
                    </div>

                    {/* HARDWARE CLOCK BUTTON CONTROLS WIDGET CARD */}
                    <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
                         <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isInRange ? 'bg-green-50 text-green-600 dark:bg-green-950/30' : 'bg-red-50 text-red-600 dark:bg-red-950/30 animate-pulse'}`}>
                                <span className="text-2xl">{(userProfile.work_mode || 'WFO') === 'WFO' ? '🏢' : '🏠'}</span>
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">
                                    Duty Profile: {(userProfile.work_mode || 'WFO') === 'WFO' ? 'Office (On-Site WFO)' : 'Remote (Home WFH)'}
                                </h2>
                                <p className={`text-xs font-bold uppercase font-mono mt-0.5 tracking-wide ${isInRange ? 'text-green-600' : 'text-red-500'}`}>
                                    {(userProfile.work_mode || 'WFO') === 'WFO' 
                                        ? (liveDistance !== null ? `📍 ${liveDistance.toFixed(0)} meters from Office Boundary` : '🔍 Acquiring GPS Tracking Signal...')
                                        : '🔒 Remote network node verified'}
                                </p>
                                    <p className={`text-[10px] font-bold uppercase tracking-wider mt-1 ${isCameraReady ? 'text-emerald-600' : cameraStatus === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
{userProfile.role === 'supervisor'
                                                ? '🛠️ Supervisor bypass camera gate'
                                                : cameraStatus === 'ready'
                                                    ? '📷 Laptop Webcam stream online'
                                                    : cameraStatus === 'error'
                                                        ? '📷 Webcam stream offline'
                                                        : '📷 Probing Webcam stream...'}
                                    </p>
                                    {userProfile.role !== 'supervisor' && getRecordClockInTime(todayRecord) && (
                                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                                            {clockInSource === 'face-match'
                                                ? `Auto clock-in confirmed by face at ${clockInAt || getRecordClockInTime(todayRecord)}`
                                                : `Clock-in recorded at ${clockInAt || getRecordClockInTime(todayRecord)}`}
                                        </p>
                                    )}
                            </div>
                         </div>
                         
                         {/* MAIN TRANSACTION ACTIONS HUB */}
                         <div className="flex gap-3">
                            {!todayRecord && (
                                    <button 
                                    type="button"
                                    onClick={handleClockIn} 
                                    disabled={isLoading || !isInRange || !isCameraReady || !isFaceVerified} 
                                    className={`px-8 py-3 rounded-xl font-bold text-white transition-all shadow-md ${isLoading || !isInRange || !isCameraReady || !isFaceVerified ? 'bg-gray-300 cursor-not-allowed text-gray-500 dark:bg-gray-700' : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 shadow-blue-500/10'}`}
                                >
                                    {isLoading ? 'Registering Attendance...' : (isFaceVerified ? 'Clock In Shift' : 'Waiting for Registered Face...')}
                                </button>
                            )}
                            {todayRecord && !todayRecord.clock_out && (
                                <button 
                                    type="button"
                                    onClick={handleClockOut} 
                                    disabled={isLoading} 
                                    className={`px-8 py-3 rounded-xl font-bold text-white transition-all shadow-md ${isLoading ? 'bg-gray-300 cursor-not-allowed text-gray-500' : 'bg-yellow-500 hover:bg-yellow-600 hover:-translate-y-0.5 shadow-yellow-500/10'}`}
                                >
                                    {isLoading ? 'Processing Pipeline...' : 'Clock Out Shift'}
                                </button>
                            )}
                            {todayRecord && todayRecord.clock_out && (
                                <div className="px-6 py-3 bg-gray-50 border border-gray-100 text-gray-400 font-extrabold rounded-xl text-xs uppercase tracking-wider dark:bg-gray-900/40 dark:border-gray-800 dark:text-gray-500">
                                    ✓ Shift Completed
                                </div>
                            )}
                         </div>
                    </div>

                    {/* WEBCAM STREAM PREVIEW */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                            <div>
                                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Webcam Attendance Feed</h3>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Live camera for attendance verification.</p>
                            </div>
                        </div>
                        <div className="p-5">
                            <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-950 aspect-video flex items-center justify-center">
                                {userProfile.role === 'supervisor' ? (
                                    <div className="text-center text-gray-300 px-6">
                                        <p className="text-sm font-bold">Camera preview disabled for supervisor mode</p>
                                        <p className="text-[11px] text-gray-500 mt-1">The Laptop Webcam gate only blocks employee clock-ins.</p>
                                    </div>
                                ) : (
                                    <div className="relative w-full h-full bg-black">
                                        <video
                                            ref={webcamVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="w-full h-full object-cover rounded-xl"
                                        />
                                        {!isCameraReady && (
                                            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
                                                Menghubungkan kamera laptop...
                                            </div>
                                        )}
                                        {faceOverlayBox && isCameraReady && (
                                            <div
                                                className="absolute border-2 border-emerald-400 bg-emerald-400/10 rounded-md shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
                                                style={getFaceOverlayStyle() || { display: 'none' }}
                                            >
                                                <div className="absolute -top-6 left-0 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap">
                                                    {faceDetectionMode === 'yolo' ? 'YOLO FACE' : 'FACE'}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            {userProfile.role !== 'supervisor' && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                                    <span className={`px-3 py-1 rounded-full border ${isCameraReady ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50'}`}>
                                        {isCameraReady ? 'Camera Ready' : 'Camera Not Ready'}
                                    </span>
                                    <span className={`px-3 py-1 rounded-full border ${faceStatus === 'matched' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50' : faceStatus === 'error' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50'}`}>
                                        {faceStatus === 'matched'
                                            ? 'Face Verified'
                                            : faceStatus === 'error'
                                                ? 'Face Scan Error'
                                                : faceStatus === 'loading-models'
                                                    ? 'Loading Models'
                                                    : faceStatus === 'loading-reference'
                                                        ? 'Loading Registered Face'
                                                         : 'Scanning Face'}
                                    </span>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-sm font-medium text-gray-500">AI Engine:</span>
                                        {currentModelVersion === 'nano' && (
                                            <span className="px-2 py-1 text-xs font-semibold text-white bg-amber-500 rounded-full animate-pulse">
                                                📉 Adaptive Nano Model (Low-Spec Optimized)
                                            </span>
                                        )}
                                        {currentModelVersion === 'medium' && (
                                            <span className="px-2 py-1 text-xs font-semibold text-white bg-emerald-500 rounded-full">
                                                ⚡ Enterprise Medium Model (High-Performance)
                                            </span>
                                        )}
                                    </div>
                                    <span className="px-3 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700">
                                        Laptop Webcam
                                    </span>
                                    {faceMatchDistance !== null && (
                                        <span className="px-3 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700">
                                            Distance: {faceMatchDistance.toFixed(3)}
                                        </span>
                                    )}
                                    <label className="flex items-center gap-2 px-3 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700">
                                        <input type="checkbox" checked={disableYolo} onChange={(e) => setDisableYolo(e.target.checked)} />
                                        <span className="text-[10px] font-bold">Disable YOLO (use face-api only)</span>
                                    </label>
                                    <span className="px-3 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700">
                                        Source: {registeredFaceSource}
                                    </span>
                                    {clockInAt && (
                                        <span className="px-3 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50">
                                            {clockInSource === 'face-match' ? 'Auto clocked in' : 'Clocked in'} {clockInAt}
                                        </span>
                                    )}
                                </div>
                            )}
                            {userProfile.role !== 'supervisor' && faceScannerMessage && (
                                <p className="mt-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {faceScannerMessage}
                                </p>
                            )}
                            {userProfile.role !== 'supervisor' && !currentCoords && (
                                <p className="mt-2 text-xs font-medium text-red-500">Geolocation unavailable — please enable location permissions in your browser for accurate clock-ins.</p>
                            )}
                            {userProfile.role !== 'supervisor' && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handleEnrollFaceFromStream}
                                        disabled={!isCameraReady || hasStoredFace || faceStatus === 'loading-models' || faceStatus === 'loading-reference'}
                                        className="px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                                    >
                                        {hasStoredFace ? 'Reset First to Re-Register' : 'Enroll Face from Live Stream'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleResetEnrolledFace}
                                        className="px-3 py-2 text-xs font-bold rounded-xl bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-700"
                                    >
                                        Reset Enrolled Face
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRefreshEsp32Stream}
                                        className="px-3 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 border border-emerald-500 shadow-sm"
                                    >
                                        Refresh Webcam
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* INDOOR PERSONAL TIMELINE LOGS TABLE */}
                    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                            {myHistory.slice(0,12).map(record => (
                                <div key={record.id} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">{record.date}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">Record</span>
                                    </div>
                                    <div className="text-[11px] text-gray-600 dark:text-gray-400 font-mono">
                                        IN: {getRecordClockInTime(record)}
                                    </div>
                                    <div className="text-[11px] text-gray-600 dark:text-gray-400 font-mono">
                                        OUT: {record.clock_out || '--:--'}
                                    </div>
                                </div>
                            ))}
                            {myHistory.length === 0 && (
                                <div className="text-xs text-gray-500">No attendance history yet.</div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AttendanceView;