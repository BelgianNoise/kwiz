import type { ErrorCode } from '@kwiz/domain'

/**
 * Keys are `<surface>.<section>.<key>` (conventions §6.1), flat within a section and never
 * deeper than three levels, so any key is greppable.
 *
 * `admin`, `control`, `screen` and `player` arrive with the surfaces that need them — an
 * empty section written now is a stub.
 *
 * **No hardcoded user-facing string anywhere, including scaffolding.** The rule only holds
 * if it holds from the first page.
 */

/**
 * conventions §6.1 — **`errors.<CODE>` mirrors the `ErrorCode` catalogue exactly**, and the
 * annotation is what makes "exactly" true: a code added to conventions §4 without copy here
 * is a compile error, not a raw `SCREAMING_SNAKE` string in front of a room.
 *
 * A server `message` is English, for logs, and a client must never show it (protocol §7.3).
 * This is where user-facing copy lives, which is also why several of these say less than the
 * server does: *"That code doesn't match a game"* is more use to a player than the id that
 * failed to resolve.
 */
const errors: Record<ErrorCode, string> = {
  GAME_NOT_FOUND: "That code doesn't match a game. Check the screen and try again.",
  GAME_NOT_JOINABLE: 'That game has already finished.',
  GAME_NOT_LIVE: 'That game is not running.',
  TEAM_NOT_FOUND: 'That team is no longer in this game.',
  UNKNOWN_DEVICE: 'This device is no longer in the game. Join again to carry on.',
  TEAM_FULL: 'That team already has the maximum number of phones.',
  QUESTION_NOT_OPEN: 'That question is not open.',
  QUESTION_LOCKED: 'Too late — the quiz master has closed this question.',
  ALREADY_SUBMITTED: 'Your team has already answered this one.',
  BUZZERS_NOT_LIVE: 'Buzzers are not live right now.',
  TEAM_LOCKED_OUT:
    'Your answer was incorrect, so you cannot buzz again on this question.',
  NOT_IN_SETUP: 'That can only be changed before the game starts.',
  RESYNC_BLOCKED:
    'This game has already been played, so it cannot be refreshed from the quiz.',
  SOURCE_QUIZ_DELETED: 'The quiz this game came from no longer exists.',
  QUESTION_STILL_OPEN: 'Lock or skip the open question first.',
  SCORE_OUT_OF_RANGE: 'That score is outside the range this question allows.',
  NOT_A_FINALE_ROUND: 'That only applies to the finale.',
  TOO_FEW_FINALISTS: 'Pick at least two finalists.',
  FINALISTS_ALREADY_SET: 'The finalists are already set for this round.',
  TEAM_NOT_A_FINALIST: 'That team is not in the finale.',
  TEAM_ELIMINATED: 'That team is out of the finale.',
  NOT_TEAMS_TURN: "It is not that team's turn.",
  NO_TURN_ACTIVE: 'Start a turn first.',
  KEYWORD_ALREADY_MARKED: 'That keyword has already been credited to another team.',
  SCHEMA_VERSION_UNSUPPORTED: 'This file was made by a newer version of Kwiz.',
  CHECKSUM_MISMATCH: 'Some files in this export are damaged.',
  IMPORT_COLLISION: 'You already have this quiz. Replace it, or import a copy?',
  MANIFEST_INVALID: 'This file is not a Kwiz export.',
  VALIDATION_ERROR: 'Something went wrong with that request.',
  DATABASE_MIGRATION_REQUIRED: 'The database needs migrating before Kwiz can run.',
  ATTACHMENT_REJECTED: 'That file is not a supported image, audio or video file.',
  ATTACHMENT_NOT_FOUND: 'That file is missing.',
}

const en = {
  errors,

  common: {
    appName: 'Kwiz',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    create: 'Create',
    add: 'Add',
    rename: 'Rename',
    close: 'Close',
    back: 'Back',
    saved: 'Saved',
    saving: 'Saving…',
    saveFailed: 'Not saved — check your connection.',
    teams: 'Teams',
    moveUp: 'Move up',
    moveDown: 'Move down',

    /**
     * Language names are **never translated** and are identical in every catalogue
     * (PRD 1 §9.4): both locales must be reachable from a device that cannot read the
     * current one. Never a flag icon alone — flags mean countries, not languages.
     */
    language: {
      label: 'Language',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  /** PRD 2 §3 — the only page a guest and a master both see. */
  landing: {
    playing: {
      title: "I'm playing",
      detail: 'Scan the QR code on screen, or enter the code.',
      codeLabel: 'Game code',
      join: 'Join',
      invalid: "That code doesn't look right.",
    },
    hosting: {
      title: "I'm hosting",
      detail: 'Manage my quizzes and run a game.',
      open: 'Open',
    },
  },

  admin: {
    /** PRD 2 §5 — quizzes above games, and finished games out of the way. */
    dashboard: {
      title: 'Kwiz',
      quizzes: 'Quizzes',
      newQuiz: 'New quiz',
      import: 'Import…',
      games: 'Games',
      showFinished: 'Show finished',
      hideFinished: 'Hide finished',
      play: 'Play',
      open: 'Open',
      rounds: '{count, plural, one {# round} other {# rounds}}',
      questions: '{count, plural, one {# question} other {# questions}}',
      teamCount: '{count, plural, one {# team} other {# teams}}',
      edited: 'edited {date}',
      code: 'code {code}',
      templateUpdated: 'Template updated',
      resync: 'Re-sync',
      duplicate: 'Duplicate',
      export: 'Export',
      /** §5 — a real screen, and the moment the database is created (PRD 1 §6.6). */
      emptyQuizzes: 'No quizzes yet.',
      emptyQuizzesDetail: 'Create one, or import a .zip you exported elsewhere.',
      emptyGames: 'No games yet. Press Play on a quiz to set one up.',
      newQuizTitle: 'New quiz',
      newQuizLabel: 'Name',
      newQuizPlaceholder: 'Pub Quiz #4',
      deleteQuizTitle: 'Delete “{name}”?',
      /**
       * §5 names what survives, because masters assume deleting a quiz takes their history with
       * it and therefore never clean up. Games keep their own copies (data model §10).
       */
      deleteQuizKeepsGames:
        '{count, plural, =0 {This quiz has no played games.} one {# played game will be kept and stays reviewable.} other {# played games will be kept and stay reviewable.}}',
      status: {
        SETUP: 'Setup',
        LIVE: 'Live',
        FINISHED: 'Finished',
        ABANDONED: 'Abandoned',
      },
    },

    /** PRD 2 §6 — the round list, and the finale's one legal position. */
    quiz: {
      backToDashboard: 'Dashboard',
      name: 'Name',
      description: 'Description',
      rounds: 'Rounds',
      addRound: 'Add round',
      openRound: 'Open',
      /** §6 — balance between rounds is the thing a master worries about while authoring. */
      totals: '{questions} questions · {points} points · est. {minutes} min',
      roundSummary: '{questions} questions · {points} pts',
      /** A finale scores seconds, not points (D51), so `0 pts` would read as a mistake. */
      roundSummaryFinale: '{questions} questions',
      empty: 'No rounds yet. Add one to start writing questions.',
      addRoundTitle: 'Add a round',
      roundTypeLabel: 'Type',
      roundTitleLabel: 'Title',
      roundTitlePlaceholder: 'Music',
      type: {
        QUESTION_SET: 'Questions',
        JEOPARDY: 'Jeopardy board',
        DSMTW_FINALE: 'Finale',
      },
      typeHint: {
        QUESTION_SET: 'A list of questions, any answer method.',
        JEOPARDY: 'A board of categories and values. Every tile is a buzzer question.',
        DSMTW_FINALE: 'The timed keyword round. Always last, and only one per quiz.',
      },
      /** §6.1 — a one-line reason, rather than a silently missing option. */
      finaleExists: 'This quiz already ends with a finale.',
      finalePinned: 'Pinned as the last round',
      deleteRoundTitle: 'Delete “{title}”?',
      deleteRoundBody:
        '{count, plural, =0 {This round has no questions.} one {Its # question is deleted too.} other {Its # questions are deleted too.}}',
      preflight: 'Check',
    },
  },
}

export type Messages = typeof en

export default en
