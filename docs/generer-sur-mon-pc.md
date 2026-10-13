# Générer les modèles 3D sur mon PC (gratuit)

Le site n'a pas besoin de fal.ai pour faire un buste : il accepte un fichier
`.glb` déposé dans la zone photo, et le panneau « Buste imprimable » en fait un
STL plein, fermé, sur socle. Il suffit donc de produire ce `.glb` sur le PC,
avec TRELLIS.2 dans **ComfyUI**, gratuitement.

```
photo ──▶ ComfyUI + TRELLIS.2 (sur le PC) ──▶ buste.glb ──▶ site : déposer le .glb ──▶ STL imprimable
```

Machine visée : HP OMEN 16, Windows 11, RTX 3060 Laptop **6 Go**, 16 Go de RAM.

> **À savoir avant de commencer.** TRELLIS.2 demande officiellement 24 Go de
> mémoire graphique. Depuis août 2026, ComfyUI l'intègre en version allégée
> (int8) et ne charge sur la carte que ce qui sert : en **forme seule** et en
> **résolution 512**, le pic est estimé entre 3,5 et 5,5 Go. Mais **personne n'a
> encore publié d'essai sur une carte de 6 Go** : le premier essai en 512 décide.
> S'il échoue, voir « Si ça ne passe pas » en bas.

Prévoir : environ 1 h 30 (surtout des téléchargements, ~16 Go) et **60 Go libres**
sur le disque C:.

---

## 1. Préparer le portable (une fois)

1. **Secteur et performances.** Branchez le chargeur et laissez-le branché : sur
   batterie, la carte est bridée. Dans **OMEN Gaming Hub** → Contrôle des
   performances → **Performance**. Dans Windows : Paramètres → Système →
   Alimentation → Mode d'alimentation → **Performances optimales**.
2. **Fichier d'échange** (votre RAM est déjà très chargée) : touche Windows,
   tapez « Afficher les paramètres système avancés » → Performances →
   Paramètres → onglet Avancé → Mémoire virtuelle → Modifier. Décochez
   « Gérer automatiquement », choisissez C:, « Taille personnalisée » :
   **16384** (initiale) et **32768** (maximale) → Définir → OK → **redémarrez**.
3. **Pilote NVIDIA** : le vôtre (592.27) convient, ne touchez à rien.

## 2. Installer ComfyUI Desktop

1. Téléchargez l'installateur sur <https://comfy.org/download> (ou directement
   <https://dl.todesktop.com/241130tqe9q3y/windows>) et lancez-le. Il faut
   Desktop **1.0.47 ou plus**.
2. Cliquez la carte **« + »** (nouvelle instance) → « Public Builds » →
   « Stable (Recommended) » → Hardware **NVIDIA**. Choisissez un dossier sur C:,
   mais pas directement `C:\`. Desktop installe Python et le reste tout seul.
3. Vérifiez la version : sur la carte de l'instance, **⋮ → Manage → About** :
   « Current Version » doit être **v0.35.0 ou plus** (v0.40.0 le 13/10/2026).
   Sinon : onglet Update → Check for update.

## 3. Ouvrir le modèle TRELLIS.2 et télécharger les fichiers

1. Lancez l'instance. Dans la barre de gauche, icône **Templates** → catégorie
   **« 3D Model »** (ou tapez TRELLIS) → **« Pixal3D & TRELLIS.2: Image to Model »**.
2. Une fenêtre **« Missing models »** s'ouvre : cliquez **Download** sur chaque
   ligne (7 fichiers, 15 Go). Suivez l'avancement avec le bouton « Downloads »
   en haut. Tous sont exigés, même ceux de Pixal3D qui ne serviront pas.

## 4. Régler le modèle pour 6 Go (une fois, puis enregistrer)

Chaque cadre coloré est un « groupe » ; chaque boîte est un « nœud ».

1. **Choisir TRELLIS.2** : groupe « Switch Model Here » → nœud
   « Boolean (Switch to Trellis2) » → **true**.
2. **Photo** : groupe « Upload Input Image Here » → nœud Load Image → *upload*.
   Portrait de face, une seule personne, tête et épaules qui remplissent l'image,
   lumière douce. Laissez « Switch: Remove background » sur true (détourage
   automatique). Dans « Crop Image to Mask », mettez pad_factor à **1.0**.
3. **Forme seule, sans texture** (la texture ne sert pas à l'impression et
   prend beaucoup de mémoire) : sélectionnez tous les nœuds des groupes
   **« Texture Generation »**, **« Texture baking »**, **« Vertex color preview »**,
   et le nœud isolé **« Save 3D (Advanced) »** tout à droite (Ctrl + glisser pour
   encadrer, Ctrl + clic pour ajouter). Appuyez sur **Ctrl + M** : ils
   deviennent gris (désactivés). Ne désactivez rien dans « Mesh Post-Processing ».
4. **Résolution 512 pour le premier essai** : dans le groupe « Shape Generation »,
   il y a deux nœuds KSampler. Tirez un lien depuis la sortie **LATENT** du
   KSampler de **gauche** (20 steps) jusqu'à l'entrée **samples** de
   « Trellis2 VAE Decode Shape » (le nouveau lien remplace l'ancien). Ne touchez
   pas à « Trellis2 VAE Decode Structure » : il doit rester à **32**.
5. **Post-traitement allégé**, groupe « Mesh Post-Processing » :
   - « Remesh Mesh (Narrow-Band DC) » : resolution **512** (au lieu de 768).
     Pour voir les réglages cachés : roue dentée → Lite Graph → « Always show
     advanced widgets on all nodes ». Puis precluster_max_verts : **3000000**.
   - « Decimate Mesh » : target_face_count **300000** (au lieu de 700000).
6. **Sauver le GLB** : double-cliquez dans une zone vide, tapez
   **« Save 3D Model »**, Entrée. Reliez la sortie **mesh** de
   « Smooth Mesh Normals » (ou, s'il n'existe pas, de « Decimate Mesh ») à
   l'entrée **mesh** de ce nouveau nœud. filename_prefix : **3d/buste**.
7. **Enregistrez ce flux** : Ctrl + S, nommez-le « buste 6 Go ». La prochaine
   fois, il suffira de l'ouvrir et de changer la photo.

## 5. Lancer

1. Avant chaque génération : **redémarrez** ou fermez navigateur, Discord, jeux.
2. **Run** (ou Ctrl + Entrée). Le premier lancement lit ~8 Go de fichiers.
   Comptez **2 à 8 minutes** en 512 (estimation, non mesurée sur votre carte).
3. Pour suivre : Gestionnaire des tâches → Performances → GPU NVIDIA. Une
   « Mémoire GPU dédiée » presque pleine est **normale**. Si la « Mémoire GPU
   partagée » grimpe de plusieurs Go, ça va devenir très lent.
4. Le fichier sort dans
   `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\output\3d\buste_00001_.glb`
   (copiez ce chemin dans la barre de l'Explorateur).

## 6. Faire le buste sur le site

Ouvrez votre site, **glissez le `.glb`** dans la zone photo, puis panneau
« Buste imprimable » → coupe sous le menton → **Préparer le buste** →
**Télécharger le STL du buste**. Le site ferme le dessous, remplit la tête et
épaissit les parties trop fines : le `.glb` brut de ComfyUI, lui, n'est pas
imprimable tel quel.

## 7. Monter en qualité (si le 512 a marché)

Visage plus détaillé, en **1024** :

1. Recâblez la sortie LATENT du KSampler de **droite** (12 steps) vers
   « samples » de « Trellis2 VAE Decode Shape ».
2. Dans « Trellis2 Upsample Stage », target_resolution : **1024** (jamais 1536
   sur 6 Go).
3. Gardez Remesh à 512. Comptez 8 à 20 minutes.

Pour une autre version du même visage : changez la **seed** des KSampler.

---

## En cas de problème

| Symptôme | Que faire |
|---|---|
| « out of memory » / « Allocation on device » au Remesh | Remesh resolution **384** puis **256**, precluster_max_verts **1500000** |
| « out of memory » au décodage ou au 2ᵉ KSampler | Revenir au 512 (étape 4.4) |
| Écran bleu (dxgmms2.sys) ou gel complet | ⋮ → Manage → Startup Args : ajoutez `--disable-comfy-compiler` après `--enable-manager`, relancez. Si ça continue : remplacez par `--disable-dynamic-vram` |
| Nœuds Trellis2 « manquants » (rouges) | ComfyUI trop ancien : Manage → Update |
| « Value not in list … pixal3d » ou « … moge » | Un des 7 fichiers manque : rouvrez le modèle et cliquez Download |
| Le PC rame, disque à 100 % | RAM saturée : fermez tout, vérifiez le fichier d'échange (étape 1.2) |
| Le visage est mou ou déformé | Photo plus serrée sur le visage, autre seed, essai en 1024 |

Les libellés peuvent varier légèrement d'une version de ComfyUI à l'autre.
Une capture d'écran du message d'erreur suffit pour trouver la suite.

## Si ça ne passe pas sur 6 Go

1. **trellis.cpp** (sans Python, poids compressés q4) : seuls rapports réels sur
   des portables de **8 Go**, rien sur 6 Go. Installateur :
   <https://github.com/pwilkin/trellis.cpp> (script `install/install.ps1`,
   option `-Quant q4`). Attention : il installe un logiciel qui s'appelle aussi
   « Trellis Studio », sans rapport avec ce site.
2. **Hugging Face (gratuit)** : environ 1 buste par jour avec un compte gratuit.
3. **fal.ai** : environ 0,30 $ par buste, la meilleure qualité, déjà branché
   sur le site.

## Licence

TRELLIS.2 est sous licence MIT. Le pipeline officiel de Microsoft s'appuie sur
des briques à usage non commercial (nvdiffrast pour la texture). En forme seule
dans ComfyUI, cette brique n'est pas utilisée. Pour vendre des bustes,
renseignez-vous : ce n'est pas un avis juridique.
