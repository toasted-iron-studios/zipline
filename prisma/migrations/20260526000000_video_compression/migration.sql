-- AlterTable: video compression settings
ALTER TABLE "public"."Zipline"
  ADD COLUMN "featuresVideoCompressionEnabled"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featuresVideoCompressionNumberThreads"    INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "featuresVideoCompressionCodec"            TEXT    NOT NULL DEFAULT 'libx264',
  ADD COLUMN "featuresVideoCompressionCrf"              INTEGER NOT NULL DEFAULT 23,
  ADD COLUMN "featuresVideoCompressionPreset"           TEXT    NOT NULL DEFAULT 'medium',
  ADD COLUMN "featuresVideoCompressionMaxHeight"        INTEGER NOT NULL DEFAULT 1080,
  ADD COLUMN "featuresVideoCompressionMaxBitrateKbps"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "featuresVideoCompressionAudioBitrateKbps" INTEGER NOT NULL DEFAULT 128,
  ADD COLUMN "featuresVideoCompressionKeepOriginal"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "featuresVideoCompressionInstantaneous"    BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: sibling row tracking the compressed version of a File
CREATE TABLE "public"."CompressedFile" (
  "id"        TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "path"      TEXT         NOT NULL,
  "size"      BIGINT       NOT NULL DEFAULT 0,
  "status"    TEXT         NOT NULL DEFAULT 'pending',
  "error"     TEXT,
  "fileId"    TEXT         NOT NULL,

  CONSTRAINT "CompressedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompressedFile_fileId_key" ON "public"."CompressedFile"("fileId");

-- AddForeignKey
ALTER TABLE "public"."CompressedFile"
  ADD CONSTRAINT "CompressedFile_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "public"."File"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
