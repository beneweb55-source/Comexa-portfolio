-- Cles d'idempotence : rejouer une creation sans la refaire.
--
-- n8n REJOUE. Un noeud HTTP qui expire cote client renvoie la meme requete ; sans
-- cette table, le serveur creerait une deuxieme tache et l'operateur verrait deux
-- fois la meme ligne. La cle d'idempotence est ce qui distingue « reessayer » de
-- « refaire ».
--
-- Garanties de ce fichier :
--  - chaque instruction est idempotente : `migrate deploy` peut etre relance ;
--  - `ON DELETE CASCADE` sur le porteur : la suppression d'un compte (humain ou
--    compte technique d'integration) n'y laisse aucune cle orpheline ;
--  - l'unicite porte sur (portee, cle, porteur) : deux integrations differentes
--    peuvent employer la meme chaine sans se marcher dessus, et aucune ne peut
--    bloquer les cles d'une autre ;
--  - `expiresAt` est indexe : le nettoyage des cles perimees se fait par index,
--    pas par balayage.

-- CreateTable
CREATE TABLE IF NOT EXISTS "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_scope_key_principalId_key" ON "idempotency_records"("scope", "key", "principalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
