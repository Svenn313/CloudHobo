// Programme d'entrainement IBM MQ : un exercice par jour, 10 a 15 minutes.
// Etape : { t: texte, mq: [qm, "CMD1", "CMD2"] }  -> commandes MQSC passees a runmqsc
//         { t: texte, sh: "commande shell" }      -> commande lancee depuis l'hote
const SAMP = '/opt/mqm/samp/bin';

function buildCmd(step) {
  if (step.sh) return step.sh;
  const [qm, ...cmds] = step.mq;
  const n = qm.toLowerCase().replace('qm', '');
  const body = cmds.map(c => c.replace(/'/g, "\\'")).join('\\n');
  return `docker exec -i mq-qm${n} runmqsc ${qm} <<< $'${body}'`;
}

const WEEKS = [
  { name: 'Semaine 1', title: 'Les bases', days: [1, 2, 3, 4, 5, 6, 7] },
  { name: 'Semaine 2', title: 'Droits, connexions, exploitation', days: [8, 9, 10, 11, 12, 13, 14] },
  { name: 'Semaine 3', title: "D'un queue manager à l'autre", days: [15, 16, 17, 18, 19, 20] },
  { name: 'Semaine 4', title: 'Supervision et automatisation', days: [21, 22, 23, 24] },
];

const PROGRAM = [
  {
    day: 1, title: 'Le modèle mental', minutes: 5,
    goal: "Comprendre ce qu'est un queue manager avant de toucher à quoi que ce soit.",
    learn: [
      "IBM MQ est un système de messagerie **asynchrone et fiable**. Une application dépose un message, une autre le lira plus tard, et le message survit aux pannes.",
      "Un **queue manager (QMGR)** est l'instance MQ : il possède ses queues, ses canaux, ses logs et ses droits. Ici tu en as deux : `QM1` et `QM2`, chacun dans son conteneur.",
      "Une **queue** est une file de messages stockée sur disque par le QMGR. Une application se connecte à **un** QMGR et lit ou écrit dans ses queues.",
    ],
    steps: [
      { t: "Vérifie que tes deux queue managers tournent :", sh: 'docker exec mq-qm1 dspmq && docker exec mq-qm2 dspmq' },
      { t: "Ouvre le shell d'administration MQSC de QM1 et regarde ses attributs principaux :", mq: ['QM1', 'DISPLAY QMGR QMNAME DEADQ MAXMSGL'] },
    ],
    verify: ["QM1 et QM2 sont en marche"],
    quiz: [{ id: 'deadq', q: "Quelle est la dead letter queue (`DEADQ`) de QM1 ?" }],
    questions: ["À ton avis, à quoi sert la dead letter queue ?"],
  },
  {
    day: 2, title: 'Explorer les objets', minutes: 10,
    goal: 'Savoir lister ce qui existe dans un queue manager.',
    learn: [
      "`runmqsc` est l'outil d'administration en ligne de commande. Les commandes s'appellent **MQSC** : `DISPLAY` pour lire, `DEFINE` pour créer, `ALTER` pour modifier, `DELETE` pour supprimer.",
      "Les noms commençant par `SYSTEM.` appartiennent à MQ. Ceux en `DEV.` viennent de la configuration de développement de l'image Docker.",
    ],
    steps: [
      { t: "Liste les queues de dév :", mq: ['QM1', 'DISPLAY QLOCAL(DEV.*)'] },
      { t: "Liste les canaux, puis le listener :", mq: ['QM1', 'DISPLAY CHANNEL(DEV.*)', 'DISPLAY LISTENER(*)'] },
      { t: "Affiche la profondeur d'une queue :", mq: ['QM1', 'DISPLAY QLOCAL(DEV.QUEUE.1) CURDEPTH MAXDEPTH'] },
    ],
    quiz: [{ id: 'maxdepth', q: "Quelle est la profondeur maximale (`MAXDEPTH`) de `DEV.QUEUE.1` ?" }],
    questions: [
      "Quelles queues `DEV.*` existent ?",
      "Quels types de canaux vois-tu ? (`SVRCONN` = canal pour les applications clientes)",
    ],
  },
  {
    day: 3, title: 'Ma première queue', minutes: 10,
    goal: 'Créer une queue en ligne de commande et la retrouver dans la console web.',
    learn: [
      "Une **queue locale** (`QLOCAL`) est la seule sorte de queue qui stocke vraiment des messages.",
      "Les noms d'objets sont en **majuscules**, avec des points pour structurer (`TEST.QUEUE`, `APP.ORDERS.IN`).",
    ],
    steps: [
      { t: "Crée la queue :", mq: ['QM1', "DEFINE QLOCAL(TEST.QUEUE) DESCR('ma premiere queue') MAXDEPTH(100)"] },
      { t: "Vérifie ses attributs :", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH MAXDEPTH DESCR'] },
      { t: "Ouvre la console web de QM1 (login `admin`), va dans **Queues** et retrouve `TEST.QUEUE` :", link: ['https://mq1.svenlabs.fr/ibmmq/console/', 'Console QM1'] },
    ],
    verify: ["`TEST.QUEUE` existe sur QM1 avec `MAXDEPTH(100)` et une description"],
    questions: [
      "Que se passe-t-il si tu relances le `DEFINE` ? Comment le faire passer quand même ? (indice : `REPLACE`)",
      "Retrouves-tu les mêmes informations dans la console et dans `DISPLAY` ?",
    ],
  },
  {
    day: 4, title: 'Écrire des messages', minutes: 10,
    goal: 'Mettre des messages dans une queue.',
    learn: [
      "**PUT** écrit un message dans une queue. Le message y reste jusqu'à ce que quelqu'un le lise.",
      "L'image MQ fournit des programmes d'exemple dans `/opt/mqm/samp/bin` : `amqsput` pour écrire, `amqsget` pour lire (demain).",
    ],
    steps: [
      { t: "Écris trois messages :", sh: `printf 'message 1\\nmessage 2\\nmessage 3\\n' | docker exec -i mq-qm1 ${SAMP}/amqsput TEST.QUEUE QM1` },
      { t: "Regarde la profondeur de la queue. **Ne lis pas les messages**, ils servent demain :", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH'] },
    ],
    verify: ["`TEST.QUEUE` contient exactement 3 messages"],
    questions: [
      "Où sont stockés ces messages tant que personne ne les lit ?",
    ],
  },
  {
        day: 5, title: 'Browse puis get', minutes: 10,
    goal: 'Regarder un message sans le consommer, puis le consommer.',
    learn: [
      "**BROWSE** lit un message sans le retirer. C'est ce qu'on utilise pour diagnostiquer : on regarde sans rien casser.",
      "**GET** lit le message et le **retire** de la queue.",
      "Dans la console web, l'onglet des messages d'une queue fait un browse.",
    ],
    steps: [
      { t: "Parcours les trois messages d'hier sans les consommer :", sh: `docker exec mq-qm1 ${SAMP}/amqsbcg TEST.QUEUE QM1` },
      { t: "Vérifie qu'ils sont toujours là :", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH'] },
      { t: "Maintenant consomme-les (le programme s'arrête après environ 15 secondes sans nouveau message) :", sh: `docker exec mq-qm1 ${SAMP}/amqsget TEST.QUEUE QM1` },
      { t: "Et la profondeur ?", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH'] },
    ],
    verify: ["`TEST.QUEUE` est vide (les messages ont été lus)"],
    questions: [
      "Retrouves-tu le texte du message, son `MsgId`, sa persistance dans la sortie de `amqsbcg` ?",
      "Pourquoi le browse est-il plus sûr que le get pour diagnostiquer en production ?",
    ],
  },
  {
        day: 6, title: 'Queue pleine', minutes: 10,
    goal: 'Provoquer et reconnaître l’erreur la plus courante en exploitation.',
    learn: [
      "Quand une queue atteint `MAXDEPTH`, les écritures échouent avec le code **2053** (`MQRC_Q_FULL`).",
      "En production, une queue qui se remplit signifie presque toujours que **le consommateur est arrêté ou trop lent**.",
    ],
    steps: [
      { t: "Limite la queue à deux messages :", mq: ['QM1', 'ALTER QLOCAL(TEST.QUEUE) MAXDEPTH(2)'] },
      { t: "Envoie-en trois et lis l'erreur du troisième :", sh: `printf 'un\\ndeux\\ntrois\\n' | docker exec -i mq-qm1 ${SAMP}/amqsput TEST.QUEUE QM1` },
      { t: "La queue est pleine :", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH MAXDEPTH'] },
      { after: true, t: "Après validation, remets une limite normale et vide la queue :", mq: ['QM1', 'ALTER QLOCAL(TEST.QUEUE) MAXDEPTH(100)', 'CLEAR QLOCAL(TEST.QUEUE)'] },
    ],
    verify: ["`TEST.QUEUE` est pleine : `MAXDEPTH(2)` et 2 messages"],
    questions: [
      "Quel code d'erreur obtiens-tu pour le troisième message ?",
      "Quelle métrique surveillerais-tu pour être prévenu avant ?",
    ],
  },
  {
        day: 7, title: 'Révision de la semaine 1', minutes: 15,
    goal: 'Refaire seul le cycle complet, sans regarder les jours précédents.',
    learn: ["Aujourd'hui, pas de commandes à copier : tu les retrouves toi-même. Seul le nettoyage de départ est donné."],
    steps: [
      { t: "Supprime la queue d'entraînement des jours précédents :", mq: ['QM1', 'DELETE QLOCAL(TEST.QUEUE) PURGE'] },
      { after: true, t: "Après validation, supprime la queue du défi :", mq: ['QM1', 'DELETE QLOCAL(ETUDE.ORDRES) PURGE'] },
    ],
    challenge: [
      "Crée une queue `ETUDE.ORDRES` sur QM1 avec une profondeur maximale de 3.",
      "Écris-y trois messages pour la remplir.",
      "Parcours-les sans les consommer.",
      "Essaie d'en écrire un quatrième et constate l'erreur.",
    ],
    verify: ["`TEST.QUEUE` n'existe plus", "`ETUDE.ORDRES` existe, avec `MAXDEPTH(3)` et 3 messages"],
    questions: [
      "Quelle différence entre `CLEAR` et `DELETE` ?",
      "Quelle différence entre browse et get ?",
    ],
  },
  {
        day: 8, title: 'Qui a le droit de quoi ?', minutes: 10,
    goal: "Lire et donner des autorisations sur une queue.",
    learn: [
      "Les droits (**AUTHREC**) s'attachent à un objet pour un utilisateur ou un groupe : `PUT`, `GET`, `BROWSE`, `INQ`, `DSP`, `CLR`, `DLT`…",
      "Les utilisateurs du groupe `mqm` sont administrateurs et ont tous les droits partout.",
      "Un profil peut avoir des jokers : `DEV.**` s'applique à toutes les queues dont le nom commence par `DEV.`.",
    ],
    steps: [
      { t: "Recrée la queue de test :", mq: ['QM1', 'DEFINE QLOCAL(TEST.QUEUE) REPLACE'] },
      { t: "Droits de l'application `app` sur les queues de dév :", mq: ['QM1', 'DISPLAY AUTHREC PROFILE(DEV.**) OBJTYPE(QUEUE)'] },
      { t: "Donne à `app` le droit d'écrire et de lire dans ta queue :", mq: ['QM1', "SET AUTHREC PROFILE(TEST.QUEUE) OBJTYPE(QUEUE) PRINCIPAL('app') AUTHADD(PUT,GET,BROWSE,INQ)"] },
      { t: "Vérifie :", mq: ['QM1', 'DISPLAY AUTHREC PROFILE(TEST.QUEUE) OBJTYPE(QUEUE)'] },
    ],
    verify: ["`TEST.QUEUE` existe", "`app` a les droits `PUT` et `GET` sur `TEST.QUEUE`"],
    questions: [
      "Qui a des droits sur `TEST.QUEUE`, et pourquoi `mqm` apparaît-il sans que tu l'aies demandé ?",
    ],
  },
  {
        day: 9, title: 'Le fameux 2035', minutes: 10,
    goal: "Reconnaître l'erreur « non autorisé » et savoir où regarder.",
    learn: [
      "Le code **2035** (`MQRC_NOT_AUTHORIZED`) est l'erreur MQ que tu verras le plus souvent.",
      "Le message d'erreur côté application est vague. Le détail (quel utilisateur, quel objet) est dans les **logs du queue manager**.",
    ],
    steps: [
      { t: "Essaie d'écrire avec un utilisateur qui n'est pas autorisé à se connecter :", sh: `echo test | docker exec -i -u nobody mq-qm1 ${SAMP}/amqsput TEST.QUEUE QM1` },
      { t: "Cherche la trace dans les logs du queue manager :", sh: 'docker exec mq-qm1 tail -40 /var/mqm/qmgrs/QM1/errors/AMQERR01.LOG' },
    ],
    quiz: [{ id: 'rc', q: "Quel code retour obtiens-tu (`reason code`) ?" }],
    questions: [
      "À quelle étape l'erreur arrive-t-elle : à la connexion (`MQCONNX`) ou à l'ouverture de la queue (`MQOPEN`) ?",
      "Trouves-tu dans le log l'utilisateur refusé ?",
    ],
  },
  {
    day: 10, title: 'CHLAUTH, le pare-feu des canaux', minutes: 10,
    goal: 'Comprendre pourquoi un canal est accepté ou refusé.',
    learn: [
      "Les règles **CHLAUTH** décident qui peut utiliser quel canal, depuis quelle adresse, et sous quelle identité.",
      "MQ évalue les règles de la plus précise à la plus générale. La règle `CHLAUTH(*)` avec `USERSRC(NOACCESS)` est le « tout est interdit par défaut ».",
      "C'est la première cause de « ça ne marche pas » entre deux queue managers.",
    ],
    steps: [
      { t: "Affiche toutes les règles :", mq: ['QM1', 'DISPLAY CHLAUTH(*)'] },
    ],
    quiz: [{ id: 'usersrc', q: "Quelle valeur de `USERSRC` porte la règle `CHLAUTH(*)` qui bloque tout ?" }],
    questions: [
      "Quelle règle bloque tout par défaut ?",
      "Quelle règle autorise `DEV.APP.SVRCONN` ? Avec quelle identité (`USERSRC`) ?",
      "Pourquoi un canal sans règle dédiée se retrouve-t-il bloqué ?",
    ],
  },
  {
    day: 11, title: 'Qui est connecté ?', minutes: 10,
    goal: 'Voir les connexions ouvertes sur un queue manager.',
    learn: [
      "Chaque application ou processus connecté à un QMGR apparaît comme une **connexion**. La console web en ouvre une aussi.",
      "Le champ `APPLTAG` indique le nom du programme connecté.",
    ],
    steps: [
      { t: "Ouvre la console web de QM1 dans un onglet, puis liste les connexions :", mq: ['QM1', 'DISPLAY CONN(*) TYPE(CONN) APPLTAG USERID'] },
    ],
    quiz: [{ id: 'appltag', q: "Quel programme (APPLTAG) correspond à la console web ?" }],
    questions: [
      "Retrouves-tu `MQ Console` dans les `APPLTAG` ?",
      "Qu'est-ce qui changerait si une de tes applications était bloquée en ouverture d'une queue ?",
    ],
  },
  {
    day: 12, title: 'La persistance', minutes: 15,
    goal: 'Vérifier ce qui survit à un redémarrage.',
    learn: [
      "Un message **persistant** est écrit sur disque et survit à un redémarrage. Un message non persistant est perdu.",
      "La persistance se règle par message, avec comme valeur par défaut celle de la queue (`DEFPSIST`).",
      "Les données du QMGR vivent dans `/mnt/mqm` du conteneur, c'est-à-dire `ibmmq/volumes/qm1` sur l'hôte.",
    ],
    steps: [
      { t: "Pars d'une queue vide :", mq: ['QM1', 'CLEAR QLOCAL(TEST.QUEUE)'] },
      { t: "Rends la queue persistante par défaut :", mq: ['QM1', 'ALTER QLOCAL(TEST.QUEUE) DEFPSIST(YES)'] },
      { t: "Écris un message :", sh: `echo 'je dois survivre' | docker exec -i mq-qm1 ${SAMP}/amqsput TEST.QUEUE QM1` },
      { t: "Redémarre le conteneur (attends environ 20 secondes) :", sh: 'docker restart mq-qm1' },
      { t: "Le message est-il toujours là ?", mq: ['QM1', 'DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH'] },
    ],
    verify: ["`TEST.QUEUE` a `DEFPSIST(YES)` et contient 1 message (qui a survécu au redémarrage)"],
    questions: [
      "Que se passerait-il avec `DEFPSIST(NO)` ?",
      "Que se passerait-il si tu supprimais `ibmmq/volumes/qm1` ?",
    ],
  },
  {
    day: 13, title: 'Lire les logs et les codes retour', minutes: 10,
    goal: 'Se faire une routine de diagnostic.',
    learn: [
      "Ordre de diagnostic : **1.** la sortie de l'application et son code retour, **2.** les logs du QMGR (`AMQERR01.LOG`), **3.** l'état des canaux et des queues.",
      "**2085** : la queue n'existe pas. **2053** : queue pleine. **2035** : non autorisé. **2059** : queue manager injoignable.",
    ],
    steps: [
      { t: "Écris dans une queue qui n'existe pas :", sh: `echo test | docker exec -i mq-qm1 ${SAMP}/amqsput QUEUE.INEXISTANTE QM1` },
      { t: "Lis le log d'erreurs :", sh: 'docker exec mq-qm1 tail -30 /var/mqm/qmgrs/QM1/errors/AMQERR01.LOG' },
      { t: "Vide la queue de test :", mq: ['QM1', 'CLEAR QLOCAL(TEST.QUEUE)'] },
    ],
    quiz: [{ id: 'rc', q: "Quel code retour obtiens-tu en écrivant dans une queue qui n'existe pas ?" }],
    verify: ["`TEST.QUEUE` est vide"],
    questions: [
      "Quel code obtiens-tu ?",
      "Le log du QMGR contient-il quelque chose pour cette erreur ? Pourquoi (ou pourquoi pas) à ton avis ?",
    ],
  },
  {
    day: 14, title: 'Révision de la semaine 2', minutes: 15,
    goal: 'Associer chaque symptôme à sa cause.',
    learn: ["Réponds de tête. Si tu hésites, vérifie avec les commandes des jours 8 à 13."],
    steps: [],
    quiz: [
      { id: 'q1', q: "Quel fichier de log du queue manager lis-tu pour connaître la cause détaillée d'un refus ?" },
      { id: 'q2', q: "Quelle commande MQSC liste les règles de « pare-feu » des canaux ?" },
      { id: 'q3', q: "Quel attribut de queue règle la persistance par défaut des messages ?" },
    ],
    questions: [
      "Une application obtient 2035 à la connexion : que vérifies-tu en premier ?",
      "Des messages disparaissent après un redémarrage : quelle propriété vérifies-tu ?",
      "Une queue se remplit : quelle est l'hypothèse la plus probable ?",
    ],
  },
  {
        day: 15, title: 'Le schéma QM1 → QM2, côté QM2', minutes: 15,
    goal: 'Comprendre la chaîne de routage et préparer le destinataire.',
    learn: [
      "Une application n'écrit jamais directement dans un autre queue manager. Le message suit cette chaîne :",
      "`appli → QREMOTE (QM1) → queue de transmission (QM1) → canal émetteur ══TCP══▶ canal récepteur (QM2) → queue locale (QM2)`",
      "Les deux extrémités du canal ont le **même nom** : un `SDR` (sender) chez l'émetteur, un `RCVR` (receiver) chez le destinataire.",
      "Aujourd'hui tu prépares **QM2**, qui reçoit.",
    ],
    steps: [
      { t: "Sur QM2, crée la queue de destination, le canal récepteur, et autorise le canal :", mq: ['QM2',
        'DEFINE QLOCAL(ORDERS)',
        'DEFINE CHANNEL(QM1.QM2) CHLTYPE(RCVR)',
        "SET CHLAUTH(QM1.QM2) TYPE(ADDRESSMAP) ADDRESS('*') USERSRC(MAP) MCAUSER('mqm')"] },
      { t: "Vérifie :", mq: ['QM2', 'DISPLAY QLOCAL(ORDERS)', 'DISPLAY CHANNEL(QM1.QM2)'] },
    ],
    verify: ["`ORDERS` existe sur QM2", "Le canal `QM1.QM2` existe sur QM2 en type RCVR", "La règle CHLAUTH `QM1.QM2` est présente sur QM2"],
    questions: [
      "Pourquoi le canal doit-il s'appeler pareil des deux côtés ?",
      "À quoi sert la règle CHLAUTH ? (`MCAUSER('mqm')` est un raccourci de labo : en vrai on utilise un utilisateur aux droits limités.)",
    ],
  },
  {
    day: 16, title: 'Côté QM1 : la chaîne émettrice', minutes: 15,
    goal: 'Construire la partie émettrice.',
    learn: [
      "La **queue de transmission** (`USAGE(XMITQ)`) est le tampon où les messages attendent d'être envoyés.",
      "La **queue distante** (`QREMOTE`) ne stocke rien : c'est un alias qui dit « ce qu'on écrit ici part vers la queue `ORDERS` de `QM2` ».",
      "Le **canal émetteur** (`SDR`) sait comment joindre QM2 (`CONNAME`) et quelle queue de transmission vider.",
    ],
    steps: [
      { t: "Sur QM1 :", mq: ['QM1',
        'DEFINE QLOCAL(QM2.XMIT) USAGE(XMITQ)',
        'DEFINE QREMOTE(ORDERS.TO.QM2) RNAME(ORDERS) RQMNAME(QM2) XMITQ(QM2.XMIT)',
        "DEFINE CHANNEL(QM1.QM2) CHLTYPE(SDR) CONNAME('mq-qm2(1414)') XMITQ(QM2.XMIT)",
        'START CHANNEL(QM1.QM2)'] },
      { t: "Vérifie l'état du canal (attends quelques secondes si besoin) :", mq: ['QM1', 'DISPLAY CHSTATUS(QM1.QM2) STATUS'] },
    ],
    verify: ["`QM2.XMIT` est une queue de transmission", "`ORDERS.TO.QM2` pointe vers `ORDERS` sur QM2", "Le canal `QM1.QM2` existe en type SDR et tourne (RUNNING)"],
    questions: [
      "Que signifie `mq-qm2(1414)` et pourquoi cela marche-t-il ici ?",
      "Quel est l'état du canal ?",
    ],
  },
  {
    day: 17, title: 'Premier message entre deux QMGR', minutes: 10,
    goal: 'Voir un message traverser la chaîne.',
    learn: ["Aujourd'hui, tout est déjà en place. Tu envoies, tu constates l'arrivée."],
    steps: [
      { t: "Écris dans la queue distante de QM1 :", sh: `echo 'commande 42' | docker exec -i mq-qm1 ${SAMP}/amqsput ORDERS.TO.QM2 QM1` },
      { t: "Le message est arrivé sur QM2 (attends une seconde ou deux) :", mq: ['QM2', 'DISPLAY QLOCAL(ORDERS) CURDEPTH'] },
      { t: "Et la queue de transmission de QM1 est vide, car il est déjà parti :", mq: ['QM1', 'DISPLAY QLOCAL(QM2.XMIT) CURDEPTH'] },
      { after: true, t: "Après validation, lis-le sur QM2 :", sh: `docker exec mq-qm2 ${SAMP}/amqsget ORDERS QM2` },
    ],
    verify: ["`ORDERS` contient 1 message sur QM2", "`QM2.XMIT` est vide sur QM1"],
    questions: [
      "As-tu écrit dans une queue de QM1 ou de QM2 ? Dans laquelle as-tu lu ?",
      "Où le message a-t-il transité entre les deux ?",
    ],
  },
  {
        day: 18, title: 'Les messages attendent', minutes: 10,
    goal: 'Voir la garantie de livraison à l’œuvre.',
    learn: [
      "Si le canal est arrêté ou que l'autre côté est injoignable, les messages **s'accumulent dans la queue de transmission**. Ils partent dès que le canal repart.",
      "Rien n'est perdu : c'est tout l'intérêt de MQ.",
    ],
    steps: [
      { t: "Arrête le canal :", mq: ['QM1', 'STOP CHANNEL(QM1.QM2)'] },
      { t: "Envoie trois messages :", sh: `printf 'a\\nb\\nc\\n' | docker exec -i mq-qm1 ${SAMP}/amqsput ORDERS.TO.QM2 QM1` },
      { t: "Où sont-ils ?", mq: ['QM1', 'DISPLAY QLOCAL(QM2.XMIT) CURDEPTH'] },
      { after: true, t: "Après validation, relance le canal :", mq: ['QM1', 'START CHANNEL(QM1.QM2)'] },
      { after: true, t: "Et regarde la file de destination (attends quelques secondes) :", mq: ['QM2', 'DISPLAY QLOCAL(ORDERS) CURDEPTH'] },
    ],
    verify: ["`QM2.XMIT` contient 3 messages", "Le canal `QM1.QM2` n'est pas en marche"],
    questions: [
      "Quelle alerte mettrais-tu en place pour détecter cette situation en production ?",
    ],
  },
  {
        day: 19, title: 'Casser CHLAUTH et diagnostiquer', minutes: 15,
    goal: 'Retrouver la cause d’un canal qui ne repart pas.',
    learn: [
      "Un classique : le canal est bien défini des deux côtés, mais la règle CHLAUTH manque ou est mauvaise. L'émetteur voit juste un canal qui ne démarre pas. La cause est dans les logs de **l'autre** côté.",
    ],
    steps: [
      { t: "Sur QM2, retire la règle qui autorise le canal :", mq: ['QM2', "SET CHLAUTH(QM1.QM2) TYPE(ADDRESSMAP) ADDRESS('*') ACTION(REMOVE)"] },
      { t: "Sur QM1, redémarre le canal :", mq: ['QM1', 'STOP CHANNEL(QM1.QM2)', 'START CHANNEL(QM1.QM2)'] },
      { t: "Regarde son état (essaie plusieurs fois) :", mq: ['QM1', 'DISPLAY CHSTATUS(QM1.QM2) STATUS'] },
      { t: "Cherche la cause dans les logs de QM2 :", sh: 'docker exec mq-qm2 tail -40 /var/mqm/qmgrs/QM2/errors/AMQERR01.LOG' },
      { after: true, t: "Après validation, répare : remets la règle sur QM2 :", mq: ['QM2', "SET CHLAUTH(QM1.QM2) TYPE(ADDRESSMAP) ADDRESS('*') USERSRC(MAP) MCAUSER('mqm')"] },
      { after: true, t: "Puis relance le canal sur QM1 :", mq: ['QM1', 'STOP CHANNEL(QM1.QM2)', 'START CHANNEL(QM1.QM2)'] },
    ],
    verify: ["La règle CHLAUTH `QM1.QM2` n'existe plus sur QM2", "Le canal `QM1.QM2` ne tourne pas"],
    questions: [
      "Quel état affiche le canal quand il est bloqué ?",
      "Quel code `AMQ…` du log désigne un canal bloqué par CHLAUTH ?",
    ],
  },
  {
        day: 20, title: 'La dead letter queue', minutes: 15,
    goal: 'Savoir où vont les messages qui ne peuvent pas être livrés.',
    learn: [
      "Quand un message arrive au bon queue manager mais que sa queue de destination n'existe pas (ou est pleine), il est déposé dans la **dead letter queue** avec un en-tête qui explique la raison.",
      "Une DLQ qui grossit est un signal d'alerte classique en exploitation.",
    ],
    steps: [
      { t: "Sur QM1, crée une queue distante vers une queue qui n'existe pas sur QM2 :", mq: ['QM1', 'DEFINE QREMOTE(GHOST.TO.QM2) RNAME(GHOST) RQMNAME(QM2) XMITQ(QM2.XMIT)'] },
      { t: "Envoie un message :", sh: `echo 'vers le vide' | docker exec -i mq-qm1 ${SAMP}/amqsput GHOST.TO.QM2 QM1` },
      { t: "Sur QM2, regarde la dead letter queue (attends quelques secondes) :", mq: ['QM2', 'DISPLAY QLOCAL(DEV.DEAD.LETTER.QUEUE) CURDEPTH'] },
      { t: "Lis l'en-tête de ce message :", sh: `docker exec mq-qm2 ${SAMP}/amqsbcg DEV.DEAD.LETTER.QUEUE QM2` },
      { after: true, t: "Après validation, nettoie :", mq: ['QM2', 'CLEAR QLOCAL(DEV.DEAD.LETTER.QUEUE)'] },
    ],
    verify: ["`GHOST.TO.QM2` existe sur QM1", "La dead letter queue de QM2 contient au moins un message"],
    quiz: [{ id: 'reason', q: "Quel code de raison (`Reason`) lis-tu dans l'en-tête du message mort ?" }],
    questions: [
      "Quelle raison (`Reason`) indique l'en-tête du message mort ?",
      "Quelle différence avec le cas du jour 13 (2085 directement chez l'application) ?",
    ],
  },
  {
    day: 21, title: 'Superviser', minutes: 10,
    goal: 'Savoir quoi regarder pour savoir si tout va bien.',
    learn: [
      "Les quatre signaux à surveiller : **profondeur des queues**, **ancienneté du plus vieux message**, **état des canaux**, **taille de la dead letter queue**.",
      "`DISPLAY QSTATUS` donne l'état dynamique d'une queue : nombre de lecteurs et d'écrivains, ancienneté du message le plus vieux.",
    ],
    steps: [
      { t: "État d'une queue :", mq: ['QM2', 'DISPLAY QSTATUS(ORDERS) CURDEPTH IPPROCS OPPROCS MSGAGE'] },
      { t: "État des canaux :", mq: ['QM1', 'DISPLAY CHSTATUS(*) STATUS MSGS'] },
      { t: "État du queue manager :", mq: ['QM1', 'DISPLAY QMSTATUS'] },
    ],
    verify: ["Le canal `QM1.QM2` est en marche (RUNNING)"],
    quiz: [{ id: 'ipprocs', q: "Que signifie `IPPROCS` dans `DISPLAY QSTATUS` ? (une phrase courte)" }],
    questions: [
      "Que signifie `OPPROCS` ?",
      "Pour chaque signal, à partir de quelle valeur déclencherais-tu une alerte ?",
    ],
  },
  {
    day: 22, title: "L'API REST", minutes: 15,
    goal: 'Piloter MQ par script.',
    learn: [
      "La console web s'appuie sur une API REST exposée par le même serveur web. Tu peux l'appeler depuis un script, une pipeline CI ou un outil de supervision.",
      "Elle demande l'en-tête `ibm-mq-rest-csrf-token` et une authentification basique. Garde le même terminal pour toutes les commandes du jour : la première charge `MQ_ADMIN_PASSWORD` depuis ton `.env`.",
    ],
    steps: [
      { t: "Charge le mot de passe dans ta session :", sh: "export MQ_ADMIN_PASSWORD=$(grep '^MQ_ADMIN_PASSWORD=' ~/git/cloudHobo/.env | cut -d= -f2-)" },
      { t: "Liste les queue managers de QM1 :", sh: `curl -sk -u admin:"$MQ_ADMIN_PASSWORD" -H 'ibm-mq-rest-csrf-token: x' https://127.0.0.1:9443/ibmmq/rest/v3/admin/qmgr` },
      { t: "Lis une queue par REST :", sh: `curl -sk -u admin:"$MQ_ADMIN_PASSWORD" -H 'ibm-mq-rest-csrf-token: x' -H 'Content-Type: application/json' -X POST https://127.0.0.1:9443/ibmmq/rest/v2/admin/action/qmgr/QM1/mqsc -d '{"type":"runCommandJSON","command":"display","qualifier":"qlocal","name":"DEV.QUEUE.1","responseParameters":["curdepth","maxdepth"]}'` },
      { t: "Crée une queue `REST.QUEUE` par REST, en changeant `display` en `define` :", sh: `curl -sk -u admin:"$MQ_ADMIN_PASSWORD" -H 'ibm-mq-rest-csrf-token: x' -H 'Content-Type: application/json' -X POST https://127.0.0.1:9443/ibmmq/rest/v2/admin/action/qmgr/QM1/mqsc -d '{"type":"runCommandJSON","command":"define","qualifier":"qlocal","name":"REST.QUEUE"}'` },
      { after: true, t: "Après validation, supprime-la :", mq: ['QM1', 'DELETE QLOCAL(REST.QUEUE)'] },
    ],
    verify: ["`REST.QUEUE` existe sur QM1"],
    questions: [
      "Comment utiliserais-tu cet appel dans un script de supervision ?",
    ],
  },
  {
        day: 23, title: 'Où vivent les données ?', minutes: 10,
    goal: 'Savoir ce qu’il faut sauvegarder.',
    learn: [
      "Tout l'état d'un queue manager (objets, messages persistants, logs) est dans `/mnt/mqm`, monté sur `ibmmq/volumes/qmX`.",
      "Sauvegarder à chaud un volume en cours d'écriture donne une copie incohérente. Il faut **arrêter le QMGR** (ou utiliser les outils de sauvegarde MQ).",
    ],
    steps: [
      { t: "Taille des données de chaque queue manager :", sh: 'du -sh ~/git/cloudHobo/ibmmq/volumes/qm1 ~/git/cloudHobo/ibmmq/volumes/qm2' },
      { t: "Contenu d'un volume :", sh: 'ls ~/git/cloudHobo/ibmmq/volumes/qm1' },
      { t: "Vue d'ensemble de l'installation et des QMGR depuis le conteneur :", sh: 'docker exec mq-qm1 dspmq -o all' },
    ],
    quiz: [{ id: 'path', q: "Quel dossier de l'hôte contient les données de QM2 ? (chemin relatif à `ibmmq/`)" }],
    questions: [
      "Que perds-tu si tu recrées le conteneur sans le volume ?",
      "Ton script `backup.sh` à la racine couvre-t-il ce dossier ? Comment le rendre cohérent ?",
    ],
  },
  {
    day: 24, title: 'Projet final', minutes: 30,
    goal: 'Tout refaire de zéro sur un nouveau cas.',
    learn: ["Tu as maintenant tous les ingrédients. À toi de jouer, sans copier les commandes des jours précédents. Choisis tes propres noms d'objets, sauf pour la queue finale `INVOICES`."],
    steps: [
      { after: true, t: "Après validation, nettoie QM2 :", mq: ['QM2', 'DELETE QLOCAL(INVOICES) PURGE'] },
    ],
    challenge: [
      "Sur QM2, crée la queue `INVOICES`.",
      "Sur QM1, crée une queue de transmission, une queue distante qui mène à `INVOICES` et un canal (nouveaux noms). Sur QM2, le canal récepteur correspondant et sa règle CHLAUTH.",
      "Envoie cinq messages depuis QM1 et vérifie qu'ils arrivent dans `INVOICES`.",
      "Supprime tes autres objets quand tu as fini (canaux, queues, règles CHLAUTH).",
    ],
    verify: ["`INVOICES` existe sur QM2 et contient 5 messages", "Une queue distante de QM1 mène à `INVOICES` sur QM2"],
    questions: [
      "As-tu eu besoin de revenir aux jours précédents ? Sur quels points ?",
      "Qu'est-ce qui te semble le moins clair ? Dis-le-moi : on y reviendra.",
    ],
  },
];

if (typeof module !== 'undefined') module.exports = { PROGRAM, WEEKS, buildCmd };
