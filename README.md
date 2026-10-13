# Trellis Studio

Une image → un modèle 3D texturé, avec [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) (Microsoft).
Visionneuse 3D dans la page, export **GLB**, et export **STL** prêt pour un slicer
(Z en haut, posé sur le plateau, mis à la hauteur voulue en mm).

## Comment ça marche

TRELLIS.2 demande un GPU NVIDIA de 24 Go : impossible sur Vercel. Le site ne
fait donc que l'interface et deux petites routes ; le calcul part chez
[fal.ai](https://fal.ai/models/fal-ai/trellis-2), payé à la génération.

```
navigateur ──image──▶ /api/generate (Vercel) ──▶ fal.ai : stockage + file d'attente
navigateur ──toutes les 2,5 s──▶ /api/status (Vercel) ──▶ fal.ai : état, puis URL du GLB
```

- La clé `FAL_KEY` reste sur le serveur ; le navigateur ne la voit jamais.
- Le modèle appelé est fixé côté serveur (`fal-ai/trellis-2`) et chaque option est validée :
  la route ne peut pas servir à lancer un autre modèle sur votre compte.
- L'image est réduite à 1024 px dans le navigateur avant l'envoi (Vercel limite le corps à 4,5 Mo).
- Aucune requête ne reste ouverte pendant la génération : le suivi se fait par
  interrogations courtes, ce qui tient dans les limites des fonctions Vercel gratuites.
- L'historique (12 derniers modèles) est gardé dans le navigateur. Les fichiers sont
  hébergés par fal.ai et peuvent expirer.

## Buste imprimable

TRELLIS.2 ne rend que la peau de ce que la photo montre : le dessous est
ouvert et les vêtements sont des feuilles sans épaisseur. Un slicer ne sait
pas remplir un tel objet. Le panneau « Buste imprimable » le reconstruit,
dans le navigateur (`lib/bust/solidify.ts`, dans un worker) :

1. la peau est posée dans une grille de voxels, au-dessus de la coupe choisie ;
2. l'extérieur est ce qu'on atteint par les côtés et le dessus sans passer par
   un trou de moins de 5 mm ; le plan de coupe ferme le dessous, donc la tête
   se remplit ;
3. les parois minces (vêtements) reçoivent 1,2 mm d'épaisseur au moins ;
4. un socle de 4 mm est ajouté, seul le plus grand morceau est gardé, et la
   surface est refaite par marching cubes sur le volume lissé.

Le résultat est un seul volume plein et fermé : chaque arête sert exactement
deux triangles, en sens opposés. `npm test` le vérifie sur un faux modèle qui a
les trois défauts de TRELLIS.2 (dessous ouvert, trou, feuille sans épaisseur).

La texture ne passe pas dans le STL, et les détails plus fins que la finesse
choisie (0,4 à 0,8 mm) sont lissés.

## Mise en ligne sur Vercel

1. Créez une clé sur <https://fal.ai/dashboard/keys> et ajoutez du crédit.
2. Sur <https://vercel.com/new>, importez ce dépôt (framework détecté : Next.js).
3. Dans **Environment Variables**, ajoutez :
   - `FAL_KEY` — la clé fal.ai (obligatoire) ;
   - `ACCESS_CODE` — un mot de passe (**fortement conseillé**) : sans lui, n'importe
     qui trouvant l'adresse peut générer à vos frais.
4. **Deploy**. Les variables sont lues à chaque requête : les changer ne demande qu'un
   redéploiement, pas de modification du code.

Coût indicatif chez fal.ai : quelques dizaines de centimes par modèle selon la
résolution — vérifiez le tarif actuel sur la page du modèle.

## En local

```bash
cp .env.example .env.local   # puis remplir FAL_KEY
npm install
npm run dev
npm run check   # lint, types et tests
```

## Options

| Option | Effet |
| --- | --- |
| Résolution (512³ / 1024³ / 1536³) | Détail de la géométrie ; plus haut = plus lent et plus cher |
| Texture (1024 / 2048 / 4096 px) | Finesse de la texture du GLB |
| Sommets (20k … 500k) | Poids du fichier ; 20k–50k pour le web, 200k+ pour l'impression |
| Remaillage propre | Triangles plus réguliers, conseillé pour l'impression 3D |
| Graine | Même image + même graine = même résultat |

Pour un meilleur résultat : un seul objet, bien éclairé, sur fond uni ou transparent (PNG).

## Licences

Code de ce site : MIT. TRELLIS.2 : MIT (Microsoft). Les images envoyées sont transmises à fal.ai.
