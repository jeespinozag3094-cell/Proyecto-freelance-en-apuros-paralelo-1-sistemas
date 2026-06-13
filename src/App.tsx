import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, StopCircle, Upload, Download, 
  TrendingUp, TrendingDown, Clock, FileText, 
  Users, AlertCircle, CheckCircle2, History,
  DollarSign, Calculator, Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { format, differenceInSeconds } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { 
  validateRUT, formatRUT, formatCLP, calculateBoleta, calculateFactura, TAX_CONFIG 
} from './lib/chileanUtils';
import { cn } from './lib/utils';
import { Client, Project, WorkSession, DashboardStats, DocumentType } from './types';

export default function App() {
  // State
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [selectedSessionForJson, setSelectedSessionForJson] = useState<WorkSession | null>(null);
  const [stats, setStats] = useState<DashboardStats & { abcData: any[] }>({
    monthlyBilling: 0,
    accountsReceivable: 0,
    ehr: 0,
    unpaidInvoicesCount: 0,
    overduePaymentsCount: 0,
    abcData: []
  });

  // Timer State
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeDocumentType, setActiveDocumentType] = useState<DocumentType>('BOLETA');
  
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initial Load
  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(data => {
        if (data.clients.length > 0) setClients(data.clients);
        if (data.projects.length > 0) setProjects(data.projects);
        if (data.sessions.length > 0) setSessions(data.sessions);
        else {
          // Si no hay datos, cargar los clientes por defecto del prompt maestro
          const defaultClients: Client[] = [
            {
              id: uuidv4(),
              rut: '76.432.110-K',
              name: 'TechAlpha',
              email: 'techalpha@example.cl',
              defaultTariff: 45000,
              onboardingDate: new Date('2025-01-10').getTime(),
              lastActiveDate: new Date('2025-01-10').getTime()
            },
            {
              id: uuidv4(),
              rut: '15.882.334-5',
              name: 'Aura Ventures',
              email: 'auraventures@example.cl',
              defaultTariff: 35000,
              onboardingDate: new Date('2025-11-20').getTime(),
              lastActiveDate: new Date('2025-11-20').getTime()
            }
          ];
          
          setClients(defaultClients);
          
          const defaultProjects: Project[] = defaultClients.map(c => ({
            id: uuidv4(),
            clientId: c.id,
            name: `Proyecto Base ${c.name}`,
            status: 'ACTIVE'
          }));
          
          setProjects(defaultProjects);
        }
      });
  }, []);

  const loadDefaultCSV = () => {
    fetch('/datos_lucia.csv')
      .then(res => res.text())
      .then(csvText => {
        processCSV(csvText);
      });
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
          // Normalizar nombres de columnas
          const rut = row.rut_cliente || row.rut;
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

          let projectId = projects.find(p => p.clientId === clientId)?.id || newProjects.find(p => p.clientId === clientId)?.id;
          if (!projectId) {
            projectId = uuidv4();
            newProjects.push({
              id: projectId,
              clientId: clientId || '',
              name: row.proyecto_activo || ("Proyecto " + (nombre || 'Base')),
              status: 'ACTIVE'
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
      fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clients, projects, sessions })
      });
    }
  }, [clients, projects, sessions]);

  // Update Stats
  useEffect(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthlySessions = sessions.filter(s => {
      const d = new Date(s.endTime);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const monthlyBilling = monthlySessions.reduce((acc, s) => acc + s.taxData.bruto, 0);
    const accountsReceivable = sessions
      .filter(s => s.billingStatus === 'ISSUED' || s.billingStatus === 'OVERDUE')
      .reduce((acc, s) => acc + s.taxData.bruto, 0);

    const totalHours = monthlySessions.reduce((acc, s) => acc + s.durationHours, 0);
    const ehr = totalHours > 0 ? Math.round(monthlySessions.reduce((acc, s) => acc + s.taxData.liquido, 0) / totalHours) : 0;

    const overduePaymentsCount = sessions.filter(s => s.billingStatus === 'OVERDUE').length;
    const unpaidInvoicesCount = sessions.filter(s => s.billingStatus === 'ISSUED' || s.billingStatus === 'OVERDUE').length;

    // Clasificación ABC
    const clientPerformance = clients.map(c => {
      const clientSessions = sessions.filter(s => {
        const p = projects.find(proj => proj.id === s.projectId);
        return p?.clientId === c.id;
      });
      const totalBruto = clientSessions.reduce((acc, s) => acc + s.taxData.bruto, 0);
      const totalLiquido = clientSessions.reduce((acc, s) => acc + s.taxData.liquido, 0);
      const totalHours = clientSessions.reduce((acc, s) => acc + s.durationHours, 0);
      const clientEhr = totalHours > 0 ? totalLiquido / totalHours : 0;
      const hasCriticalDebt = clientSessions.some(s => s.billingStatus === 'OVERDUE');

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
      const client = clients.find(c => c.id === activeProject.clientId);
      const tariff = client?.defaultTariff || 30000;
      const bruto = Math.round(durationHours * tariff);
      
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

  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        if (timerStart) {
          setElapsedSeconds(differenceInSeconds(Date.now(), timerStart));
        }
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isTimerRunning, timerStart]);

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

  const currentCLP = activeProject ? calculateBoleta((elapsedSeconds / 3600) * (clients.find(c => c.id === activeProject.clientId)?.defaultTariff || 30000)).bruto : 0;

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
          <button className="flex items-center gap-2 bg-white border border-[#141414] px-4 py-2 rounded-full text-sm font-semibold hover:bg-black hover:text-white transition-colors cursor-pointer relative">
            <Upload size={16} />
            Cargar CSV
            <input type="file" accept=".csv" onChange={handleCSVUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
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
            <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between bg-[#F9F9F7]">
              <h3 className="font-bold flex items-center gap-2">
                <Users size={18} className="text-black/50" /> Cartera de Clientes / Trazabilidad
              </h3>
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
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-[#141414]/5">
                  {clients.map((c) => {
                    const daysSinceLastActive = c.lastActiveDate 
                      ? Math.floor((Date.now() - c.lastActiveDate) / (1000 * 60 * 60 * 24)) 
                      : null;
                    const isFuga = daysSinceLastActive !== null && daysSinceLastActive > 30;
                    
                    return (
                      <tr key={c.id} className="hover:bg-[#F9F9F7] transition-colors">
                        <td className="px-6 py-4 font-mono text-xs">{c.rut}</td>
                        <td className="px-6 py-4 font-bold">{c.name}</td>
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
                          {isFuga ? (
                            <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse">
                              POSIBLE FUGA
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              ACTIVO
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Historial Detallado de Sesiones */}
          <section className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-[#141414]/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History size={18} className="text-black/50" />
                <h3 className="font-bold">Historial de Sesiones (SQL Sim)</h3>
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
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-black/40 italic">No hay registros en el historial.</td>
                    </tr>
                  )}
                  {sessions.slice(0, 10).map((s) => {
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
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/50 transition-all"
                    value={activeProject?.id || ''}
                    onChange={(e) => setActiveProject(projects.find(p => p.id === e.target.value) || null)}
                    disabled={isTimerRunning}
                  >
                    <option value="" className="text-black">Selecciona un proyecto...</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id} className="text-black">{p.name}</option>
                    ))}
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
              <Users size={18} className="text-black/50" /> Nuevo Cliente
            </h3>
            <NewClientForm onAdd={(client, project) => {
              setClients([...clients, client]);
              setProjects([...projects, project]);
              setActiveProject(project);
            }} />
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

function NewClientForm({ onAdd }: { onAdd: (c: Client, p: Project) => void }) {
  const [rut, setRut] = useState('');
  const [name, setName] = useState('');
  const [tariff, setTariff] = useState('35000');
  const [onboardingDate, setOnboardingDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateRUT(rut)) return alert('RUT Chileno no válido (incluye DV)');
    
    const clientId = uuidv4();
    const newClient: Client = {
      id: clientId,
      rut,
      name,
      email: `${name.toLowerCase().replace(/ /g, '')}@example.cl`,
      defaultTariff: parseInt(tariff),
      onboardingDate: new Date(onboardingDate).getTime(),
      lastActiveDate: new Date(onboardingDate).getTime()
    };

    const newProject: Project = {
      id: uuidv4(),
      clientId,
      name: `Consultoría ${name}`,
      status: 'ACTIVE'
    };

    onAdd(newClient, newProject);
    setRut('');
    setName('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">RUT Cliente</label>
          <input 
            type="text" 
            placeholder="12.345.678-9"
            className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all"
            value={rut}
            onChange={(e) => setRut(formatRUT(e.target.value))}
            required
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Tarifa CLP/h</label>
          <input 
            type="number" 
            className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all"
            value={tariff}
            onChange={(e) => setTariff(e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Nombre Cliente / Razón Social</label>
        <input 
          type="text" 
          placeholder="Ej: Tech Chile SpA"
          className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-black/40 font-bold mb-1 block">Fecha Inicio Proyecto</label>
        <input 
          type="date" 
          className="w-full bg-[#F9F9F7] border border-[#141414]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black transition-all"
          value={onboardingDate}
          onChange={(e) => setOnboardingDate(e.target.value)}
          required
        />
      </div>
      <button 
        type="submit"
        className="w-full bg-black text-white py-3 rounded-xl font-bold text-sm tracking-tight hover:bg-black/90 transition-colors"
      >
        REGISTRAR CLIENTE
      </button>
    </form>
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
