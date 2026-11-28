-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('THERAPIST', 'PATIENT', 'CAREGIVER');

-- CreateEnum
CREATE TYPE "CareLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "BreachAction" AS ENUM ('CUE_ONLY', 'CUE_AND_PAUSE');

-- CreateEnum
CREATE TYPE "Reporter" AS ENUM ('PATIENT', 'CAREGIVER');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('COMPLETED', 'CANNOT_DO', 'POSTPONED');

-- CreateEnum
CREATE TYPE "BreachKind" AS ENUM ('ANGLE', 'VELOCITY');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('L1', 'L2');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "displayName" TEXT NOT NULL,
    "therapistId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareLink" (
    "id" UUID NOT NULL,
    "status" "CareLinkStatus" NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "caregiverId" UUID,
    "consentedById" UUID,

    CONSTRAINT "CareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExercise" (
    "id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "programId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,

    CONSTRAINT "PlanExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyEnvelope" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "maxAngleDeg" DOUBLE PRECISION NOT NULL,
    "maxVelDegPerS" DOUBLE PRECISION NOT NULL,
    "debounceMs" INTEGER NOT NULL,
    "onBreach" "BreachAction" NOT NULL,
    "notifyCaregiver" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planExerciseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,

    CONSTRAINT "SafetyEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RehabSession" (
    "id" UUID NOT NULL,
    "status" "LogStatus" NOT NULL,
    "reportedBy" "Reporter" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "envelopeVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "planExerciseId" UUID NOT NULL,
    "scheduledSessionId" UUID,

    CONSTRAINT "RehabSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledSession" (
    "id" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "planExerciseId" UUID NOT NULL,

    CONSTRAINT "ScheduledSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "difficulty" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "sessionId" UUID NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistReview" (
    "id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "therapistId" UUID NOT NULL,

    CONSTRAINT "TherapistReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptSummary" (
    "id" UUID NOT NULL,
    "reps" INTEGER NOT NULL,
    "activeMs" INTEGER NOT NULL,
    "maxAngleDeg" DOUBLE PRECISION NOT NULL,
    "maxVelDegPerS" DOUBLE PRECISION NOT NULL,
    "pauses" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "sessionId" UUID NOT NULL,

    CONSTRAINT "AttemptSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachEvent" (
    "id" UUID NOT NULL,
    "kind" "BreachKind" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "limit" DOUBLE PRECISION NOT NULL,
    "heldMs" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "sessionId" UUID NOT NULL,

    CONSTRAINT "BreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "status" "AlertStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "patientId" UUID NOT NULL,
    "caregiverId" UUID,
    "sessionId" UUID NOT NULL,
    "breachEventId" UUID,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "profileId" UUID NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" UUID NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "patientId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Profile_role_idx" ON "Profile"("role");

-- CreateIndex
CREATE INDEX "Profile_therapistId_idx" ON "Profile"("therapistId");

-- CreateIndex
CREATE UNIQUE INDEX "CareLink_tokenHash_key" ON "CareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "CareLink_patientId_status_idx" ON "CareLink"("patientId", "status");

-- CreateIndex
CREATE INDEX "CareLink_caregiverId_status_idx" ON "CareLink"("caregiverId", "status");

-- CreateIndex
CREATE INDEX "CareLink_consentedById_idx" ON "CareLink"("consentedById");

-- CreateIndex
CREATE INDEX "CareLink_expiresAt_idx" ON "CareLink"("expiresAt");

-- CreateIndex
CREATE INDEX "EmergencyContact_patientId_idx" ON "EmergencyContact"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "Program_patientId_active_idx" ON "Program"("patientId", "active");

-- CreateIndex
CREATE INDEX "Program_therapistId_idx" ON "Program"("therapistId");

-- CreateIndex
CREATE INDEX "PlanExercise_programId_position_idx" ON "PlanExercise"("programId", "position");

-- CreateIndex
CREATE INDEX "PlanExercise_exerciseId_idx" ON "PlanExercise"("exerciseId");

-- CreateIndex
CREATE INDEX "SafetyEnvelope_createdById_idx" ON "SafetyEnvelope"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyEnvelope_planExerciseId_version_key" ON "SafetyEnvelope"("planExerciseId", "version");

-- CreateIndex
CREATE INDEX "RehabSession_patientId_startedAt_idx" ON "RehabSession"("patientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "RehabSession_planExerciseId_envelopeVersion_idx" ON "RehabSession"("planExerciseId", "envelopeVersion");

-- CreateIndex
CREATE INDEX "RehabSession_reporterId_idx" ON "RehabSession"("reporterId");

-- CreateIndex
CREATE INDEX "RehabSession_scheduledSessionId_idx" ON "RehabSession"("scheduledSessionId");

-- CreateIndex
CREATE INDEX "ScheduledSession_patientId_scheduledFor_idx" ON "ScheduledSession"("patientId", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledSession_planExerciseId_idx" ON "ScheduledSession"("planExerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_sessionId_key" ON "Feedback"("sessionId");

-- CreateIndex
CREATE INDEX "TherapistReview_patientId_createdAt_idx" ON "TherapistReview"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TherapistReview_therapistId_idx" ON "TherapistReview"("therapistId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptSummary_sessionId_key" ON "AttemptSummary"("sessionId");

-- CreateIndex
CREATE INDEX "BreachEvent_sessionId_occurredAt_idx" ON "BreachEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "Alert_caregiverId_status_idx" ON "Alert"("caregiverId", "status");

-- CreateIndex
CREATE INDEX "Alert_patientId_createdAt_idx" ON "Alert"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_sessionId_idx" ON "Alert"("sessionId");

-- CreateIndex
CREATE INDEX "Alert_breachEventId_idx" ON "Alert"("breachEventId");

-- CreateIndex
CREATE INDEX "Device_profileId_idx" ON "Device"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_deviceId_idx" ON "PushToken"("deviceId");

-- CreateIndex
CREATE INDEX "AuditLog_patientId_createdAt_idx" ON "AuditLog"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareLink" ADD CONSTRAINT "CareLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareLink" ADD CONSTRAINT "CareLink_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareLink" ADD CONSTRAINT "CareLink_consentedById_fkey" FOREIGN KEY ("consentedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEnvelope" ADD CONSTRAINT "SafetyEnvelope_planExerciseId_fkey" FOREIGN KEY ("planExerciseId") REFERENCES "PlanExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEnvelope" ADD CONSTRAINT "SafetyEnvelope_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehabSession" ADD CONSTRAINT "RehabSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehabSession" ADD CONSTRAINT "RehabSession_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehabSession" ADD CONSTRAINT "RehabSession_planExerciseId_fkey" FOREIGN KEY ("planExerciseId") REFERENCES "PlanExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehabSession" ADD CONSTRAINT "RehabSession_planExerciseId_envelopeVersion_fkey" FOREIGN KEY ("planExerciseId", "envelopeVersion") REFERENCES "SafetyEnvelope"("planExerciseId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehabSession" ADD CONSTRAINT "RehabSession_scheduledSessionId_fkey" FOREIGN KEY ("scheduledSessionId") REFERENCES "ScheduledSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSession" ADD CONSTRAINT "ScheduledSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSession" ADD CONSTRAINT "ScheduledSession_planExerciseId_fkey" FOREIGN KEY ("planExerciseId") REFERENCES "PlanExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RehabSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistReview" ADD CONSTRAINT "TherapistReview_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapistReview" ADD CONSTRAINT "TherapistReview_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSummary" ADD CONSTRAINT "AttemptSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RehabSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachEvent" ADD CONSTRAINT "BreachEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RehabSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RehabSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_breachEventId_fkey" FOREIGN KEY ("breachEventId") REFERENCES "BreachEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
