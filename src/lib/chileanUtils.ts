/**
 * Utilidades para el contexto tributario y civil chileno.
 */

/**
 * Valida un RUT chileno (con dígito verificador).
 * Formatos aceptados: 12.345.678-5, 12345678-5, 123456785
 */
export function validateRUT(rut: string): boolean {
  if (!rut || typeof rut !== 'string') return false;
  
  // Limpiar puntos y guiones
  const cleanRUT = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  if (cleanRUT.length < 8) return false;

  const body = cleanRUT.slice(0, -1);
  const dv = cleanRUT.slice(-1);

  if (!/^\d+$/.test(body)) return false;

  return calculateDV(body) === dv;
}

/**
 * Calcula el dígito verificador para un cuerpo de RUT dado.
 */
export function calculateDV(body: string | number): string {
  let sum = 0;
  let multiplier = 2;
  const bodyStr = body.toString();

  for (let i = bodyStr.length - 1; i >= 0; i--) {
    sum += parseInt(bodyStr[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return res.toString();
}

/**
 * Formatea un RUT para mostrarlo como 12.345.678-9
 */
export function formatRUT(rut: string): string {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
}

/**
 * Formatea moneda CLP
 */
export function formatCLP(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(amount);
}

/**
 * Cálculos Impuestos Chile 2026
 */
export const TAX_CONFIG = {
  RETENTION_RATE: 0.1525, // 15.25% para Boletas de Honorarios en 2026
  IVA_RATE: 0.19,        // 19% IVA para Facturas
};

export interface TaxCalculation {
  bruto: number;
  retencion?: number;
  iva?: number;
  liquido: number;
}

/**
 * Calcula montos para Boleta de Honorarios ( Freelancer -> Cliente )
 * En Chile, usualmente se pacta un "Líquido"
 */
export function calculateBoleta(amount: number, isBruto: boolean = true): TaxCalculation {
  if (isBruto) {
    const retencion = Math.round(amount * TAX_CONFIG.RETENTION_RATE);
    return {
      bruto: amount,
      retencion,
      liquido: amount - retencion,
    };
  } else {
    // Si se pacta líquido: Bruto = Líquido / (1 - 0.1525)
    const bruto = Math.round(amount / (1 - TAX_CONFIG.RETENTION_RATE));
    return {
      bruto,
      retencion: bruto - amount,
      liquido: amount,
    };
  }
}

/**
 * Calcula montos para Factura afecta a IVA
 */
export function calculateFactura(neto: number): TaxCalculation {
  const iva = Math.round(neto * TAX_CONFIG.IVA_RATE);
  return {
    bruto: neto + iva, // Total Factura
    iva,
    liquido: neto, // Para el freelance, el ingreso real es el neto (el IVA se paga al fisco)
  };
}
