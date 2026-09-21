// TODO (post-MVP): enviar al pasajero datos del vehiculo del conductor que acepto.
// Por ahora no persiste nada ni falla el endpoint si "falla".
function notificarPasajero(pasajeroId: string, datos: { solicitudId: string; conductorNombre: string; placa: string }) {
  console.log(`[stub] Notificar a pasajero ${pasajeroId}: solicitud ${datos.solicitudId}, conductor ${datos.conductorNombre}, placa ${datos.placa}`);
}

export { notificarPasajero };