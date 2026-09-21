-- CreateEnum
CREATE TYPE "MotivoExclusionSolicitud" AS ENUM ('rechazo', 'expiracion');

-- CreateTable
CREATE TABLE "solicitudes_conductores_rechazados" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "conductor_id" TEXT NOT NULL,
    "motivo" "MotivoExclusionSolicitud" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_conductores_rechazados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_conductores_rechazados_solicitud_id_conductor_i_key" ON "solicitudes_conductores_rechazados"("solicitud_id", "conductor_id");

-- CreateIndex
CREATE INDEX "solicitudes_estado_expira_en_idx" ON "solicitudes"("estado", "expira_en");

-- AddForeignKey
ALTER TABLE "solicitudes_conductores_rechazados" ADD CONSTRAINT "solicitudes_conductores_rechazados_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_conductores_rechazados" ADD CONSTRAINT "solicitudes_conductores_rechazados_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
