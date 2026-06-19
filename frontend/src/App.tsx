import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, StopCircle, Upload, Download, 
  TrendingUp, TrendingDown, Clock, FileText, 
  Users, AlertCircle, CheckCircle2, History,
  DollarSign, Calculator, Calendar, Search, Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { 
  validateRUT, formatRUT, formatCLP, calculateBoleta, calculateFactura, TAX_CONFIG 
} from './lib/chileanUtils';
import { cn } from './lib/utils';
import { Client, Project, WorkSession, DashboardStats, DocumentType } from './types';
import { auth, googleAuthProvider } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';

const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
};

export default function App() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);

  // State
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [selectedSessionForJson, setSelectedSessionForJson] = useState<WorkSession | null>(null);
  
  // Search Filter States
  const [clientSearch, setClientSearch] = useState('');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [stats, setStats] = useState<DashboardStats & { abcData: any[] }>({
    monthlyBilling: 0,
    accountsReceivable: 0,
    ehr: 0,
    unpaidInvoicesCount: 0,
    overduePaymentsCount: 0,
    abcData: []
  });

  // Timer State with storage/reload persistence
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(() => {
    return safeLocalStorage.getItem('timer_running') === 'true';
  });
  const [timerStart, setTimerStart] = useState<number | null>(() => {
    const saved = safeLocalStorage.getItem('timer_start');
    return saved ? parseInt(saved, 10) : null;
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    const savedStart = safeLocalStorage.getItem('timer_start');
    const isRunning = safeLocalStorage.getItem('timer_running') === 'true';
    if (isRunning && savedStart) {
      const startMs = parseInt(savedStart, 10);
      return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    }
    const savedElapsed = safeLocalStorage.getItem('timer_elapsed');
    return savedElapsed ? parseInt(savedElapsed, 10) : 0;
  });
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentType>('BOLETA');
  
  // Selected project for editing project deadline
  const [selectedProjectForDeadline, setSelectedProjectForDeadline] = useState<Project | null>(null);
  const [tempDeadline, setTempDeadline] = useState('');

  // Payment marking transition state
  const [payingProjectId, setPayingProjectId] = useState<string | null>(null);
  const [payDateVal, setPayDateVal] = useState<string>('');
  
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auth state change subscription
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const token = await currentUser.getIdToken();
        setUserToken(token);
      } else {
        setUserToken(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Initial Load & Auth Change Data Load
  useEffect(() => {
    const headers: Record<string, string> = {};
    if (userToken) {
      headers['Authorization'] = `Bearer ${userToken}`;
    }

    fetch('/api/data', { headers })
      .then(res => res.json())
      .then(data => {
        if (data.clients && data.clients.length > 0) {
          setClients(data.clients);
          const loadedProjects = data.projects || [];
          setProjects(loadedProjects);
          setSessions(data.sessions || []);
          
          // Restore active project from localStorage or auto-select first project
          const savedProjId = safeLocalStorage.getItem('active_project_id');
          const found = loadedProjects.find(p => p.id === savedProjId);
          if (found) {
            setActiveProject(found);
          } else if (loadedProjects.length > 0) {
            setActiveProject(loadedProjects[0]);
          }
        } else {
          setClients([]);
          setProjects([]);
          setSessions([]);
          setActiveProject(null);
        }
      })
      .catch(err => {
        console.error("Failed to load initial data:", err);
      });
  }, [userToken]);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (error) {
      console.error("Error signing in with Google:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setClients([]);
      setProjects([]);
      setSessions([]);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const processCSV = (csvText: string) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[];
        
        const newClients: Client[] = [];
        const newProjects: Project[] = [];
        const newSessions: WorkSession[] = [];

        data.forEach(row => {
          // Normalizar nombres de columnas y formatear RUT
          const rawRut = row.rut_cliente || row.rut || '';
          const rut = formatRUT(rawRut);
          const nombre = row.nombre_cliente || row.nombre;
          const tarifa = parseInt(row.tarifa_hora_clp || row.tarifa_clp || '30000');
          const inicio = row.fecha_inicio || row.fecha_inicio_proyecto;
          const ultima = row.fecha_ultima_sesion || row.ultima_sesion;

          let clientId = clients.find(c => c.rut === rut)?.id || newClients.find(c => c.rut === rut)?.id;
          if (!clientId) {
            clientId = uuidv4();
            newClients.push({
              id: clientId,
              rut: rut || '',
              name: nombre || 'Cliente Nuevo',
              email: `${(nombre || 'cliente').toLowerCase().replace(/ /g, '')}@example.cl`,
              defaultTariff: tarifa,
              onboardingDate: inicio ? new Date(inicio).getTime() : Date.now(),
              lastActiveDate: ultima ? new Date(ultima).getTime() : Date.now()
            });
          }

          const targetProjectName = row.proyecto_activo || ("Proyecto " + (nombre || 'Base'));
          let projectId = projects.find(p => p.clientId === clientId && p.name === targetProjectName)?.id || 
                          newProjects.find(p => p.clientId === clientId && p.name === targetProjectName)?.id;
          if (!projectId) {
            projectId = uuidv4();
            newProjects.push({
              id: projectId,
              clientId: clientId || '',
              name: targetProjectName,
              status: 'ACTIVE',
              price: parseInt(row.presupuesto_proyecto || row.precio_proyecto || '0') || 0,
              paymentStatus: 'PENDING'
            });
          }

          const hours = parseFloat(row.horas_acumuladas || row.horas || '0');
          if (hours > 0) {
            const docTypeStr = row.tipo_documento || '';
            const docType: DocumentType = docTypeStr.includes('Factura') ? 'FACTURA' : 'BOLETA';
            const bruto = Math.round(hours * tarifa);

            const taxData = docType === 'BOLETA' 
              ? calculateBoleta(bruto) 
              : calculateFactura(bruto);

            const dateStr = row.fecha_sesion || row.fecha_dia || row.fecha_ultima_sesion || Date.now();
            const dateObj = new Date(dateStr);
            const startTime = isNaN(dateObj.getTime()) ? Date.now() : dateObj.getTime();

            newSessions.push({
              id: uuidv4(),
              projectId: projectId || '',
              startTime: startTime - (hours * 3600000),
              endTime: startTime,
              durationHours: hours,
              tariffCLP: tarifa,
              documentType: docType,
              billingStatus: row.estado_pago?.includes('Vencido') || row.estado_pago?.includes('Crítico') ? 'OVERDUE' : 
                             (row.estado_pago === 'Pendiente' ? 'ISSUED' : 'PAID'),
              taxData
            });
          }
        });

        setClients(prev => [...prev, ...newClients]);
        setProjects(prev => [...prev, ...newProjects]);
        setSessions(prev => [...newSessions, ...prev]);
      }
    });
  };

  // Persist Data
  useEffect(() => {
    if (clients.length || projects.length || sessions.length) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      }
      fetch('/api/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({ clients, projects, sessions })
      });
    }
  }, [clients, projects, sessions, userToken]);

  // Update Stats
  useEffect(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Previous month dates
    const prevMonthDate = new Date();
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonth = prevMonthDate.getMonth();
    const prevMonthYear = prevMonthDate.getFullYear();

    // Calculate project-level billing
    let monthlyBilling = 0;
    let prevMonthBilling = 0;
    let accountsReceivable = 0;

    projects.forEach(p => {
      if (p.price > 0) {
        if (p.paymentStatus === 'PAID' && p.paidAt) {
          const paidDate = new Date(p.paidAt);
          if (paidDate.getMonth() === currentMonth && paidDate.getFullYear() === currentYear) {
            monthlyBilling += p.price;
          } else if (paidDate.getMonth() === prevMonth && paidDate.getFullYear() === prevMonthYear) {
            prevMonthBilling += p.price;
          }
        } else if (p.paymentStatus === 'PENDING') {
          accountsReceivable += p.price;
        }
      }
    });

    // Add sessions that are not part of priced projects, or fallbacks
    sessions.forEach(s => {
      const p = projects.find(proj => proj.id === s.projectId);
      if (!p || !p.price) {
        const d = new Date(s.endTime);
        const bruto = s.taxData.bruto;
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
          monthlyBilling += bruto;
        } else if (d.getMonth() === prevMonth && d.getFullYear() === prevMonthYear) {
          prevMonthBilling += bruto;
        }
        if (s.billingStatus === 'ISSUED' || s.billingStatus === 'OVERDUE') {
          accountsReceivable += bruto;
        }
      }
    });

    // Dynamic EHR (Tarifa Efectiva Real)
    const monthlySessions = sessions.filter(s => {
      const d = new Date(s.endTime);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const totalHours = monthlySessions.reduce((acc, s) => acc + s.durationHours, 0);

    let totalLiquidoThisMonth = 0;
    monthlySessions.forEach(s => {
      const p = projects.find(proj => proj.id === s.projectId);
      if (p && p.price > 0) {
        const projSessions = sessions.filter(ps => ps.projectId === p.id);
        const totalProjHours = projSessions.reduce((acc, ps) => acc + ps.durationHours, 0);
        if (totalProjHours > 0) {
          const brutoProject = p.price;
          const taxProject = s.documentType === 'BOLETA' 
            ? calculateBoleta(brutoProject) 
            : calculateFactura(brutoProject);
          totalLiquidoThisMonth += (s.durationHours / totalProjHours) * taxProject.liquido;
        }
      } else {
        totalLiquidoThisMonth += s.taxData.liquido;
      }
    });

    const ehr = totalHours > 0 ? Math.round(totalLiquidoThisMonth / totalHours) : 0;

    // Overdue and unpaid counts
    const overdueProjectsCount = projects.filter(p => p.paymentStatus === 'PENDING' && p.deadline && new Date(p.deadline).getTime() < now.getTime()).length;
    const unpaidProjectsCount = projects.filter(p => p.paymentStatus === 'PENDING').length;

    const overdueSessionsCount = sessions.filter(s => s.billingStatus === 'OVERDUE').length;
    const unpaidSessionsCount = sessions.filter(s => s.billingStatus === 'ISSUED' || s.billingStatus === 'OVERDUE').length;

    const overduePaymentsCount = overdueProjectsCount + overdueSessionsCount;
    const unpaidInvoicesCount = unpaidProjectsCount + unpaidSessionsCount;

    // Clasificación ABC
    const clientPerformance = clients.map(c => {
      const clientProjects = projects.filter(p => p.clientId === c.id);
      const clientSessions = sessions.filter(s => {
        const p = projects.find(proj => proj.id === s.projectId);
        return p?.clientId === c.id;
      });

      const totalPricedBruto = clientProjects.reduce((acc, p) => acc + (p.price || 0), 0);
      const totalBruto = totalPricedBruto > 0 ? totalPricedBruto : clientSessions.reduce((acc, s) => acc + s.taxData.bruto, 0);
      const totalHours = clientSessions.reduce((acc, s) => acc + s.durationHours, 0);

      let totalLiquido = 0;
      if (clientProjects.length > 0 && totalPricedBruto > 0) {
        clientProjects.forEach(p => {
          if (p.price > 0) {
            const hasFactura = clientSessions.some(s => s.documentType === 'FACTURA');
            const taxProject = hasFactura ? calculateFactura(p.price) : calculateBoleta(p.price);
            totalLiquido += taxProject.liquido;
          }
        });
      } else {
        totalLiquido = clientSessions.reduce((acc, s) => acc + s.taxData.liquido, 0);
      }

      const clientEhr = totalHours > 0 ? totalLiquido / totalHours : 0;
      const hasCriticalDebt = clientSessions.some(s => s.billingStatus === 'OVERDUE') || clientProjects.some(p => p.paymentStatus === 'PENDING' && p.deadline && new Date(p.deadline).getTime() < now.getTime());

      let category: 'A' | 'B' | 'C' = 'B';
      if (totalBruto > 2000000 || clientEhr > 40000) category = 'A';
      if (clientEhr < 25000 || hasCriticalDebt) category = 'C';

      return {
        clientId: c.id,
        name: c.name,
        totalBruto,
        clientEhr,
        category
      };
    }).sort((a, b) => b.totalBruto - a.totalBruto);

    setStats({
      monthlyBilling,
      accountsReceivable,
      ehr,
      unpaidInvoicesCount,
      overduePaymentsCount,
      abcData: clientPerformance
    });
  }, [sessions, clients, projects]);

  // Timer Logic
  const startTimer = () => {
    if (!activeProject) return alert('Selecciona un proyecto primero');
    setIsTimerRunning(true);
    setTimerStart(Date.now());
  };

  const stopTimer = () => {
    if (timerStart && activeProject) {
      const endTime = Date.now();
      const durationHours = (endTime - timerStart) / (1000 * 60 * 60);
      
      // Calculate dynamic tariff based on project price and cumulative hours
      const projectSessions = sessions.filter(s => s.projectId === activeProject.id);
      const prevHours = projectSessions.reduce((acc, s) => acc + s.durationHours, 0);
      const totalHours = prevHours + durationHours;
      
      const tariff = activeProject.price > 0 
        ? Math.round(totalHours > 0 ? (activeProject.price / totalHours) : activeProject.price)
        : 30000; // Fallback
        
      const bruto = activeProject.price > 0
        ? Math.round((durationHours / (totalHours || 1)) * activeProject.price)
        : Math.round(durationHours * tariff);
      
      const taxData = activeDocumentType === 'BOLETA' 
        ? calculateBoleta(bruto) 
        : calculateFactura(bruto);

      const newSession: WorkSession = {
        id: uuidv4(),
        projectId: activeProject.id,
        startTime: timerStart,
        endTime,
        durationHours,
        tariffCLP: tariff,
        documentType: activeDocumentType,
        billingStatus: 'PENDING',
        taxData
      };

      setSessions([newSession, ...sessions]);

      // Actualizar Fecha de Última Sesión en la tabla Clientes
      setClients(prevClients => prevClients.map(c => 
        c.id === activeProject.clientId 
          ? { ...c, lastActiveDate: endTime } 
          : c
      ));
    }
    setIsTimerRunning(false);
    setTimerStart(null);
    setElapsedSeconds(0);
  };

  // Save timer states to localStorage
  useEffect(() => {
    safeLocalStorage.setItem('timer_running', isTimerRunning ? 'true' : 'false');
    if (timerStart !== null) {
      safeLocalStorage.setItem('timer_start', timerStart.toString());
    } else {
      safeLocalStorage.removeItem('timer_start');
    }
  }, [isTimerRunning, timerStart]);

  useEffect(() => {
    safeLocalStorage.setItem('timer_elapsed', elapsedSeconds.toString());
  }, [elapsedSeconds]);

  useEffect(() => {
    if (activeProject) {
      safeLocalStorage.setItem('active_project_id', activeProject.id);
    } else {
      safeLocalStorage.removeItem('active_project_id');
    }
  }, [activeProject]);

  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        if (timerStart) {
          setElapsedSeconds(Math.max(0, Math.floor((Date.now() - timerStart) / 1000)));
        }
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isTimerRunning, timerStart]);

  const handleResetData = async () => {
    if (!window.confirm("¿Estás seguro de que deseas restablecer la aplicación y eliminar TODOS tus clientes, proyectos y registros? Esta acción no se puede deshacer y borrará permanentemente toda la base de datos de tu usuario.")) {
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      }

      const res = await fetch('/api/reset', {
        method: 'POST',
        headers
      });

      if (res.ok) {
        // Clear state locally
        setClients([]);
        setProjects([]);
        setSessions([]);
        setActiveProject(null);
        safeLocalStorage.removeItem('active_project_id');
        safeLocalStorage.removeItem('timer_running');
        safeLocalStorage.removeItem('timer_start');
        safeLocalStorage.removeItem('timer_elapsed');
        setIsTimerRunning(false);
        setTimerStart(null);
        setElapsedSeconds(0);
        
        alert("Todos los datos han sido restablecidos y eliminados con éxito.");
      } else {
        const errData = await res.json();
        alert(`Error al restablecer los datos: ${errData.error || 'Desconocido'}`);
      }
    } catch (err) {
      console.error(err);
      alert("Hubo un problema al conectar con el servidor para restablecer los datos.");
    }
  };

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar al cliente "${clientName}"? Se borrarán permanentemente todos sus proyectos y horas asociadas.`)) {
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      }

      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'DELETE',
        headers
      });

      if (res.ok) {
        setClients(prev => prev.filter(c => c.id !== clientId));
        const associatedProjects = projects.filter(p => p.clientId === clientId);
        const associatedProjIds = associatedProjects.map(p => p.id);
        setProjects(prev => prev.filter(p => p.clientId !== clientId));
        setSessions(prev => prev.filter(s => !associatedProjIds.includes(s.projectId)));
        
        if (activeProject && activeProject.clientId === clientId) {
          const remainingProjects = projects.filter(p => p.clientId !== clientId);
          if (remainingProjects.length > 0) {
            setActiveProject(remainingProjects[0]);
            safeLocalStorage.setItem('active_project_id', remainingProjects[0].id);
          } else {
            setActiveProject(null);
            safeLocalStorage.removeItem('active_project_id');
          }
        }

        alert(`El cliente "${clientName}" ha sido eliminado con éxito.`);
      } else {
        const errData = await res.json();
        alert(`Error al eliminar el cliente: ${errData.error || 'Desconocido'}`);
      }
    } catch (err) {
      console.error(err);
      alert("Hubo un problema al conectar con el servidor para eliminar al cliente.");
    }
  };

  // CSV Handling
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processCSV(text);
    };
    reader.readAsText(file);
  };

  const formatSeconds = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentCLP = (() => {
    if (!activeProject) return 0;
    const projectSessions = sessions.filter(s => s.projectId === activeProject.id);
    const prevHours = projectSessions.reduce((acc, s) => acc + s.durationHours, 0);
    const currentHours = elapsedSeconds / 3600;
    const totalHours = prevHours + currentHours;
    if (totalHours === 0) return 0;
    if (activeProject.price > 0) {
      return Math.round((currentHours / totalHours) * activeProject.price);
    }
    const client = clients.find(c => c.id === activeProject.clientId);
    return Math.round(currentHours * (client?.defaultTariff || 30000));
  })();

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans">
      {/* Simulation load specific client highlight logic */}
      <nav className="fixed top-0 w-full bg-white border-b border-[#141414]/10 h-16 flex items-center justify-between px-6 z-40 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white">
            <TrendingUp size={24} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">Freelance en Apuros</h1>
          <span className="text-xs bg-[#141414] text-white px-2 py-0.5 rounded ml-2">MVP CHILE</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right mr-4 hidden md:block">
            <p className="text-xs text-black/50 font-medium">RETENCIÓN SII 2026</p>
            <p className="font-mono font-bold">15.25%</p>
          </div>

          {user ? (
            <div className="flex items-center gap-2 bg-[#F5F5F0] pr-3 pl-2 py-1 rounded-full border border-[#141414]/10">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || "User"} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-black text-white text-[10px] font-bold flex items-center justify-center">
                  {(user.displayName || user.email || "U")[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold text-[#141414] max-w-[100px] truncate">
                {user.displayName || user.email}
              </span>
              <button 
                onClick={logout} 
                className="text-xs text-red-500 font-bold hover:text-red-700 transition-colors ml-1 cursor-pointer"
              >
                Salir
              </button>
            </div>
          ) : (
            <button 
              onClick={loginWithGoogle}
              className="flex items-center gap-2 bg-black text-white px-4 py-1.5 rounded-full text-xs font-semibold hover:bg-black/80 transition-colors cursor-pointer"
            >
              Sign In (Google)
            </button>
          )}

          <button className="flex items-center gap-2 bg-white border border-[#141414] px-4 py-2 rounded-full text-sm font-semibold hover:bg-black hover:text-white transition-colors cursor-pointer relative">
            <Upload size={16} />
            Cargar CSV
            <input type="file" accept=".csv" onChange={handleCSVUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
          </button>

          <button 
            onClick={handleResetData}
            className="flex items-center gap-2 bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-full text-sm font-semibold hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors cursor-pointer"
            title="Borrar todos los clientes, proyectos y registros"
          >
            <Trash2 size={16} />
            Restablecer Datos
          </button>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Dashboard Stats */}
        <div className="lg:col-span-8 space-y-8">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
              label="Facturación Mes" 
              value={formatCLP(stats.monthlyBilling)} 
              icon={<DollarSign className="text-emerald-500" />}
              trend="+12% vs mes anterior"
              color="emerald"
            />
            <StatCard 
              label="Cuentas por Cobrar" 
              value={formatCLP(stats.accountsReceivable)} 
              icon={<AlertCircle className={cn(stats.accountsReceivable > 0 ? "text-rose-500" : "text-emerald-500")} />}
              trend={stats.accountsReceivable > 0 ? `${stats.overduePaymentsCount} facturas vencidas` : "Todo al día"}
              color={stats.accountsReceivable > 0 ? "rose" : "emerald"}
            />
            <StatCard 
              label="Tarifa Efectiva (EHR)" 
              value={`${formatCLP(stats.ehr)}/hr`} 
              icon={<Calculator className="text-blue-500" />}
              trend={`Meta: ${formatCLP(35000)}/hr`}
              color="blue"
            />
          </section>

          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between bg-rose-50/30">
              <h3 className="font-bold flex items-center gap-2 text-rose-800">
                <AlertCircle size={18} /> Alertas de Riesgo Financiero
              </h3>
            </div>
            <div className="p-6 space-y-4">
              {stats.overduePaymentsCount > 0 && (
                <div className="flex items-center gap-4 p-4 bg-rose-100/50 border border-rose-200 rounded-xl relative overflow-hidden group">
                   <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                     <AlertCircle size={48} />
                   </div>
                   <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-lg shadow-rose-500/20">
                     <TrendingDown size={24} />
                   </div>
                   <div>
                     <p className="font-bold text-rose-900">Fuga de Capital Detectada</p>
                     <p className="text-sm text-rose-700">Tienes {stats.overduePaymentsCount} deudas críticas que representan {formatCLP(stats.accountsReceivable)}. Recomendamos activar cobranza inmediata para Nexus Corp y Aura Ventures.</p>
                   </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                  <p className="text-[10px] font-bold text-blue-900 uppercase tracking-widest mb-1">Impacto Tributario</p>
                  <p className="text-xl font-bold text-blue-800">{formatCLP(sessions.reduce((acc, s) => acc + (s.taxData.retencion || 0) + (s.taxData.iva || 0), 0))}</p>
                  <p className="text-[10px] text-blue-600 font-medium">Acumulado en Impuestos (Retención + IVA)</p>
                </div>
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-900 uppercase tracking-widest mb-1">Salud del EHR</p>
                  <p className={cn("text-xl font-bold", stats.ehr > 35000 ? "text-emerald-800" : "text-amber-800")}>
                    {formatCLP(stats.ehr)}/h
                  </p>
                  <p className="text-[10px] text-emerald-600 font-medium">
                    {stats.ehr > 35000 ? "Superas el benchmark del mercado." : "Debes ajustar tarifas para cubrir costos operativos."}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Analizador de Rentabilidad ABC */}
          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between bg-[#F9F9F7]">
              <h3 className="font-bold flex items-center gap-2">
                <TrendingUp size={18} className="text-black/50" /> Analizador de Rentabilidad (ABC)
              </h3>
              <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded font-mono uppercase">Optimización de Cartera</span>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              {['A', 'B', 'C'].map((cat) => {
                const count = stats.abcData.filter(c => c.category === cat).length;
                const catStyles = {
                  A: 'border-emerald-200 bg-emerald-50 text-emerald-700',
                  B: 'border-blue-200 bg-blue-50 text-blue-700',
                  C: 'border-rose-200 bg-rose-50 text-rose-700'
                };
                return (
                  <div key={cat} className={cn("p-4 rounded-xl border flex flex-col items-center", catStyles[cat as 'A'|'B'|'C'])}>
                    <span className="text-2xl font-black mb-1">{cat}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Categoría {cat}</span>
                    <span className="text-xl font-bold mt-2">{count}</span>
                    <span className="text-[9px] mt-1 text-center font-medium">
                      {cat === 'A' ? 'Top Facturación/EHR' : cat === 'B' ? 'Estabilidad Operativa' : 'Baja Renta/Morosidad'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sección Clientes: Trazabilidad Temporal */}
          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F9F9F7]">
              <h3 className="font-bold flex items-center gap-2">
                <Users size={18} className="text-black/50" /> Cartera de Clientes / Trazabilidad
              </h3>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                <input 
                  type="text"
                  placeholder="Filtrar por cliente..."
                  className="bg-white border border-[#141414]/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black transition-all w-full sm:w-48 text-black"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F9F9F7] text-[11px] uppercase tracking-wider text-black/50 font-bold border-b border-[#141414]/10">
                    <th className="px-6 py-3">RUT</th>
                    <th className="px-6 py-3">Nombre</th>
                    <th className="px-6 py-3">Inicio Contrato</th>
                    <th className="px-6 py-3">Última Actividad</th>
                    <th className="px-6 py-3">Estado Focal</th>
                    <th className="px-6 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-[#141414]/5">
                  {clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).map((c) => {
                    const daysSinceLastActive = c.lastActiveDate 
                      ? Math.floor((Date.now() - c.lastActiveDate) / (1000 * 60 * 60 * 24)) 
                      : null;
                    const isFuga = daysSinceLastActive !== null && daysSinceLastActive > 30;
                    
                    const clientProjects = projects.filter(p => p.clientId === c.id);
                    const abcInfo = stats.abcData.find(item => item.clientId === c.id);
                    const category = abcInfo?.category || 'B';
                    
                    const colorClasses = {
                      A: 'text-emerald-600',
                      B: 'text-blue-600',
                      C: 'text-rose-500'
                    };
                    const activeColorClass = colorClasses[category as 'A' | 'B' | 'C'];

                    return (
                      <tr 
                        key={c.id} 
                        className="hover:bg-[#F9F9F7] transition-colors"
                      >
                        <td className="px-6 py-4 font-mono text-xs text-black/50">{c.rut}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className={cn("font-bold text-sm", activeColorClass)}>{c.name}</span>
                            {clientProjects.length > 0 ? (
                              <div className="mt-1.5 flex flex-col gap-1">
                                {clientProjects.map((p) => (
                                  <div 
                                    key={p.id} 
                                    className="group flex items-center gap-1.5 cursor-pointer max-w-fit"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedProjectForDeadline(p);
                                      setTempDeadline(p.deadline || '');
                                    }}
                                    title="Haga clic para cambiar fecha límite"
                                  >
                                    <span className={cn("text-xs font-semibold py-0.5 px-2 rounded-md bg-black/5 hover:bg-black/10 group-hover:bg-black/15 transition-all text-left", activeColorClass)}>
                                      📂 {p.name} {p.deadline ? `(Límite: ${format(new Date(p.deadline), 'dd/MM/yyyy')})` : '(Sin fecha límite)'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-black/30 italic">Sin proyectos</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-black/60">
                           {c.onboardingDate ? format(c.onboardingDate, 'dd/MM/yyyy') : 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-medium">{c.lastActiveDate ? format(c.lastActiveDate, 'dd/MM/yyyy') : 'Nunca'}</span>
                            {daysSinceLastActive !== null && (
                              <span className={cn(
                                "text-[10px] font-bold",
                                isFuga ? "text-rose-500" : "text-black/40"
                              )}>
                                {daysSinceLastActive === 0 ? 'Hoy' : `Hace ${daysSinceLastActive} días`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {isFuga ? (
                              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse">
                                POSIBLE FUGA
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                ACTIVO
                              </span>
                            )}
                            <span className={cn(
                              "text-[10px] font-extrabold px-1.5 py-0.5 rounded-md border",
                              category === 'A' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                              category === 'B' ? "bg-blue-50 border-blue-200 text-blue-700" :
                              "bg-rose-50 border-rose-200 text-rose-700"
                            )}>
                              {category}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => handleDeleteClient(c.id, c.name)}
                            className="p-1 px-2.5 rounded-md text-red-600 hover:bg-red-50 hover:text-red-800 transition-colors cursor-pointer text-xs font-semibold inline-flex items-center gap-1"
                            title={`Eliminar cliente ${c.name}`}
                          >
                            <Trash2 size={13} />
                            <span>Eliminar</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-black/40 italic">
                        {clients.length === 0 ? "No hay clientes registrados todavía." : "No se encontraron clientes con ese nombre."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Panel de Control de Pagos de Proyectos */}
          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--color-emerald-50)]/20">
              <div className="flex items-center gap-2">
                <h3 className="font-bold flex items-center gap-2 text-emerald-800">
                  <DollarSign size={18} /> Control de Pagos de Proyectos
                </h3>
                <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded font-mono uppercase">Finanzas</span>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                <input 
                  type="text"
                  placeholder="Filtrar por cliente..."
                  className="bg-white border border-[#141414]/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black transition-all w-full sm:w-48 text-black"
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="p-6 space-y-4">
              {projects.length === 0 ? (
                <p className="text-xs text-center text-black/40 italic">No hay proyectos registrados aún.</p>
              ) : (
                <div className="space-y-3">
                  {projects
                    .filter(p => {
                      const client = clients.find(c => c.id === p.clientId);
                      return !paymentSearch || (client && client.name.toLowerCase().includes(paymentSearch.toLowerCase()));
                    })
                    .map(p => {
                      const client = clients.find(c => c.id === p.clientId);
                      return (
                        <div key={p.id} className="p-3 bg-[#F9F9F7] rounded-xl border border-[#141414]/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#141414]">{p.name}</span>
                              <span className="text-xs text-black/50">({client?.name || 'Cliente'})</span>
                            </div>
                            <div className="text-xs text-black/60 flex items-center gap-3 mt-1">
                              <span>Presupuesto: <strong className="text-black">{formatCLP(p.price || 0)}</strong></span>
                              {p.deadline && (
                                <span>Fecha Límite: <strong className="text-rose-600 font-semibold">{format(new Date(p.deadline), 'dd/MM/yyyy')}</strong></span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {p.paymentStatus === 'PAID' ? (
                              <div className="flex flex-col items-end">
                                <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1">
                                  <CheckCircle2 size={12} /> Pagado
                                </span>
                                <span className="text-[10px] text-black/40 font-mono mt-0.5">
                                  {p.paidAt ? format(p.paidAt, 'dd/MM/yyyy') : 'Sin fecha'}
                                </span>
                              </div>
                            ) : payingProjectId === p.id ? (
                              <div className="flex items-center gap-1.5 bg-black/5 p-1 rounded-lg border border-[#141414]/10">
                                <span className="text-[10px] font-medium text-black/60 pl-1">Fecha:</span>
                                <input 
                                  type="date"
                                  value={payDateVal}
                                  onChange={(e) => setPayDateVal(e.target.value)}
                                  className="bg-white border border-[#141414]/10 rounded px-1.5 py-1 text-xs text-black focus:outline-none focus:ring-1 focus:ring-black w-[130px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parts = payDateVal.split('-');
                                    let paidTimestamp = Date.now();
                                    if (parts.length === 3) {
                                      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
                                      if (!isNaN(d.getTime())) {
                                        paidTimestamp = d.getTime();
                                      }
                                    }
                                    setProjects(prevProjects => prevProjects.map(proj => 
                                      proj.id === p.id 
                                        ? { ...proj, paymentStatus: 'PAID', paidAt: paidTimestamp } 
                                        : proj
                                    ));
                                    setPayingProjectId(null);
                                    setPayDateVal('');
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer"
                                  title="Confirmar pago"
                                >
                                  Listo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayingProjectId(null);
                                    setPayDateVal('');
                                  }}
                                  className="bg-black/10 hover:bg-black/20 text-black/70 px-2 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer"
                                  title="Cancelar"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button 
                                type="button"
                                onClick={() => {
                                  setPayingProjectId(p.id);
                                  setPayDateVal(format(new Date(), 'yyyy-MM-dd'));
                                }}
                                className="bg-black hover:bg-black/85 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                              >
                                Marcar Pagado
                              </button>
                            )}
                            {p.paymentStatus === 'PAID' && (
                              <button 
                                type="button"
                                onClick={() => {
                                  if (confirm('¿Restaurar a Pendiente de Pago?')) {
                                    setProjects(prevProjects => prevProjects.map(proj => 
                                      proj.id === p.id 
                                        ? { ...proj, paymentStatus: 'PENDING', paidAt: undefined } 
                                        : proj
                                    ));
                                  }
                                }}
                                className="text-black/30 hover:text-black/60 p-1 text-xs font-bold"
                                title="Volver a Pendiente"
                              >
                                ↩
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {projects.filter(p => {
                    const client = clients.find(c => c.id === p.clientId);
                    return !paymentSearch || (client && client.name.toLowerCase().includes(paymentSearch.toLowerCase()));
                  }).length === 0 && (
                    <p className="text-xs text-center text-black/40 italic py-4">No se encontraron proyectos correspondientes a ese cliente.</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Historial Detallado de Sesiones */}
          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F9F9F7]/10">
              <div className="flex items-center gap-2">
                <History size={18} className="text-black/50" />
                <h3 className="font-bold">Historial de Sesiones (SQL Sim)</h3>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
                <input 
                  type="text"
                  placeholder="Filtrar por cliente..."
                  className="bg-white border border-[#141414]/10 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-black transition-all w-full sm:w-48 text-black"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F9F9F7] text-[11px] uppercase tracking-wider text-black/50 font-bold border-b border-[#141414]/10">
                    <th className="px-6 py-3">Cliente</th>
                    <th className="px-6 py-3">Fecha</th>
                    <th className="px-6 py-3">Duración</th>
                    <th className="px-6 py-3">Ganancia Bruta</th>
                    <th className="px-6 py-3">Monto Líquido</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-[#141414]/5">
                  {sessions.filter((s) => {
                    const client = clients.find(c => projects.find(p => p.id === s.projectId)?.clientId === c.id);
                    return !sessionSearch || (client && client.name.toLowerCase().includes(sessionSearch.toLowerCase()));
                  }).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-black/40 italic">
                        {sessions.length === 0 ? "No hay registros en el historial." : "No se encontraron sesiones para este cliente."}
                      </td>
                    </tr>
                  )}
                  {sessions
                    .filter((s) => {
                      const client = clients.find(c => projects.find(p => p.id === s.projectId)?.clientId === c.id);
                      return !sessionSearch || (client && client.name.toLowerCase().includes(sessionSearch.toLowerCase()));
                    })
                    .slice(0, 10)
                    .map((s) => {
                      const client = clients.find(c => projects.find(p => p.id === s.projectId)?.clientId === c.id);
                      return (
                        <tr key={s.id} className="hover:bg-[#F9F9F7] transition-colors">
                          <td className="px-6 py-4 font-bold">{client?.name || 'Cliente'}</td>
                          <td className="px-6 py-4 fill-black/60">{format(s.endTime, 'dd/MM/yyyy HH:mm')}</td>
                          <td className="px-6 py-4 font-mono">{s.durationHours.toFixed(2)}h</td>
                          <td className="px-6 py-4 font-bold">{formatCLP(s.taxData.bruto)}</td>
                          <td className="px-6 py-4 text-emerald-600 font-bold">{formatCLP(s.taxData.liquido)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Sidebar: Timer & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-[#141414] text-white rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <span className="flex items-center gap-2 text-white/50 text-xs font-bold tracking-widest uppercase">
                  <Clock size={14} /> Tracker en Vivo
                </span>
                {isTimerRunning && <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>}
              </div>

              <div className="text-center mb-8">
                <div className="text-5xl font-mono font-bold tracking-tighter mb-2">
                  {formatSeconds(elapsedSeconds)}
                </div>
                <div className="text-emerald-400 font-bold text-lg">
                  {formatCLP(currentCLP)} <span className="text-xs text-white/30 uppercase">Acumulado</span>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-1 block">Proyecto Activo</label>
                  <select 
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/50 transition-all text-white"
                    value={activeProject?.id || ''}
                    onChange={(e) => setActiveProject(projects.find(p => p.id === e.target.value) || null)}
                    disabled={isTimerRunning}
                  >
                    <option value="" className="text-black">Selecciona un proyecto...</option>
                    {projects.map(p => {
                      const client = clients.find(c => c.id === p.clientId);
                      return (
                        <option key={p.id} value={p.id} className="text-black">
                          {p.name} ({client?.name || 'Empresa'})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => setActiveDocumentType('BOLETA')}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                      activeDocumentType === 'BOLETA' ? "bg-white text-black border-white" : "border-white/20 text-white/50 hover:bg-white/5"
                    )}
                  >
                    BOLETA HONORARIOS
                  </button>
                  <button 
                    onClick={() => setActiveDocumentType('FACTURA')}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                      activeDocumentType === 'FACTURA' ? "bg-white text-black border-white" : "border-white/20 text-white/50 hover:bg-white/5"
                    )}
                  >
                    FACTURA AFECTA
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                {!isTimerRunning ? (
                  <button 
                    onClick={startTimer}
                    className="flex-1 bg-white text-black py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    <Play size={20} fill="currentColor" /> INICIAR SESIÓN
                  </button>
                ) : (
                  <button 
                    onClick={stopTimer}
                    className="flex-1 bg-rose-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-rose-600 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    <StopCircle size={20} fill="currentColor" /> DETENER Y GUARDAR
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Client Add */}
          <div className="bg-white rounded-2xl p-6 border border-[#141414]/10 shadow-sm">
            <h3 className="font-bold flex items-center gap-2 mb-4">
              <Users size={18} className="text-black/50" /> Nuevo Cliente / Proyecto
            </h3>
            <NewClientForm 
              clients={clients}
              onAdd={(client, project) => {
                if (client) {
                  setClients(prev => [...prev, client]);
                }
                setProjects(prev => [...prev, project]);
                setActiveProject(project);
              }} 
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
            <h4 className="text-blue-900 font-bold text-sm mb-2 flex items-center gap-2">
              <Calculator size={16} /> Calculadora SII Express
            </h4>
            <CalculadoraSII />
          </div>
        </div>
      </main>

      {/* Boleta JSON Modal */}
      <AnimatePresence>
        {selectedSessionForJson && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSessionForJson(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col relative z-10 shadow-2xl border border-[#141414]/10"
            >
              <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between bg-[#F9F9F7]">
                <div>
                  <h3 className="font-bold text-lg">Simulación Boleta Honorarios SII</h3>
                  <p className="text-xs text-black/50 font-mono">ID: {selectedSessionForJson.id}</p>
                </div>
                <button 
                  onClick={() => setSelectedSessionForJson(null)}
                  className="p-2 hover:bg-black/5 rounded-full"
                >
                  <AlertCircle className="rotate-45" size={20} />
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                <div className="flex items-start gap-4 mb-6 bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <Calculator size={24} className="text-blue-600 mt-1" />
                  <div className="text-xs text-blue-900 leading-relaxed">
                    <p className="font-bold mb-1 underline">Nota de Cumplimiento (Chile):</p>
                    Para 2026, la retención es del 15.25%. Esta simulación genera el objeto JSON que se enviaría vía API al SII o se usaría para registrar el gasto en el libro de honorarios.
                  </div>
                </div>
                <pre className="bg-[#141414] text-emerald-400 p-6 rounded-xl overflow-x-auto text-[11px] font-mono leading-relaxed shadow-inner">
                  {JSON.stringify({
                    "emisor": {
                      "nombre": "Lucía Freelante",
                      "rut": "15.XXX.XXX-X",
                      "profesion": "Diseñadora Independiente"
                    },
                    "receptor": {
                      "rut": clients.find(c => projects.find(p => p.id === selectedSessionForJson.projectId)?.clientId === c.id)?.rut || "SIN-RUT",
                      "nombre": clients.find(c => projects.find(p => p.id === selectedSessionForJson.projectId)?.clientId === c.id)?.name || "CLIENTE EXTERNO"
                    },
                      "documento": {
                        "tipo": selectedSessionForJson.documentType,
                        "version": "2026.1",
                        "fecha_emision": (() => {
                          try {
                            return format(selectedSessionForJson.endTime, 'yyyy-MM-dd');
                          } catch (e) {
                            return 'N/A';
                          }
                        })(),
                        "glosa": `Servicios Profesionales de Diseño - Proyecto ${projects.find(p => p.id === selectedSessionForJson.projectId)?.name}`,
                      "montos": {
                        "moneda": "CLP",
                        "valor_bruto": selectedSessionForJson.taxData.bruto,
                        "retencion_tasa": "15.25%",
                        "retencion_monto": selectedSessionForJson.taxData.retencion || 0,
                        "valor_liquido": selectedSessionForJson.taxData.liquido
                      }
                    },
                    "metadatos": {
                      "ehr_calculado": (selectedSessionForJson.taxData.liquido / selectedSessionForJson.durationHours).toFixed(0),
                      "horas_registradas": selectedSessionForJson.durationHours.toFixed(2)
                    }
                  }, null, 2)}
                </pre>
              </div>
              <div className="px-6 py-4 border-t border-[#141414]/10 bg-[#F9F9F7] flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedSessionForJson(null)}
                  className="px-6 py-2 rounded-full text-sm font-bold border border-[#141414]/20 hover:bg-black/5"
                >
                  Cerrar
                </button>
                <button 
                  className="px-6 py-2 rounded-full text-sm font-bold bg-black text-white hover:bg-black/80 flex items-center gap-2"
                  onClick={() => alert('Simulando envío al SII... Documento emitido con éxito.')}
                >
                  <CheckCircle2 size={16} /> Emitir en SII
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedProjectForDeadline && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProjectForDeadline(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col relative z-10 shadow-2xl border border-[#141414]/10"
            >
              <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between bg-[#F9F9F7]">
                <div>
                  <h3 className="font-bold text-lg text-black">Modificar Fecha Límite</h3>
                  <p className="text-xs text-black/50 font-mono">Proyecto: {selectedProjectForDeadline.name}</p>
                </div>
                <button 
                  onClick={() => setSelectedProjectForDeadline(null)}
                  className="p-2 hover:bg-black/5 rounded-full"
                >
                  <AlertCircle className="rotate-45 text-black" size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Nueva Fecha Límite de Entrega</label>
                  <input 
                    type="date"
                    className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                    value={tempDeadline}
                    onChange={(e) => setTempDeadline(e.target.value)}
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-[#141414]/10 bg-[#F9F9F7] flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedProjectForDeadline(null)}
                  className="px-6 py-2 rounded-full text-sm font-bold border border-[#141414]/20 hover:bg-black/5 text-black"
                >
                  Cancelar
                </button>
                <button 
                  className="px-6 py-2 rounded-full text-sm font-bold bg-black text-white hover:bg-black/80 flex items-center gap-2"
                  onClick={() => {
                    setProjects(prevProjects => prevProjects.map(proj => 
                      proj.id === selectedProjectForDeadline.id 
                        ? { ...proj, deadline: tempDeadline || undefined } 
                        : proj
                    ));
                    setSelectedProjectForDeadline(null);
                  }}
                >
                  <CheckCircle2 size={16} /> Guardar Cambios
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ label, value, icon, trend, color }: { label: string, value: string, icon: React.ReactNode, trend: string, color: 'emerald' | 'rose' | 'blue' }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("p-6 rounded-2xl border bg-white shadow-sm", colors[color])}
    >
      <div className="flex justify-between items-start mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-black/40">{label}</span>
        <div className="p-2 bg-white rounded-lg shadow-inner">
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight mb-2 text-black">{value}</div>
      <div className="text-[10px] font-bold flex items-center gap-1 opacity-70">
        {trend}
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: 'PENDING' | 'ISSUED' | 'PAID' | 'OVERDUE' }) {
  const styles = {
    PENDING: 'bg-gray-100 text-gray-600',
    ISSUED: 'bg-blue-100 text-blue-600',
    PAID: 'bg-emerald-100 text-emerald-600',
    OVERDUE: 'bg-rose-100 text-rose-600 border border-rose-200 animate-pulse',
  };
  
  const labels = {
    PENDING: 'Pendiente',
    ISSUED: 'Emitida',
    PAID: 'Pagado',
    OVERDUE: 'Vencido',
  };

  return (
    <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", styles[status])}>
      {labels[status]}
    </span>
  );
}

function NewClientForm({ clients, onAdd }: { clients: Client[], onAdd: (c: Client | null, p: Project) => void }) {
  const [mode, setMode] = useState<'NEW' | 'EXISTING'>('NEW');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [rut, setRut] = useState('');
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectPrice, setProjectPrice] = useState('500000');
  const [onboardingDate, setOnboardingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [deadline, setDeadline] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let clientId = '';
    let clientToPass: Client | null = null;
    
    if (mode === 'NEW') {
      if (!validateRUT(rut)) return alert('RUT Chileno no válido (incluye DV)');
      clientId = uuidv4();
      clientToPass = {
        id: clientId,
        rut,
        name,
        email: `${name.toLowerCase().replace(/ /g, '')}@example.cl`,
        defaultTariff: 0,
        onboardingDate: new Date(onboardingDate).getTime(),
        lastActiveDate: new Date(onboardingDate).getTime()
      };
    } else {
      if (!selectedClientId) {
        if (clients.length > 0) {
          clientId = clients[0].id;
        } else {
          return alert('Por favor, registra un cliente primero.');
        }
      } else {
        clientId = selectedClientId;
      }
    }

    const newProject: Project = {
      id: uuidv4(),
      clientId,
      name: projectName || `Consultoría ${mode === 'NEW' ? name : (clients.find(c => c.id === clientId)?.name || 'Cliente')}`,
      status: 'ACTIVE',
      price: parseInt(projectPrice) || 0,
      deadline: deadline || undefined,
      paymentStatus: 'PENDING'
    };

    onAdd(clientToPass, newProject);
    
    // Reset fields
    setRut('');
    setName('');
    setProjectName('');
    setProjectPrice('500000');
    setDeadline('');
  };

  return (
    <div className="space-y-4">
      <div className="flex bg-[#F9F9F7] p-1 rounded-xl border border-[#141414]/5">
        <button 
          type="button"
          onClick={() => setMode('NEW')}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer",
            mode === 'NEW' ? "bg-black text-white shadow-sm" : "text-[#141414]/60 hover:text-black"
          )}
        >
          NUEVO CLIENTE
        </button>
        <button 
          type="button"
          onClick={() => {
            setMode('EXISTING');
            if (clients.length > 0 && !selectedClientId) {
              setSelectedClientId(clients[0].id);
            }
          }}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer",
            mode === 'EXISTING' ? "bg-black text-white shadow-sm" : "text-[#141414]/60 hover:text-black"
          )}
        >
          OTRO PROYECTO CLIENTE
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'NEW' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">RUT Cliente</label>
                <input 
                  type="text" 
                  placeholder="12.345.678-9 o 76.123.456-K"
                  className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                  value={rut}
                  onChange={(e) => setRut(formatRUT(e.target.value))}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Precio Proyecto (CLP)</label>
                <input 
                  type="number" 
                  className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                  value={projectPrice}
                  onChange={(e) => setProjectPrice(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Nombre Cliente / Razón Social</label>
              <input 
                type="text" 
                placeholder="Ej: Tech Chile SpA"
                className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Seleccionar Cliente Existente</label>
              <select
                className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                required
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id} className="text-black">
                    {c.name} ({c.rut})
                  </option>
                ))}
                {clients.length === 0 && (
                  <option value="" className="text-black">No hay clientes registrados aún</option>
                )}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Precio Proyecto (CLP)</label>
              <input 
                type="number" 
                className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
                value={projectPrice}
                onChange={(e) => setProjectPrice(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Nombre del Proyecto</label>
          <input 
            type="text" 
            placeholder="Ej: Identidad Corporativa o Rediseño Web"
            className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Inicio Proyecto</label>
            <input 
              type="date" 
              className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
              value={onboardingDate}
              onChange={(e) => setOnboardingDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Fecha Límite Entrega</label>
            <input 
              type="date" 
              className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all text-black"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>
        <button 
          type="submit"
          className="w-full bg-black text-white py-3 rounded-xl font-bold text-sm tracking-tight hover:bg-black/90 transition-colors cursor-pointer"
        >
          {mode === 'NEW' ? 'REGISTRAR CLIENTE Y PROYECTO' : 'REGISTRAR NUEVO PROYECTO'}
        </button>
      </form>
    </div>
  );
}

function CalculadoraSII() {
  const [amount, setAmount] = useState<number>(100000);
  const [isBruto, setIsBruto] = useState(true);

  const res = calculateBoleta(amount, isBruto);

  return (
    <div className="space-y-4">
      <div className="flex bg-blue-100/50 p-1 rounded-lg">
        <button 
          onClick={() => setIsBruto(true)}
          className={cn("flex-1 py-1 rounded text-[10px] font-bold", isBruto ? "bg-white text-blue-900 shadow-sm" : "text-blue-700")}
        >
          SOBRE BRUTO
        </button>
        <button 
          onClick={() => setIsBruto(false)}
          className={cn("flex-1 py-1 rounded text-[10px] font-bold", !isBruto ? "bg-white text-blue-900 shadow-sm" : "text-blue-700")}
        >
          SOBRE LÍQUIDO
        </button>
      </div>
      <input 
        type="number" 
        value={amount}
        onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
        className="w-full bg-transparent border-b border-blue-300 text-blue-900 font-bold focus:outline-none py-1"
      />
      <div className="grid grid-cols-2 gap-4 text-[10px] font-bold uppercase tracking-widest bg-white p-3 rounded-xl shadow-sm border border-blue-100">
        <div>
          <p className="text-black/40">Bruto</p>
          <p className="text-sm text-black">{formatCLP(res.bruto)}</p>
        </div>
        <div>
          <p className="text-black/40">Retención (15.25%)</p>
          <p className="text-sm text-rose-600">-{formatCLP(res.retencion || 0)}</p>
        </div>
        <div className="col-span-2 pt-2 border-t border-blue-50">
          <p className="text-emerald-700">Ingreso Líquido Real</p>
          <p className="text-lg text-emerald-600">{formatCLP(res.liquido)}</p>
        </div>
      </div>
    </div>
  );
}
