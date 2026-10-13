# Fiche d'entraînement IBM MQ (profil DevOps)

Environnement : deux queue managers dans Docker, `QM1` (conteneur `mq-qm1`) et `QM2` (conteneur `mq-qm2`).
Consoles web : https://mq1.svenlabs.fr/ibmmq/console/ et https://mq2.svenlabs.fr/ibmmq/console/ (login `admin`).

Les commandes marquées `$` se lancent depuis l'hôte. Les commandes `runmqsc` se tapent dans un shell MQSC interactif :

```bash
docker exec -it mq-qm1 runmqsc QM1     # quitter avec "end"
```

---

## 1. Le modèle mental (à lire une fois)

MQ est un **système de messagerie asynchrone avec garantie de livraison**. Pense à un spool de courrier fiable : l'émetteur dépose, le destinataire lit plus tard, et le message survit aux pannes.

| Concept | Équivalent DevOps | Ce qu'il faut retenir |
|---|---|---|
| **Queue manager (QMGR)** | un serveur / une instance de broker | Le processus MQ. Il possède ses queues, ses canaux, ses logs et ses droits. Les applis se connectent à **un** QMGR. |
| **Queue locale** | une file stockée sur disque | Contient réellement les messages. C'est la seule qui stocke. |
| **Queue de transmission (XMITQ)** | un tampon sortant | File locale spéciale qui contient les messages en route vers un autre QMGR. |
| **Queue distante (QREMOTE)** | un alias / une définition de routage | Ne stocke rien. Dit « un message écrit ici part vers la queue X du QMGR Y ». |
| **Channel** | une connexion TCP nommée et configurée | Toujours défini **par paire** : sender (SDR) d'un côté, receiver (RCVR) de l'autre, avec le **même nom**. |
| **Listener** | le `listen` d'un serveur | Écoute les connexions entrantes (port 1414 par défaut). |
| **SVRCONN / CLNTCONN** | canal pour les applis clientes | Une appli se connecte en client via un canal SVRCONN. |
| **Dead letter queue (DLQ)** | la file des erreurs | Reçoit les messages qui n'ont pas pu être livrés. Premier réflexe en cas de souci. |
| **CHLAUTH** | un pare-feu applicatif sur les canaux | Règles qui disent qui a le droit de se connecter via quel canal. **Cause n°1 des « ça ne marche pas ».** |
| **AUTHREC** | les ACL sur les objets | Droits (put, get, browse…) d'un utilisateur ou groupe sur une queue. |

À retenir : une appli n'écrit **jamais** directement dans le QMGR d'un autre. Elle écrit dans son QMGR local, et MQ route le message via XMITQ puis canal.

Les messages ont un **MsgId** (identifiant), un **CorrelId** (pour relier une réponse à sa requête), une **persistance** (survit-il à un redémarrage ?) et un éventuel **délai d'expiration**.

---

## 2. Exercices

### Exercice 1 : explorer un QMGR

```bash
$ docker exec mq-qm1 dspmq                      # état des QMGR
$ docker exec -it mq-qm1 runmqsc QM1
```

Dans `runmqsc` :

```
DISPLAY QMGR
DISPLAY QLOCAL(*)
DISPLAY CHANNEL(*)
DISPLAY LISTENER(*)
DISPLAY QLOCAL(DEV.QUEUE.1) CURDEPTH MAXDEPTH
```

Questions :
- Quelles queues existent par défaut ? Lesquelles commencent par `SYSTEM.` et lesquelles par `DEV.` ?
- Sur quel port écoute le listener ?
- Quelle est la profondeur maximale (`MAXDEPTH`) d'une queue ?

### Exercice 2 : créer une queue, y mettre et lire des messages

```
DEFINE QLOCAL(TEST.QUEUE) MAXDEPTH(100) DESCR('ma premiere queue')
```

Depuis l'hôte, avec les programmes d'exemple fournis dans l'image :

```bash
$ docker exec -it mq-qm1 /opt/mqm/samp/bin/amqsput TEST.QUEUE QM1
# taper quelques lignes, puis une ligne vide pour finir

$ docker exec mq-qm1 bash -c 'echo "DISPLAY QLOCAL(TEST.QUEUE) CURDEPTH" | runmqsc QM1'
$ docker exec mq-qm1 /opt/mqm/samp/bin/amqsbcg TEST.QUEUE QM1   # BROWSE : lit sans consommer
$ docker exec mq-qm1 /opt/mqm/samp/bin/amqsget TEST.QUEUE QM1   # GET : lit et consomme
```

Questions :
- Quelle différence entre `amqsbcg` (browse) et `amqsget` (get) sur la profondeur de la queue ?
- Que se passe-t-il quand tu dépasses `MAXDEPTH` ? (Mets `MAXDEPTH(2)` avec `ALTER QLOCAL(TEST.QUEUE) MAXDEPTH(2)` et envoie 3 messages. Quel code retour ? **2053** = queue pleine.)

Ouvre aussi la console web : QM1 → Queues → `TEST.QUEUE`. Tu peux y voir, créer et supprimer des messages. Repère comment elle affiche les mêmes informations que `DISPLAY`.

### Exercice 3 : les droits

```
DISPLAY AUTHREC PROFILE(TEST.QUEUE) OBJTYPE(QUEUE)
DISPLAY AUTHREC PROFILE(DEV.**) OBJTYPE(QUEUE)
DISPLAY CHLAUTH(*)
```

Questions :
- Quels droits a `mqm` sur ta queue ? Et `app` sur `DEV.**` ?
- Pourquoi un utilisateur qui n'a que `GET` ne peut-il pas faire de `PUT` ? Quel code d'erreur obtient-il ? (**2035** = non autorisé.)
- Quelle règle CHLAUTH sert de « bloque tout par défaut » ? (Regarde `CHLAUTH(*)` avec `USERSRC(NOACCESS)`.)

Pour donner un droit :

```
SET AUTHREC PROFILE(TEST.QUEUE) OBJTYPE(QUEUE) PRINCIPAL('mqm') AUTHADD(PUT,GET,BROWSE,INQ)
```

### Exercice 4 : envoyer un message de QM1 vers QM2 (le cœur de MQ)

C'est l'exercice qui fait comprendre le routage. Le schéma :

```
appli -> QREMOTE (QM1) -> XMITQ (QM1) -> canal SDR ==TCP==> canal RCVR (QM2) -> QLOCAL (QM2)
```

**Sur QM2** (le destinataire) :

```
DEFINE QLOCAL(ORDERS)
DEFINE CHANNEL(QM1.QM2) CHLTYPE(RCVR)
SET CHLAUTH(QM1.QM2) TYPE(ADDRESSMAP) ADDRESS('*') USERSRC(MAP) MCAUSER('mqm')
```

**Sur QM1** (l'émetteur) :

```
DEFINE QLOCAL(QM2.XMIT) USAGE(XMITQ)
DEFINE QREMOTE(ORDERS.TO.QM2) RNAME(ORDERS) RQMNAME(QM2) XMITQ(QM2.XMIT)
DEFINE CHANNEL(QM1.QM2) CHLTYPE(SDR) CONNAME('mq-qm2(1414)') XMITQ(QM2.XMIT)
START CHANNEL(QM1.QM2)
DISPLAY CHSTATUS(QM1.QM2)
```

Envoi et réception :

```bash
$ echo "commande 42" | docker exec -i mq-qm1 /opt/mqm/samp/bin/amqsput ORDERS.TO.QM2 QM1
$ docker exec mq-qm2 /opt/mqm/samp/bin/amqsget ORDERS QM2
```

Points à comprendre :
- Le **nom du canal** doit être identique des deux côtés (`QM1.QM2`). C'est ce qui les apparie.
- `CONNAME('mq-qm2(1414)')` marche parce que les deux conteneurs sont sur le même réseau Docker. Le nom `mq-qm2` est résolu par Docker.
- `MCAUSER('mqm')` est un raccourci de labo : le canal reçoit avec les droits de `mqm`. En vrai, on utilise un utilisateur dédié aux droits limités.
- Le message est écrit dans `ORDERS.TO.QM2`, qui ne stocke rien : il atterrit dans `QM2.XMIT` puis part par le canal.

À faire ensuite :
1. Arrête le canal (`STOP CHANNEL(QM1.QM2)`), envoie 3 messages, regarde `CURDEPTH` de `QM2.XMIT`, puis relance le canal. Les messages attendent dans la XMITQ : c'est la garantie de livraison.
2. Casse les droits : retire la règle CHLAUTH et relance le canal. Il passe en `RETRYING`. Lis l'erreur dans les logs (voir exercice 6).

### Exercice 5 : requête / réponse

Une appli envoie une requête et attend une réponse : le `CorrelId` relie les deux. Pour t'entraîner, utilise les exemples `amqsreq` / `amqsech`, ou simplement :

```
DEFINE QLOCAL(REQ)
DEFINE QLOCAL(REP)
```

Mets un message dans `REQ` avec `amqsput`, lis-le avec `amqsbcg REQ QM1` et repère dans la sortie le `MsgId`, le `CorrelId`, le `ReplyToQ`. Compare avec ce que montre la console web.

### Exercice 6 : diagnostiquer (la compétence qui compte)

Quand un truc ne marche pas, dans cet ordre :

1. **Les logs du QMGR**, à lire d'abord :
   ```bash
   $ docker exec mq-qm2 tail -50 /var/mqm/qmgrs/QM2/errors/AMQERR01.LOG
   $ docker logs --tail 50 mq-qm2
   ```
2. **L'état du canal** : `DISPLAY CHSTATUS(*)`. États : `RUNNING`, `RETRYING` (il n'arrive pas à joindre l'autre côté), `STOPPED`, `BINDING`.
3. **La profondeur des queues** : `DISPLAY QLOCAL(*) CURDEPTH` filtre ce qui est en retard.
4. **La dead letter queue** : `DISPLAY QLOCAL(DEV.DEAD.LETTER.QUEUE) CURDEPTH`.
5. **Le code retour** de l'appli (voir la table ci-dessous).

Codes retour à connaître :

| Code | Nom | Sens habituel |
|---|---|---|
| 2035 | `MQRC_NOT_AUTHORIZED` | Droits manquants (AUTHREC) ou règle CHLAUTH |
| 2085 | `MQRC_UNKNOWN_OBJECT_NAME` | La queue n'existe pas (faute de frappe, mauvais QMGR) |
| 2053 | `MQRC_Q_FULL` | Queue pleine |
| 2033 | `MQRC_NO_MSG_AVAILABLE` | Rien à lire (normal avec un get non bloquant) |
| 2059 | `MQRC_Q_MGR_NOT_AVAILABLE` | QMGR arrêté ou injoignable |
| 2009 | `MQRC_CONNECTION_BROKEN` | Connexion coupée |

Exercice : provoque volontairement chacune de ces erreurs et retrouve-la dans les logs ou la sortie de l'outil.

### Exercice 7 : supervision et exploitation

C'est ta valeur ajoutée de DevOps.

```
DISPLAY QSTATUS(TEST.QUEUE)          # nombre de lecteurs/écrivains ouverts, ancienneté du plus vieux message
DISPLAY CONN(*)                      # connexions en cours
DISPLAY QMSTATUS                     # santé du QMGR
```

Questions :
- Quelles métriques surveillerais-tu ? (profondeur des queues, ancienneté du plus vieux message, état des canaux, taille de la DLQ, espace disque des logs.)
- Où vivent les données ? Dans `/mnt/mqm` du conteneur, soit `ibmmq/volumes/qm1` et `qm2` sur l'hôte. Que sauvegarder ? Que se passe-t-il si tu recrées le conteneur sans le volume ?
- Teste la persistance : mets un message **persistant** dans une queue, redémarre avec `docker restart mq-qm1`, vérifie qu'il est toujours là.

Pour la supervision outillée, l'image sait exposer des métriques Prometheus (`MQ_ENABLE_METRICS=true`, port 9157).

### Exercice 8 : l'API REST (utile en automatisation)

La console web repose sur une API REST. Exemple :

```bash
$ curl -sk -u admin:"$MQ_ADMIN_PASSWORD" -H 'ibm-mq-rest-csrf-token: x' \
    https://127.0.0.1:9443/ibmmq/rest/v3/admin/qmgr          # liste les QMGR

$ curl -sk -u admin:"$MQ_ADMIN_PASSWORD" -H 'ibm-mq-rest-csrf-token: x' \
    -H 'Content-Type: application/json' -X POST \
    https://127.0.0.1:9443/ibmmq/rest/v2/admin/action/qmgr/QM1/mqsc \
    -d '{"type":"runCommandJSON","command":"display","qualifier":"qlocal","name":"DEV.QUEUE.1","responseParameters":["curdepth","maxdepth"]}'
```

Le second appel exécute une commande MQSC (`DISPLAY QLOCAL`) et renvoie la réponse en JSON.

Change `display` en `define` pour créer des objets par script : c'est ce qu'on utilise pour automatiser en CI/CD.

---

## 3. Aide-mémoire MQSC

```
DISPLAY QLOCAL(nom)   | DEFINE QLOCAL(nom)   | ALTER QLOCAL(nom) ...  | DELETE QLOCAL(nom)
DISPLAY CHANNEL(*)    | DEFINE CHANNEL(n) CHLTYPE(SDR|RCVR|SVRCONN)    | START/STOP CHANNEL(n)
DISPLAY CHSTATUS(*)   | DISPLAY QSTATUS(q)   | DISPLAY CONN(*)        | DISPLAY QMSTATUS
DISPLAY AUTHREC ...   | SET AUTHREC ...      | DISPLAY CHLAUTH(*)     | SET CHLAUTH ...
CLEAR QLOCAL(q)       # vide une queue (attention en prod)
```

Commandes shell : `dspmq` (liste les QMGR), `strmqm`/`endmqm` (démarrer/arrêter, gérés par le conteneur ici), `runmqsc` (administration), `amqsput`/`amqsget`/`amqsbcg` (tester).

## 4. Pièges classiques

- **Oublier la paire de canaux** : un SDR sans RCVR du même nom côté distant reste en `RETRYING`.
- **CHLAUTH oublié** : le canal est bloqué par la règle « tout est interdit » et l'erreur n'apparaît que dans les logs du QMGR distant.
- **Majuscules** : les noms d'objets MQ sont en majuscules. `test.queue` devient `TEST.QUEUE`, sauf s'il est entre apostrophes.
- **Mélanger QREMOTE et QLOCAL** : on écrit dans la QREMOTE, on lit dans la QLOCAL de l'autre côté.
- **Messages non persistants** : perdus au redémarrage. Vérifie la persistance voulue par l'appli.
- **Une queue qui grossit** : si personne ne lit, la queue se remplit puis les écritures échouent (2053). Surveille `CURDEPTH`.

## 5. Pour aller plus loin

1. Les **clusters** MQ (équilibrage de charge entre plusieurs QMGR sans définir chaque canal à la main).
2. Les **topics** et le publish/subscribe.
3. Le **TLS** sur les canaux et la gestion des certificats.
4. La **haute disponibilité** (Native HA, multi-instance) : c'est le sujet d'exploitation en entreprise.
5. Se connecter en **client** depuis une appli (Java JMS, Python `pymqi`, Node), avec un canal SVRCONN comme `DEV.APP.SVRCONN`.
