-- FIN DU MODE FORMATION — suppression de l'etat pedagogique.
--
-- Le guide de demarrage remplace les missions d'entrainement : il ne stocke
-- rien de propre (sa progression reutilise `onboarding_progress`) et parle du
-- travail REEL du membre. Trois tables n'ont donc plus de lecteur ni d'ecrivain.
--
-- La base d'exercice (`TRAINING_DATABASE_URL`) n'est plus utilisee du tout :
-- elle peut etre supprimee cote hebergeur, ainsi que sa variable.
--
-- Aucune donnee metier n'est touchee : ces tables ne contenaient que des
-- sessions de formation et des tentatives d'exercice.

DROP TABLE IF EXISTS "training_attempts";
DROP TABLE IF EXISTS "training_mission_progress";
DROP TABLE IF EXISTS "training_sessions";

DROP TYPE IF EXISTS "TrainingMissionStatus";
