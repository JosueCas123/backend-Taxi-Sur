import { EstadoConductor, EstadoDisponibilidad, EstadoJornada } from "@prisma/client";
import { z } from "zod";

const textoVehiculo = z.string().trim().min(1).max(30);

const vehiculoRegistroSchema = z.object({
  placa: textoVehiculo,
  marca: textoVehiculo,
  modelo: textoVehiculo,
  color: textoVehiculo,
  capacidadPasajeros: z.number().int().min(1).max(100),
}).strict();

export const conductorRegistroSchema = z.object({
  telefono: z.string().trim().min(1).max(30),
  pin: z.string().regex(/^\d{4,6}$/),
  nombreCompleto: z.string().trim().min(1).max(100),
  cedulaIdentidad: z.string().trim().min(1).max(50),
  vehiculo: vehiculoRegistroSchema,
}).strict();

export const vehiculoUpdateSchema = vehiculoRegistroSchema.partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const conductoresFiltroSchema = z.object({
  estado: z.enum(EstadoConductor).optional(),
}).strict();

export const vehiculoDtoSchema = z.object({
  id: z.uuid(),
  placa: z.string(),
  marca: z.string(),
  modelo: z.string(),
  color: z.string(),
  capacidadPasajeros: z.number().int(),
}).strict();

export const conductorDetalleDtoSchema = z.object({
  id: z.uuid(),
  usuarioId: z.uuid(),
  telefono: z.string(),
  nombreCompleto: z.string(),
  cedulaIdentidad: z.string(),
  estado: z.enum(EstadoConductor),
  estadoJornada: z.enum(EstadoJornada),
  estadoDisponibilidad: z.enum(EstadoDisponibilidad),
  creadoEn: z.iso.datetime(),
  vehiculo: vehiculoDtoSchema.nullable(),
}).strict();

export const listadoConductorDtoSchema = conductorDetalleDtoSchema.omit({ usuarioId: true });

export type ConductorRegistroInput = z.infer<typeof conductorRegistroSchema>;
export type VehiculoUpdateInput = z.infer<typeof vehiculoUpdateSchema>;
export type ConductoresFiltroInput = z.infer<typeof conductoresFiltroSchema>;
export type VehiculoDto = z.infer<typeof vehiculoDtoSchema>;
export type ConductorDetalleDto = z.infer<typeof conductorDetalleDtoSchema>;
export type ListadoConductorDto = z.infer<typeof listadoConductorDtoSchema>;
