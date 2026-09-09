-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('admin', 'conductor');

-- CreateEnum
CREATE TYPE "EstadoConductor" AS ENUM ('pendiente', 'aprobado', 'rechazado', 'suspendido');

-- CreateEnum
CREATE TYPE "EstadoJornada" AS ENUM ('no_iniciada', 'activa', 'finalizada');

-- CreateEnum
CREATE TYPE "EstadoDisponibilidad" AS ENUM ('disponible', 'no_disponible', 'solicitud_pendiente', 'en_servicio');

-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('creada', 'buscando', 'conductor_seleccionado', 'esperando_respuesta', 'aceptada', 'rechazada', 'expirada', 'en_servicio', 'finalizada', 'sin_conductor');

-- CreateTable
CREATE TABLE "configuracion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nombre_empresa" TEXT NOT NULL,
    "radio_maximo_busqueda_km" INTEGER NOT NULL DEFAULT 5,
    "telefono_centro_atencion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo_electronico" TEXT,
    "hash_contrasena" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conductores" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "cedula_identidad" TEXT NOT NULL,
    "estado" "EstadoConductor" NOT NULL DEFAULT 'pendiente',
    "estado_jornada" "EstadoJornada" NOT NULL DEFAULT 'no_iniciada',
    "estado_disponibilidad" "EstadoDisponibilidad" NOT NULL DEFAULT 'no_disponible',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "conductores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "conductor_id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "capacidad_pasajeros" INTEGER NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pasajeros" (
    "id" TEXT NOT NULL,
    "whatsapp_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "aceptacion_aviso_privacidad" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "pasajeros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones_conductor" (
    "id" BIGSERIAL NOT NULL,
    "conductor_id" TEXT NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "hora_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "es_valida" BOOLEAN NOT NULL DEFAULT true,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "ubicaciones_conductor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes" (
    "id" TEXT NOT NULL,
    "pasajero_id" TEXT NOT NULL,
    "conductor_asignado_id" TEXT,
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'creada',
    "latitud_recogida" DOUBLE PRECISION NOT NULL,
    "longitud_recogida" DOUBLE PRECISION NOT NULL,
    "destino" TEXT,
    "expira_en" TIMESTAMP(3),
    "aceptada_en" TIMESTAMP(3),
    "finalizada_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "solicitudes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifas" (
    "id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "vigencia_desde" DATE NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "tarifas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefono_key" ON "usuarios"("telefono");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_electronico_key" ON "usuarios"("correo_electronico");

-- CreateIndex
CREATE UNIQUE INDEX "conductores_usuario_id_key" ON "conductores"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_placa_key" ON "vehiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "pasajeros_whatsapp_id_key" ON "pasajeros"("whatsapp_id");

-- AddForeignKey
ALTER TABLE "conductores" ADD CONSTRAINT "conductores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones_conductor" ADD CONSTRAINT "ubicaciones_conductor_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_pasajero_id_fkey" FOREIGN KEY ("pasajero_id") REFERENCES "pasajeros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_conductor_asignado_id_fkey" FOREIGN KEY ("conductor_asignado_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
