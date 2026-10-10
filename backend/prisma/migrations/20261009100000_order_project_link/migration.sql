-- Lien entre une commande et le projet cree par l'equipe a sa validation.
-- NULL tant que la commande n'est pas validee : le projet n'existe pas avant.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_projectId_key" ON "orders"("projectId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
