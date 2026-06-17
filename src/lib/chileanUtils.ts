/**
 * Utilidades para el contexto tributario y civil chileno.
 */

/**
 * Valida un RUT chileno (con dígito verificador).
 * Soporta RUTs de personas naturales y personas jurídicas (empresas).
 * Formatos aceptados: 12.345.678-5, 76.123.456-K, 12345678-5, 123456785, etc.
 */
export function validateRUT(rut: string): boolean {
  if (!rut || typeof rut !== 'string') return false;
  
  // Limpiar cualquier caracter que no sea número o K/k
  const cleanRUT = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  
  // El largo mínimo de un RUT válido en Chile es de 7 caracteres (ej, 1.000.000-0 -> '10000000')
  // El largo máximo es de 10 caracteres (ej, nuevas personas jurídicas 100.000.000-0 -> '1000000000')
  if (cleanRUT.length < 7 || cleanRUT.length > 10) return false;

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
 * Formatea un RUT para mostrarlo como 12.345.678-9 o 76.123.456-K.
 * Funciona perfectamente para personas naturales y jurídicas.
 */
export function formatRUT(rut: string): string {
  if (!rut) return '';
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
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
