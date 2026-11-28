/*
 * La langue : français, anglais ou arabe. Le choix vaut pour tous les sites 3ddeal : un cookie partagé par les
 * sous-domaines (dd_lang), avec une copie locale quand les cookies sont refusés. Sans choix, celle du navigateur
 * (l'anglais pour toute autre). Les textes sont écrits en français dans le code, et c'est le français qui sert de clé :
 * une phrase absente du dictionnaire reste en français, jamais un blanc.
 *
 * `tr` traduit dans la langue du dernier rendu, et non dans celle du stockage : au premier rendu dans le navigateur,
 * React rejoue la page du serveur (en français) avant de passer à la langue choisie ; lire le stockage directement
 * ferait diverger les deux. Chaque composant qui affiche du texte appelle donc `useLang()` en tête.
 */
import { createContext, useContext, useSyncExternalStore } from "react";

export type Lang = "fr" | "en" | "ar";
export const LANGS: readonly Lang[] = ["fr", "en", "ar"];
const KEY = "dd_lang";
const estLangue = (v: unknown): v is Lang => v === "fr" || v === "en" || v === "ar";
const abonnes = new Set<() => void>();
let active: Lang = "fr";
// Le choix de la page quand ni cookie ni stockage ne le gardent.
let enMemoire: Lang | null = null;

export function storedLang(): Lang | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)dd_lang=(fr|en|ar)/);
    if (m && estLangue(m[1])) return m[1];
    const garde = window.localStorage.getItem(KEY);
    return estLangue(garde) ? garde : enMemoire;
  } catch {
    return enMemoire;
  }
}

export function resolvedLang(): Lang {
  const garde = storedLang();
  if (garde) return garde;
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return nav.startsWith("fr") ? "fr" : nav.startsWith("ar") ? "ar" : "en";
}

/** La langue imposée par l'adresse (/en, /ar), ou null à la racine, qui suit le choix de la personne. */
export const PageLang = createContext<Lang | null>(null);
/** L'adresse de chaque langue : le français à la racine, pour que les liens déjà partagés ne changent pas. */
export const pathOf = (lang: Lang) => (lang === "fr" ? "/" : `/${lang}`);

function subscribeLang(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** La langue affichée ; à appeler en tête de tout composant qui affiche du texte. */
export function useLang(): Lang {
  // Une adresse préfixée prime sur le stockage, au serveur comme dans le navigateur : la page /en est rendue en anglais
  // pour les moteurs, et reste en anglais pour qui l'ouvre, quel que soit son choix ailleurs.
  const page = useContext(PageLang);
  const lang = useSyncExternalStore(subscribeLang, () => page ?? resolvedLang(), () => page ?? "fr");
  // Sans danger : tous les composants d'un même rendu lisent le même instantané, donc écrivent la même langue.
  retenir(lang);
  return lang;
}
function retenir(lang: Lang) {
  active = lang;
}

export function saveLang(lang: Lang) {
  try {
    const domaine = /(^|\.)3ddeal\.com$/.test(location.hostname) ? "; domain=3ddeal.com" : "";
    const sur = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `dd_lang=${lang}; path=/; max-age=31536000; SameSite=Lax${domaine}${sur}`;
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Cookies et stockage refusés : le choix ne vaut que pour la page.
  }
  enMemoire = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  for (const rappel of abonnes) rappel();
}

/** `lang` et `dir` sur <html> avant la première peinture : une page arabe ne se peint pas d'abord de gauche à droite. */
export const LANG_SCRIPT =
  'try{var p=location.pathname.match(/^\\/(en|ar)(\\/|$)/),m=document.cookie.match(/(?:^|;\\s*)dd_lang=(fr|en|ar)/),l=p?p[1]:m?m[1]:localStorage.getItem("dd_lang");' +
  'if(l!=="fr"&&l!=="en"&&l!=="ar"){var n=navigator.language||"";l=n.indexOf("fr")===0?"fr":n.indexOf("ar")===0?"ar":"en"}' +
  'document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr"}catch(e){}';

/** Le texte dans la langue affichée ; {0}, {1}… sont remplacés par les arguments. */
export function tr(fr: string, ...args: (string | number)[]): string {
  const e = active === "fr" ? undefined : DICT[fr];
  const t = e ? e[active === "en" ? 0 : 1] : fr;
  return args.length ? t.replace(/\{(\d)\}/g, (m, i) => String(args[+i] ?? m)) : t;
}

/** Pour les nombres et les dates. */
export const locale = () => (active === "en" ? "en-GB" : active === "ar" ? "ar-MA" : "fr-FR");


/* Le dictionnaire : la phrase française, puis [anglais, arabe]. Les balises <c>…</c> marquent du code. */
export const DICT: Record<string, [string, string]> = {
  "Une image → un modèle 3D texturé, avec TRELLIS.2 de Microsoft. Export GLB, et STL pour l'impression.": [
    "An image → a textured 3D model, with Microsoft's TRELLIS.2. GLB export, and STL for printing.",
    "صورة ← مجسم ثلاثي الأبعاد بملمس، باستخدام TRELLIS.2 من مايكروسوفت. تصدير GLB، وSTL للطباعة.",
  ],
  "Modèle {0} (MIT), exécuté sur {1}. Les images envoyées sont transmises à fal.ai.": [
    "Model {0} (MIT), running on {1}. Uploaded images are sent to fal.ai.",
    "النموذج {0} (MIT)، يعمل على {1}. الصور المرسلة تُحال إلى fal.ai.",
  ],
  "Langue": ["Language", "اللغة"],
  "Passer en thème clair": ["Switch to light theme", "التبديل إلى الوضع الفاتح"],
  "Passer en thème sombre": ["Switch to dark theme", "التبديل إلى الوضع الداكن"],
  "Thème clair": ["Light theme", "الوضع الفاتح"],
  "Thème sombre": ["Dark theme", "الوضع الداكن"],
  "Ce modèle n'est plus disponible chez fal.ai (lien expiré) : régénérez-le ou rouvrez le GLB téléchargé.": [
    "This model is no longer available on fal.ai (link expired): generate it again or reopen the downloaded GLB.",
    "هذا المجسم لم يعد متاحًا على fal.ai (انتهت صلاحية الرابط): أعد توليده أو افتح ملف GLB الذي نزّلته.",
  ],
  "Le modèle n'a pas pu être chargé (réseau coupé ou fal.ai indisponible) : rechargez la page pour réessayer.": [
    "The model could not be loaded (network down or fal.ai unavailable): reload the page to try again.",
    "تعذّر تحميل المجسم (الشبكة مقطوعة أو fal.ai غير متاح): أعد تحميل الصفحة للمحاولة مجددًا.",
  ],
  "Suivi arrêté.": ["Tracking stopped.", "توقفت المتابعة."],
  "Oublier cette génération ? Si elle a abouti chez fal.ai, son modèle ne sera pas récupéré ici (elle a déjà été payée).": [
    "Forget this generation? If it succeeded on fal.ai, its model will not be retrieved here (it has already been paid for).",
    "نسيان هذا التوليد؟ إن نجح على fal.ai فلن يُسترجع مجسمه هنا (وقد دُفع ثمنه بالفعل).",
  ],
  "Format non pris en charge : une image (PNG, JPEG, WebP) ou un modèle .glb.": [
    "Unsupported format: an image (PNG, JPEG, WebP) or a .glb model.",
    "صيغة غير مدعومة: صورة (PNG أو JPEG أو WebP) أو مجسم ‎.glb.",
  ],
  "Une génération déjà payée n'a pas encore été récupérée : « Reprendre le suivi » la récupère sans frais.\n\nEn lancer une nouvelle coûte une génération de plus. Continuer ?":
    [
      "A generation you already paid for has not been retrieved yet: “Resume tracking” gets it at no cost.\n\nStarting a new one costs one more generation. Continue?",
      "هناك توليد مدفوع لم يُسترجع بعد: «استئناف المتابعة» يسترجعه دون تكلفة.\n\nإطلاق توليد جديد يكلّف توليدًا إضافيًا. هل تتابع؟",
    ],
  "Réponse inattendue du serveur.": ["Unexpected server response.", "ردّ غير متوقع من الخادم."],
  "Export STL impossible : {0}": ["STL export failed: {0}", "تعذّر تصدير STL: {0}"],
  "Retirer ce modèle de l'historique ? Son lien sera oublié ici. Si vous n'avez pas téléchargé le GLB, il faudra payer une nouvelle génération.":
    [
      "Remove this model from the history? Its link will be forgotten here. If you haven't downloaded the GLB, you'll have to pay for a new generation.",
      "إزالة هذا المجسم من السجل؟ سيُنسى رابطه هنا. إن لم تنزّل ملف GLB فسيلزمك دفع ثمن توليد جديد.",
    ],
  "Génération en ligne désactivée : pas de clé fal.ai (<c>FAL_KEY</c>) sur le serveur. Vous pouvez toujours déposer ici un fichier <c>.glb</c> généré sur votre PC (voir <c>docs/generer-sur-mon-pc.md</c>) pour en faire un buste imprimable, sans rien payer.":
    [
      "Online generation disabled: no fal.ai key (<c>FAL_KEY</c>) on the server. You can still drop a <c>.glb</c> file generated on your PC here (see <c>docs/generer-sur-mon-pc.md</c>) to turn it into a printable bust, free of charge.",
      "التوليد عبر الإنترنت معطّل: لا يوجد مفتاح fal.ai (<c>FAL_KEY</c>) على الخادم. ما زال بإمكانك وضع ملف <c>.glb</c> مولَّد على حاسوبك هنا (راجع <c>docs/generer-sur-mon-pc.md</c>) لتحويله إلى تمثال نصفي قابل للطباعة، مجانًا.",
    ],
  "Génération désactivée : la variable <c>ACCESS_CODE</c> n'est pas définie sur le serveur. Sans elle, n'importe qui trouvant l'adresse pourrait générer à vos frais. Ajoutez-la dans Vercel (Settings → Environment Variables), puis redéployez.":
    [
      "Generation disabled: the <c>ACCESS_CODE</c> variable is not set on the server. Without it, anyone finding the address could generate at your expense. Add it in Vercel (Settings → Environment Variables), then redeploy.",
      "التوليد معطّل: المتغير <c>ACCESS_CODE</c> غير مُعرّف على الخادم. بدونه، يمكن لأي شخص يجد العنوان أن يولّد على حسابك. أضفه في Vercel (Settings → Environment Variables) ثم أعد النشر.",
    ],
  "Site ouvert à tous : sans <c>ACCESS_CODE</c>, chaque visiteur peut générer à vos frais. Ajoutez-la dans Vercel (Settings → Environment Variables), puis redéployez — sauf si c'est voulu (<c>PUBLIC_ACCESS=1</c>).":
    [
      "Site open to everyone: without <c>ACCESS_CODE</c>, every visitor can generate at your expense. Add it in Vercel (Settings → Environment Variables), then redeploy — unless this is intended (<c>PUBLIC_ACCESS=1</c>).",
      "الموقع مفتوح للجميع: بدون <c>ACCESS_CODE</c> يستطيع كل زائر التوليد على حسابك. أضفه في Vercel (Settings → Environment Variables) ثم أعد النشر — إلا إن كان ذلك مقصودًا (<c>PUBLIC_ACCESS=1</c>).",
    ],
  "Glissez une photo ici, cliquez pour en choisir une, ou collez-la (Ctrl+V).": [
    "Drop a photo here, click to choose one, or paste it (Ctrl+V).",
    "اسحب صورة إلى هنا، أو انقر لاختيار واحدة، أو الصقها (Ctrl+V).",
  ],
  "Pour un buste : une seule personne, visage de face, tête et épaules dans l'image, lumière douce sans ombre dure, fond uni ou détouré.":
    [
      "For a bust: a single person, face looking ahead, head and shoulders in the frame, soft light without harsh shadows, plain or removed background.",
      "لتمثال نصفي: شخص واحد، الوجه من الأمام، الرأس والكتفان داخل الصورة، إضاءة ناعمة بلا ظلال حادة، خلفية موحّدة أو مزالة.",
    ],
  "Un fichier .glb déjà téléchargé se rouvre ici aussi, sans payer.": [
    "A .glb file you already downloaded reopens here too, free of charge.",
    "يمكن أيضًا إعادة فتح ملف ‎.glb نزّلته سابقًا هنا، دون دفع.",
  ],
  "Zoom": ["Zoom", "تكبير"],
  "Photo entière": ["Whole photo", "الصورة كاملة"],
  "Recadrer en carré": ["Crop to a square", "قصّ إلى مربع"],
  "Changer de photo": ["Change photo", "تغيير الصورة"],
  "Seul le carré est envoyé : faites glisser la photo pour la placer, zoomez pour ne garder que la tête et les épaules.": [
    "Only the square is sent: drag the photo to position it, zoom in to keep just the head and shoulders.",
    "يُرسَل المربع فقط: اسحب الصورة لوضعها، وكبّر لتُبقي الرأس والكتفين فقط.",
  ],
  "La photo entière est envoyée.": ["The whole photo is sent.", "تُرسَل الصورة كاملة."],
  "Résolution": ["Resolution", "الدقة"],
  "Texture": ["Texture", "الملمس"],
  "Sommets": ["Vertices", "الرؤوس"],
  "Graine (option)": ["Seed (optional)", "البذرة (اختياري)"],
  "aléatoire": ["random", "عشوائية"],
  "Remaillage propre (conseillé pour l'impression 3D)": [
    "Clean remeshing (recommended for 3D printing)",
    "إعادة تشبيك نظيفة (يُنصح بها للطباعة ثلاثية الأبعاد)",
  ],
  "Code d'accès": ["Access code", "رمز الدخول"],
  "Génération lancée {0} (déjà payée), pas encore récupérée. Elle a pu aboutir chez fal.ai : reprendre le suivi ne coûte rien.":
    [
      "Generation started {0} (already paid), not yet retrieved. It may have finished on fal.ai: resuming tracking costs nothing.",
      "بدأ التوليد {0} (مدفوع مسبقًا) ولم يُسترجع بعد. ربما اكتمل على fal.ai: استئناف المتابعة لا يكلّف شيئًا.",
    ],
  " ({0} autre(s) en attente.)": [" ({0} more pending.)", " ({0} أخرى قيد الانتظار.)"],
  "le {0} à {1}": ["on {0} at {1}", "في {0} على الساعة {1}"],
  "Reprendre le suivi": ["Resume tracking", "استئناف المتابعة"],
  "Oublier": ["Forget", "نسيان"],
  "Génération en cours…": ["Generating…", "جارٍ التوليد…"],
  "Générer le modèle 3D": ["Generate the 3D model", "توليد المجسم ثلاثي الأبعاد"],
  "Nouvel essai automatique ({0}/{1})…": ["Retrying automatically ({0}/{1})…", "إعادة المحاولة تلقائيًا ({0}/{1})…"],
  "La génération continue chez fal.ai : elle reste en attente ici, à reprendre ou à oublier.": [
    "Generation continues on fal.ai: it stays pending here, to resume or forget.",
    "يستمر التوليد على fal.ai: يبقى معلّقًا هنا لاستئنافه أو نسيانه.",
  ],
  "Arrêter le suivi": ["Stop tracking", "إيقاف المتابعة"],
  "Buste imprimable": ["Printable bust", "تمثال نصفي قابل للطباعة"],
  "Modèle généré": ["Generated model", "المجسم المولَّد"],
  "Le modèle apparaîtra ici.": ["The model will appear here.", "سيظهر المجسم هنا."],
  "Ce fichier GLB n'a pas pu être lu.": ["This GLB file could not be read.", "تعذّرت قراءة ملف GLB هذا."],
  "Retirer de l'historique": ["Remove from history", "إزالة من السجل"],
  "Fichier ouvert :": ["Open file:", "الملف المفتوح:"],
  "Télécharger GLB": ["Download GLB", "تنزيل GLB"],
  "La même que celle du buste.": ["The same as the bust's.", "نفس ارتفاع التمثال النصفي."],
  "Hauteur": ["Height", "الارتفاع"],
  "Hauteur du STL brut, en millimètres": ["Height of the raw STL, in millimetres", "ارتفاع ملف STL الخام بالمليمتر"],
  "Conversion…": ["Converting…", "جارٍ التحويل…"],
  "Télécharger STL brut": ["Download raw STL", "تنزيل STL الخام"],
  "graine": ["seed", "البذرة"],
  "Remet ces réglages, graine comprise, dans le formulaire : avec la même photo et le même cadrage, le même modèle. Le cadrage n'est pas enregistré : replacez-le à l'identique.":
    [
      "Puts these settings, seed included, back into the form: with the same photo and the same framing, the same model. The framing is not saved: set it up identically.",
      "يعيد هذه الإعدادات، مع البذرة، إلى النموذج: بنفس الصورة ونفس القص تحصل على نفس المجسم. القص لا يُحفظ: أعده كما كان.",
    ],
  "✓ Réglages repris": ["✓ Settings restored", "✓ تمت استعادة الإعدادات"],
  "Reprendre ces réglages": ["Reuse these settings", "استخدام هذه الإعدادات"],
  "Vos derniers modèles (dans ce navigateur)": ["Your latest models (in this browser)", "آخر مجسماتك (في هذا المتصفح)"],
  "Les fichiers sont hébergés par fal.ai et peuvent expirer : téléchargez ceux que vous voulez garder.": [
    "Files are hosted by fal.ai and may expire: download the ones you want to keep.",
    "الملفات مستضافة لدى fal.ai وقد تنتهي صلاحيتها: نزّل ما تريد الاحتفاظ به.",
  ],
  "Envoi de l'image…": ["Uploading the image…", "جارٍ إرسال الصورة…"],
  "En file d'attente": ["Queued", "في قائمة الانتظار"],
  " (position {0})": [" (position {0})", " (المركز {0})"],
  "Génération sur GPU…": ["Generating on GPU…", "جارٍ التوليد على وحدة GPU…"],
  "✓ Modèle prêt.": ["✓ Model ready.", "✓ المجسم جاهز."],
  "La génération continue peut-être chez fal.ai : « Reprendre le suivi » la récupère sans frais.": [
    "Generation may still be running on fal.ai: “Resume tracking” gets it at no cost.",
    "ربما ما زال التوليد جاريًا على fal.ai: «استئناف المتابعة» يسترجعه دون تكلفة.",
  ],
  "Comptez 20 s à 1 min selon la résolution.": [
    "Allow 20 s to 1 min depending on the resolution.",
    "احسب من 20 ثانية إلى دقيقة حسب الدقة.",
  ],
  "Aperçu impossible : le navigateur ne lit pas ce format (photo HEIC d'iPhone ?). Enregistrez-la en JPEG, puis choisissez-la de nouveau.":
    [
      "No preview: the browser can't read this format (iPhone HEIC photo?). Save it as JPEG, then choose it again.",
      "لا معاينة: المتصفح لا يقرأ هذه الصيغة (صورة HEIC من آيفون؟). احفظها بصيغة JPEG ثم اخترها مجددًا.",
    ],
  "Cadrage de la photo : faites-la glisser, ou utilisez les flèches du clavier": [
    "Photo framing: drag it, or use the arrow keys",
    "قص الصورة: اسحبها أو استخدم أسهم لوحة المفاتيح",
  ],
  "Photo choisie": ["Chosen photo", "الصورة المختارة"],
  "Le serveur met trop de temps à répondre.": ["The server is taking too long to respond.", "الخادم يستغرق وقتًا طويلًا للرد."],
  "Connexion au serveur impossible (réseau coupé ?).": [
    "Can't reach the server (network down?).",
    "تعذّر الاتصال بالخادم (الشبكة مقطوعة؟).",
  ],
  "Le serveur ne répond pas (erreur {0}).": ["The server is not responding (error {0}).", "الخادم لا يستجيب (خطأ {0})."],
  "Erreur {0}.": ["Error {0}.", "خطأ {0}."],
  "La génération a échoué chez fal.ai.": ["Generation failed on fal.ai.", "فشل التوليد على fal.ai."],
  "Génération toujours pas terminée après {0} min de suivi.": [
    "Generation still not finished after {0} min of tracking.",
    "لم ينتهِ التوليد بعد {0} دقيقة من المتابعة.",
  ],
  "Suivi interrompu après {0} essais : {1}": ["Tracking stopped after {0} attempts: {1}", "توقفت المتابعة بعد {0} محاولات: {1}"],
  "texture {0} px": ["texture {0} px", "ملمس {0} بكسل"],
  "{0}k sommets": ["{0}k vertices", "{0} ألف رأس"],
  "remaillé": ["remeshed", "معاد التشبيك"],
  "sans remaillage": ["no remeshing", "دون إعادة تشبيك"],
  "graine non enregistrée": ["seed not saved", "البذرة غير محفوظة"],
  "De {0} à {1}": ["From {0} to {1}", "من {0} إلى {1}"],
  // le buste
  "Rapide": ["Fast", "سريع"],
  "Normal": ["Normal", "عادي"],
  "Fin": ["Fine", "دقيق"],
  "Plein, fermé, posé sur un socle — calculé dans votre navigateur.": [
    "Solid, closed, on a base — computed in your browser.",
    "مصمت، مغلق، على قاعدة — يُحسب في متصفحك.",
  ],
  "Réessayer": ["Try again", "إعادة المحاولة"],
  "Lecture du modèle…": ["Reading the model…", "جارٍ قراءة المجسم…"],
  "Coupe : {0} % du bas retirés": ["Cut: bottom {0} % removed", "القص: إزالة {0} % من الأسفل"],
  "Placez la ligne sous le menton ou au cou : tout ce qui est en dessous (vêtements en feuilles) part.": [
    "Put the line under the chin or at the neck: everything below it (sheet-like clothing) goes.",
    "ضع الخط تحت الذقن أو عند العنق: كل ما تحته (الملابس الرقيقة) يُزال.",
  ],
  "Socle compris. Le STL brut prend la même hauteur.": [
    "Base included. The raw STL takes the same height.",
    "مع القاعدة. ملف STL الخام يأخذ نفس الارتفاع.",
  ],
  "Hauteur totale du buste, socle compris, en millimètres": [
    "Total height of the bust, base included, in millimetres",
    "الارتفاع الكلي للتمثال النصفي مع القاعدة بالمليمتر",
  ],
  "Socle": ["Base", "القاعدة"],
  "Finesse": ["Detail", "الدقة"],
  "⚠ Finesse réelle ≈ {0} mm : modèle trop grand pour cette finesse, réduisez la hauteur.": [
    "⚠ Actual detail ≈ {0} mm: model too big for this detail level, reduce the height.",
    "⚠ الدقة الفعلية ≈ {0} مم: المجسم كبير جدًا على هذه الدقة، قلّل الارتفاع.",
  ],
  "Calcul…": ["Computing…", "جارٍ الحساب…"],
  "Recalculer": ["Recompute", "إعادة الحساب"],
  "Préparer le buste": ["Prepare the bust", "تحضير التمثال النصفي"],
  "Télécharger le STL du buste": ["Download the bust STL", "تنزيل ملف STL للتمثال النصفي"],
  "Voir le buste": ["Show the bust", "عرض التمثال النصفي"],
  "✓ Volume fermé, prêt pour le slicer : {0} mm, {1} cm³ en plein, {2}k triangles, finesse {3} mm": [
    "✓ Closed volume, ready for the slicer: {0} mm, {1} cm³ solid, {2}k triangles, detail {3} mm",
    "✓ حجم مغلق جاهز للتقطيع: {0} مم، {1} سم³ مصمت، {2} ألف مثلث، دقة {3} مم",
  ],
  " (grossie : modèle trop grand pour la finesse choisie)": [
    " (coarsened: model too big for the chosen detail)",
    " (خُفّضت: المجسم كبير جدًا على الدقة المختارة)",
  ],
  "⚠ {0} du volume détaché a été retiré (débris ou accessoire) : vérifiez l'aperçu.": [
    "⚠ {0} of detached volume was removed (debris or accessory): check the preview.",
    "⚠ أُزيل {0} من الحجم المنفصل (شظايا أو ملحقات): تحقّق من المعاينة.",
  ],
  "Ce fichier GLB n'a pas pu être lu ({0}).": ["This GLB file could not be read ({0}).", "تعذّرت قراءة ملف GLB هذا ({0})."],
  "fal.ai ne sert pas le fichier pour l'instant : réessayez dans un moment (le lien n'est pas forcément expiré).": [
    "fal.ai isn't serving the file right now: try again in a moment (the link hasn't necessarily expired).",
    "fal.ai لا يقدّم الملف حاليًا: أعد المحاولة بعد قليل (الرابط ليس بالضرورة منتهي الصلاحية).",
  ],
  "Le modèle n'a pas pu être téléchargé depuis fal.ai : réseau coupé, ou lien expiré.": [
    "The model could not be downloaded from fal.ai: network down, or link expired.",
    "تعذّر تنزيل المجسم من fal.ai: الشبكة مقطوعة أو انتهت صلاحية الرابط.",
  ],
  "Lecture du modèle impossible : {0}": ["Can't read the model: {0}", "تعذّرت قراءة المجسم: {0}"],
  "Silhouette du modèle et ligne de coupe": ["Model silhouette and cut line", "ظل المجسم وخط القص"],
  "Préparation": ["Preparing", "التحضير"],
  "Aperçu": ["Preview", "المعاينة"],
  "Peau posée": ["Skin laid", "وُضعت القشرة"],
  "Intérieur trouvé": ["Inside found", "تم إيجاد الداخل"],
  "Creux rouverts": ["Hollows reopened", "أعيد فتح التجاويف"],
  "Parois minces épaissies": ["Thin walls thickened", "تم تثخين الجدران الرقيقة"],
  "Socle et nettoyage": ["Base and cleanup", "القاعدة والتنظيف"],
  "Lissage": ["Smoothing", "التنعيم"],
  "Surface reconstruite": ["Surface rebuilt", "أعيد بناء السطح"],
  "Le fichier ne contient aucun maillage.": ["The file contains no mesh.", "الملف لا يحتوي على أي شبكة."],
  "Le calcul a échoué (mémoire ?).": ["The computation failed (memory?).", "فشل الحساب (الذاكرة؟)."],
  "Rien au-dessus de la coupe.": ["Nothing above the cut.", "لا شيء فوق خط القص."],
  "Rien à imprimer au-dessus de la coupe.": ["Nothing to print above the cut.", "لا شيء للطباعة فوق خط القص."],
};
