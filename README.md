# Capoeira Quest V4

Application HTML/CSS/JS séparée.

## Nouveautés V4
- Bananes quotidiennes : +20 par jour
- Un test de module coûte 20 bananes
- Un module se valide avec 4 tests de 10 questions puis un test de reprise des erreurs si nécessaire
- Test validé : +50 XP
- Test parfait : +100 XP
- Toutes les 3 bonnes réponses d'affilée : gain aléatoire de 1 à 4 bananes
- Boutique : 200 XP = +10 bananes
- Design plus dynamique
- Logo SVG inclus
- Parcours sans cordes, basé sur les compétences
- 10 questions différentes par test, 15 pour les modules chanson quand la banque le permet
- 90% requis pour valider
- Erreurs reprises dans le test final du module

## Lancer
Ouvre `index.html` dans un navigateur.

## Publier sur GitHub Pages

1. Crée un nouveau repository GitHub, par exemple `capoeira-quest`.
2. Ajoute tous les fichiers de ce dossier dans le repository.
3. Va dans `Settings` -> `Pages`.
4. Dans `Build and deployment`, choisis `Deploy from a branch`.
5. Sélectionne la branche `main` et le dossier `/root`.
6. GitHub donnera une adresse du type :
   `https://ton-pseudo.github.io/capoeira-quest/`

Chaque joueur garde sa progression dans son propre navigateur grâce au stockage local. S'il ferme l'app ou quitte l'onglet, la session est sauvegardée automatiquement et la leçon en cours reprend à la bonne question.

## Modifier le contenu
Les paliers et questions sont dans `data.js`.
