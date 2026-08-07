import type { Messages } from './en'

/**
 * Typed as `Messages`, so a key present in English and missing here is a **compile error**
 * rather than a runtime fallback nobody notices. PRD 1 §9.2 requires full EN/NL parity on
 * the player and main screen, and the compiler is a cheaper guarantee than a review.
 *
 * Dutch runs 20–30% longer than English, which is why it — not English — is the layout
 * baseline for the main screen (PRD 1 §9.4).
 */
const nl: Messages = {
  /**
   * Mirrors conventions §4's catalogue, and the `Messages` annotation makes a missing code a
   * compile error — which is the only reason EN/NL parity on the player surface (PRD 1 §9.2)
   * can be claimed rather than hoped for.
   */
  errors: {
    GAME_NOT_FOUND:
      'Die code hoort niet bij een quiz. Kijk op het scherm en probeer opnieuw.',
    GAME_NOT_JOINABLE: 'Die quiz is al afgelopen.',
    GAME_NOT_LIVE: 'Die quiz loopt niet.',
    TEAM_NOT_FOUND: 'Dat team doet niet meer mee.',
    UNKNOWN_DEVICE:
      'Dit toestel doet niet meer mee. Meld je opnieuw aan om verder te spelen.',
    TEAM_FULL: 'Dat team heeft al het maximale aantal telefoons.',
    QUESTION_NOT_OPEN: 'Die vraag staat niet open.',
    QUESTION_LOCKED: 'Te laat — de quizmaster heeft deze vraag gesloten.',
    ALREADY_SUBMITTED: 'Je team heeft deze vraag al beantwoord.',
    BUZZERS_NOT_LIVE: 'De buzzers staan nu niet open.',
    TEAM_LOCKED_OUT:
      'Je antwoord was fout, dus je kunt bij deze vraag niet opnieuw buzzen.',
    NOT_IN_SETUP: 'Dat kan alleen voordat de quiz begint.',
    RESYNC_BLOCKED: 'Deze quiz is al gespeeld en kan niet meer worden bijgewerkt.',
    SOURCE_QUIZ_DELETED: 'De quiz waar dit spel uit komt bestaat niet meer.',
    QUESTION_STILL_OPEN: 'Sluit of sla eerst de open vraag over.',
    SCORE_OUT_OF_RANGE: 'Die score valt buiten wat deze vraag toestaat.',
    NOT_A_FINALE_ROUND: 'Dat geldt alleen voor de finale.',
    TOO_FEW_FINALISTS: 'Kies minstens twee finalisten.',
    FINALISTS_ALREADY_SET: 'De finalisten staan al vast voor deze ronde.',
    TEAM_NOT_A_FINALIST: 'Dat team zit niet in de finale.',
    TEAM_ELIMINATED: 'Dat team is uit de finale.',
    NOT_TEAMS_TURN: 'Dat team is niet aan zet.',
    NO_TURN_ACTIVE: 'Start eerst een beurt.',
    KEYWORD_ALREADY_MARKED: 'Dat woord is al aan een ander team toegekend.',
    SCHEMA_VERSION_UNSUPPORTED: 'Dit bestand komt uit een nieuwere versie van Kwiz.',
    CHECKSUM_MISMATCH: 'Sommige bestanden in deze export zijn beschadigd.',
    IMPORT_COLLISION: 'Je hebt deze quiz al. Vervangen, of als kopie importeren?',
    MANIFEST_INVALID: 'Dit is geen Kwiz-export.',
    VALIDATION_ERROR: 'Er ging iets mis met dat verzoek.',
    DATABASE_MIGRATION_REQUIRED:
      'De database moet worden bijgewerkt voordat Kwiz kan starten.',
    ATTACHMENT_REJECTED: 'Dat bestand is geen ondersteunde afbeelding, audio of video.',
    ATTACHMENT_NOT_FOUND: 'Dat bestand ontbreekt.',
  },

  common: {
    appName: 'Kwiz',
    cancel: 'Annuleren',
    save: 'Opslaan',
    delete: 'Verwijderen',
    create: 'Aanmaken',
    add: 'Toevoegen',
    rename: 'Hernoemen',
    close: 'Sluiten',
    back: 'Terug',
    saved: 'Opgeslagen',
    saving: 'Opslaan…',
    saveFailed: 'Niet opgeslagen — controleer je verbinding.',
    teams: 'Teams',
    moveUp: 'Omhoog',
    moveDown: 'Omlaag',

    // Identical to the English catalogue on purpose — see the note there.
    language: {
      label: 'Taal',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  landing: {
    playing: {
      title: 'Ik speel mee',
      detail: 'Scan de QR-code op het scherm, of vul de code in.',
      codeLabel: 'Spelcode',
      join: 'Meedoen',
      invalid: 'Die code klopt niet.',
    },
    hosting: {
      title: 'Ik presenteer',
      detail: 'Mijn quizzen beheren en een spel starten.',
      open: 'Openen',
    },
  },

  admin: {
    dashboard: {
      title: 'Kwiz',
      quizzes: 'Quizzen',
      newQuiz: 'Nieuwe quiz',
      import: 'Importeren…',
      games: 'Spellen',
      showFinished: 'Toon afgelopen',
      hideFinished: 'Verberg afgelopen',
      play: 'Spelen',
      open: 'Openen',
      rounds: '{count, plural, one {# ronde} other {# rondes}}',
      questions: '{count, plural, one {# vraag} other {# vragen}}',
      teamCount: '{count, plural, one {# team} other {# teams}}',
      edited: 'bewerkt {date}',
      code: 'code {code}',
      templateUpdated: 'Quiz is bijgewerkt',
      resync: 'Vernieuwen',
      duplicate: 'Dupliceren',
      export: 'Exporteren',
      emptyQuizzes: 'Nog geen quizzen.',
      emptyQuizzesDetail: 'Maak er een, of importeer een .zip die je elders exporteerde.',
      emptyGames: 'Nog geen spellen. Druk op Spelen bij een quiz om er een op te zetten.',
      newQuizTitle: 'Nieuwe quiz',
      newQuizLabel: 'Naam',
      newQuizPlaceholder: 'Pubquiz #4',
      deleteQuizTitle: '“{name}” verwijderen?',
      deleteQuizKeepsGames:
        '{count, plural, =0 {Deze quiz heeft geen gespeelde spellen.} one {# gespeeld spel blijft bewaard en blijft terug te lezen.} other {# gespeelde spellen blijven bewaard en blijven terug te lezen.}}',
      status: {
        SETUP: 'Opzet',
        LIVE: 'Live',
        FINISHED: 'Afgelopen',
        ABANDONED: 'Afgebroken',
      },
    },

    quiz: {
      backToDashboard: 'Overzicht',
      name: 'Naam',
      description: 'Omschrijving',
      rounds: 'Rondes',
      addRound: 'Ronde toevoegen',
      openRound: 'Openen',
      totals: '{questions} vragen · {points} punten · ± {minutes} min',
      roundSummary: '{questions} vragen · {points} ptn',
      roundSummaryFinale: '{questions} vragen',
      empty: 'Nog geen rondes. Voeg er een toe om vragen te schrijven.',
      addRoundTitle: 'Ronde toevoegen',
      roundTypeLabel: 'Type',
      roundTitleLabel: 'Titel',
      roundTitlePlaceholder: 'Muziek',
      type: {
        QUESTION_SET: 'Vragen',
        JEOPARDY: 'Jeopardy-bord',
        DSMTW_FINALE: 'Finale',
      },
      typeHint: {
        QUESTION_SET: 'Een lijst vragen, elke antwoordvorm.',
        JEOPARDY: 'Een bord met categorieën en waardes. Elke tegel is een buzzervraag.',
        DSMTW_FINALE: 'De finale op tijd. Altijd als laatste, en één per quiz.',
      },
      finaleExists: 'Deze quiz eindigt al met een finale.',
      finalePinned: 'Staat vast als laatste ronde',
      deleteRoundTitle: '“{title}” verwijderen?',
      deleteRoundBody:
        '{count, plural, =0 {Deze ronde heeft geen vragen.} one {De # vraag wordt ook verwijderd.} other {De # vragen worden ook verwijderd.}}',
      preflight: 'Controleren',
    },
  },
}

export default nl
