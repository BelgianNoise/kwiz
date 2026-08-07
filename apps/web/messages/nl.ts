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

    // Identical to the English catalogue on purpose — see the note there.
    language: {
      label: 'Taal',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  landing: {
    scaffold: {
      title: 'Kwiz',
      subtitle: 'De basisopzet werkt.',
      detail: 'De schermen worden gebouwd in build-order slices 4 tot 7.',
    },
  },
}

export default nl
