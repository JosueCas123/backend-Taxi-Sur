import type { ConductorDetalleDto } from "./conductores.schema";

/**
 * Punto de integracion para notificaciones reales (WhatsApp, push o tabla).
 * En el MVP no tiene efecto real: el documento de negocio no define aun el
 * proveedor ni el canal. La implementacion quedara en un modulo futuro.
 *
 * La funcion nunca debe bloquear ni hacer fallar al endpoint que la invoca.
 */
export async function notificarConductor(_conductor: ConductorDetalleDto): Promise<void> {
  return;
}