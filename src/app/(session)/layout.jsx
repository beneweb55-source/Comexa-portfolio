/**
 * Les pages d'authentification et les espaces partagent le fournisseur de session
 * installé dans le layout racine. Le site public peut ainsi rendre le vrai compte
 * connecté sans créer une deuxième session lors d'une navigation interne.
 */
export default function SessionLayout({ children }) {
  return children;
}
