@AGENTS.md

## Le but de cette plateforme

La plateforme existe pour **retirer du travail** a l'usine, pas pour l'organiser autrement.
Chaque fonction doit faire disparaitre un geste reel : une ressaisie, un appel telephonique,
un cahier papier, une verification faite deux fois.

**Avant d'ajouter quoi que ce soit, répondre a cette question : quel geste disparait ?**
Si la reponse est « aucun, mais c'est plus complet », ne pas le faire.

## Regles de conception du flux

1. **Une donnee est demandee une seule fois, a celui qui la connait.**
   L'ouvrier declare ce qu'il a fait — pas ce qui est deja ecrit dans la nomenclature.
   Le magasinier saisit ce qu'il recoit — pas ce que l'acheteur a commande.

2. **Ne jamais demander a l'utilisateur de compenser une donnee manquante.**
   Si une quantite, un prix ou une date manque, le probleme est dans la donnee d'entree,
   pas dans l'ecran qui la reclame. Corriger la source, jamais ajouter un champ.

3. **Un ecran ne doit pas peser plus lourd que le geste qu'il sert.**
   Pas de compteurs, de statuts intermediaires ni de filtres sur une page qui sert une fois
   par mois. Le quotidien passe devant.

4. **Deux problemes identiques font une seule question.**
   Un meme composant present dans deux articles avec le meme ecart se tranche une fois.

5. **Signaler, jamais decider a la place de l'atelier.**
   Une contradiction se montre, se qualifie, et se tranche explicitement. Aucune valeur
   n'est choisie silencieusement.

## Regles sur la nature des articles

Une erreur de nature se propage dans tout le flux : achats, stock, production, ventes,
nomenclature, ecarts. Avant d'utiliser un article, sa nature doit etre declaree.

| Nature | S'achete | Se fabrique | Se vend |
|---|---|---|---|
| Matiere premiere (tube, tole, peinture) | oui | **jamais** | **jamais** |
| Composant achete (vis, embout) | oui | jamais | jamais |
| Semi-fini fabrique | non | oui | jamais |
| Produit fini (chaise, table) | non | oui | oui |
| Main d'oeuvre | non | non | non |

- **Une matiere premiere n'est jamais vendable.** Un tube ne figure pas sur une facture client.
- **Un produit fini n'est jamais achetable.** Une chaise ne se commande pas a un fournisseur.
- Le type « COMPOSANT » ne dit rien : il ne dispense pas de declarer si l'article s'achete,
  se fabrique ou se vend.
- En cas de doute sur un article, demander a l'atelier. Ne jamais retenir une valeur par defaut.

## Le flux, dans l'ordre

```
Fournisseur -> Reception (magasin) -> Stock matiere
                                          |
Produit fini  <- Stock produit fini <- Operations d'atelier
                                          |
                     Ordre de fabrication lance
                                          |
                  Ouvrier declare : bonnes / rebut
```

A chaque etape, une seule personne saisit, et seulement ce qu'elle constate.
Tout le reste se deduit.
