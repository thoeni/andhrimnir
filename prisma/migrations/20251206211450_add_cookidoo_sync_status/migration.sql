-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "cookidooId" TEXT,
ADD COLUMN     "cookidooUrl" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);
