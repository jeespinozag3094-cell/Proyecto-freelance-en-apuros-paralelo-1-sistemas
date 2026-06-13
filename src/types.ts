import { TaxCalculation } from './lib/chileanUtils';

export type DocumentType = 'BOLETA' | 'FACTURA';

export interface Client {
  id: string;
  rut: string;
  name: string;
  email: string;
  defaultTariff: number; // CLP/hora
  onboardingDate?: number; // timestamp
  lastActiveDate?: number; // timestamp
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface WorkSession {
  id: string;
  projectId: string;
  startTime: number; // timestamp
  endTime: number; // timestamp
  durationHours: number;
  tariffCLP: number;
  documentType: DocumentType;
  billingStatus: 'PENDING' | 'ISSUED' | 'PAID' | 'OVERDUE';
  issuedAt?: number;
  paidAt?: number;
  taxData: TaxCalculation;
}

export interface DashboardStats {
  monthlyBilling: number;
  accountsReceivable: number;
  ehr: number; // Tarifa Efectiva Real
  unpaidInvoicesCount: number;
  overduePaymentsCount: number;
}
