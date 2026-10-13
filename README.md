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
   un trou de la peau : sont bouchés ceux de moins de 6 % de la hauteur gardée,
   entre 3 et 8 mm (5,8 mm pour un buste de 10 cm). Le plan de coupe ferme le
   dessous, donc la tête se remplit ;
3. l'extérieur revient ensuite jusqu'à la peau, sans la traverser : orbites,
   narines, coins de la bouche et plis d'oreille restent creux, et un trou
   bouché l'est au ras de la peau ;
4. seules les parties minces (vêtements, bord d'une oreille) sont épaissies,
   à 1,2 mm au moins : la peau d'une tête pleine reste à sa taille ;
5. un socle de 4 mm suit l'empreinte réelle de la coupe, épaules comprises, et
   déborde de 3 mm ; si la coupe tombe sur plusieurs morceaux, une seule
   semelle les réunit ;
6. seul le plus grand morceau est gardé, et la surface est refaite par
   marching cubes sur le volume lissé.

Le résultat est un seul volume plein et fermé : chaque arête sert exactement
deux triangles, en sens opposés. `npm test` le vérifie sur un faux modèle qui a
les trois défauts de TRELLIS.2 (dessous ouvert, trou, feuille sans épaisseur),
et contrôle la fidélité : une boule ressort à sa taille à un demi-voxel près,
un creux de 4 mm de large garde plus de 1,5 mm de profondeur, et le socle passe
sous des épaules de 12 cm.

Le calcul dit ce qu'il a fait : la finesse réellement employée (un grand buste
en « Fin » ne tient pas en mémoire, les voxels sont alors grossis — elle se
connaît avant de lancer le calcul) et la part du modèle jetée parce qu'elle
flottait à part.

La texture ne passe pas dans le STL. Les creux plus étroits qu'environ trois
voxels (1,6 mm en « Normal ») sont lissés. Un trou plus grand que le bouchage
laisse entrer l'extérieur : la tête ressort alors creuse, en coque d'au moins
1,2 mm.

## Mise en ligne sur Vercel

1. Créez une clé sur <https://fal.ai/dashboard/keys> et ajoutez du crédit.
2. Sur <https://vercel.com/new>, importez ce dépôt (framework détecté : Next.js).
3. Dans **Environment Variables**, ajoutez :
   - `FAL_KEY` — la clé fal.ai (obligatoire) ;
   - `ACCESS_CODE` — un mot de passe (**obligatoire en production**) : sans lui, la
     génération est désactivée sur le site de production (bouton grisé, refus 503),
     car n'importe qui trouvant l'adresse pourrait générer à vos frais. Les
     déploiements de prévisualisation et le poste local restent ouverts ;
   - `PUBLIC_ACCESS=1` — seulement pour ouvrir **volontairement** le site de
     production à tous sans code, chaque génération restant à vos frais.
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

Pour un buste : une seule personne, visage de face, tête et épaules dans l'image,
lumière douce sans ombre dure, fond uni ou détouré (PNG transparent).

### Photo et cadrage

Seul le carré affiché est envoyé : faites glisser la photo (souris, doigt ou
flèches du clavier) pour la placer, et zoomez pour ne garder que la tête et les
épaules. « Photo entière » envoie l'image sans la recadrer. « Reprendre ces
réglages » remet les réglages d'un modèle, graine comprise ; pour obtenir le
même modèle, il faut aussi la même photo, cadrée de la même façon.

### Rouvrir un modèle

Un fichier `.glb` déjà téléchargé se rouvre dans le même cadre que les photos
(glisser-déposer ou choix de fichier), sans payer de nouvelle génération : utile
quand le lien de fal.ai a expiré.

### Hauteur

Le STL brut et le buste partagent une seule hauteur, de 20 à 400 mm. Pour le
buste, c'est la hauteur totale, socle de 4 mm compris.

## Licences

Code de ce site : MIT. TRELLIS.2 : MIT (Microsoft). Les images envoyées sont transmises à fal.ai.
